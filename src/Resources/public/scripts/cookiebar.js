/**
 * Contao Cookiebar
 */
let ContaoCookiebar = (function () {

    'use strict';

    let Constructor = function (settings) {
        let p = {}, cookiebar = {}, defaults = {
            selector: '.contao-cookiebar',
            token: 'ccb_contao_token',
            configId: null,
            pageId: null,
            version: null,
            cookies: null,
            doNotTrack: false,
            showAlways: false,
            classes: {
                'onSave': 'cc-saved',
                'onShow': 'cc-active',
                'onGroupToggle': 'cc-active',
                'onGroupSplitSelection': 'cc-group-half',
            }
        };

        const init = function () {
            // Defaults
            cookiebar.settings = extend(true, defaults, settings);
            cookiebar.dom = document.querySelector(cookiebar.settings.selector);
            cookiebar.scriptCache = [];
            cookiebar.resourceCache = [];
            cookiebar.show = false;

            let storage = getStorage();

            // Set visibility
            if(
                (parseInt(storage.version) !== parseInt(cookiebar.settings.version) ||
                parseInt(storage.configId) !== parseInt(cookiebar.settings.configId) ||
                cookiebar.settings.showAlways) &&
                !cookiebar.settings.doNotTrack ||
                cookiebar.settings.showAlways){
                cookiebar.show = true;
            }

            // Inputs
            cookiebar.inputs = [];
            cookiebar.dom.querySelectorAll('input[name="cookie[]"]').forEach(function(input, index){
                if(!input.disabled){
                    cookiebar.inputs.push( input );
                }
            });

            // Register events
            registerEvents();

            // Validate cookies from storage
            validateCookies(storage.cookies);

            // Check visibility
            checkVisibility();

            // Load scripts
            setScripts();
        };

        const save = function(e){
            let arrCookies = [];
            let btn = e.currentTarget;
            let mode = 0;

            if(btn.hasAttribute('data-accept-all')){
                mode = 1;
            }else if(btn.hasAttribute('data-deny-all')){
                mode = 2;
            }

            cookiebar.inputs.forEach(function(input){
                if(mode === 2){
                    input.checked = false;
                }else if(mode === 1 || input.checked) {
                    arrCookies.push(parseInt(input.value));
                    input.checked = true;
                }
            });

            // Overwrite current storage
            setStorage({
                configId: cookiebar.settings.configId,
                pageId: cookiebar.settings.pageId,
                version: cookiebar.settings.version,
                cookies: arrCookies
            });

            // Validate new set of cookies
            validateCookies(arrCookies, true);

            // Set scripts
            setScripts();

            // Add new log entry
            log();

            // Show iframes
            if(arrCookies.length){
                arrCookies.forEach(function(cookieId){
                    if(cookiebar.settings.cookies.hasOwnProperty(cookieId) && cookiebar.settings.cookies[cookieId].type === 'iframe'){
                        let iframes = document.querySelectorAll('[data-ccb-id="' + cookieId + '"]');

                        if(iframes.length){
                            iframes.forEach(function(iframe){
                                iframe.src = iframe.src;
                            });
                        }
                    }
                });
            }

            // Add CSS class
            cookiebar.dom.classList.add(cookiebar.settings.classes.onSave);
        };

        const push = function(cookieId){
            let storage = getStorage();

            if(storage.cookies.indexOf(cookieId) === -1)
            {
                // Update storage
                storage.cookies.push(parseInt(cookieId));
                setStorage(storage);

                // Set new status
                cookiebar.settings.cookies[cookieId].confirmed = true;

                // Add new log entry
                log();
            }
        };

        const validateCookies = function(arrCookies, deleteCookies){
            let id, arrDelete = [];
            for(id in cookiebar.settings.cookies){
                let cookieId = parseInt(id);

                if(!cookiebar.settings.cookies.hasOwnProperty(cookieId)){
                    continue;
                }

                let previousState = !!cookiebar.settings.cookies[cookieId].confirmed;
                let currentState = arrCookies.indexOf(cookieId) !== -1;
                let deleteCookie = previousState !== currentState && !currentState;

                cookiebar.settings.cookies[cookieId].confirmed = currentState;

                if(true === deleteCookies && deleteCookie){
                    let token = cookiebar.settings.cookies[cookieId].token;

                    if(null !== token){
                        token.forEach(function(token){
                            arrDelete.push(token);
                        });
                    }
                }
            }

            if(true === deleteCookies && arrDelete.length){
                let request = new XMLHttpRequest();
                    request.open('GET', '/cookiebar/delete?' + serialize({tokens: arrDelete}), true);
                    request.send();
            }
        };

        const setScripts = function(){
            let cookieId;
            for(cookieId in cookiebar.settings.cookies){

                if(!cookiebar.settings.cookies.hasOwnProperty(cookieId)){
                    continue;
                }

                let cookie = cookiebar.settings.cookies[ cookieId ];

                if(null !== cookie.resources){
                    cookie.resources.forEach(function(resource){
                        // 1. load script if cookie confirmed
                        // 2. load script if cookie not confirmed
                        // 3. load script always
                        if(
                            (resource.mode === 1 && cookie.confirmed) ||
                            (resource.mode === 2 && !cookie.confirmed) ||
                            (resource.mode === 3)
                        ){
                            if(cacheCookie(cookie, 'resource')){
                                return;
                            }

                            addResource(resource);
                        }
                    });
                }

                if(null !== cookie.scripts){
                    cookie.scripts.forEach(function(script){
                        // 1. load script if cookie confirmed
                        // 2. load script if cookie not confirmed
                        if(
                            (script.confirmed === cookie.confirmed) ||
                            (!script.confirmed === !cookie.confirmed)
                        ){
                            if(cacheCookie(cookie, 'script')){
                                return;
                            }

                            addScript(script);
                        }
                    });
                }
            }
        };

        const addScript = function(script){
            script.script = createScript(script.script);

            switch(script.position){
                case 1:
                    // below content body
                    document.body.append(script.script);
                    break;
                case 2:
                    // above content body
                    document.body.prepend(script.script);
                    break;
                case 3:
                    // head
                    document.head.append(script.script);
                    break;
            }
        };

        const addResource = function(resource){
            let script = document.createElement('script');
                script.type = 'text/javascript';
                script.src = resource.src;

            if(null !== resource.flags && resource.flags.length){
                resource.flags.forEach(function(flag){
                    script[flag] = true;
                });
            }

            document.head.append(script);
        };

        const cacheCookie = function(cookie, type){
            switch(type){
                case 'resource':
                    if(cookiebar.resourceCache.indexOf(cookie.id) !== -1){
                        return true;
                    }

                    cookiebar.resourceCache.push(cookie.id);
                    break;
                case 'script':
                    if(cookiebar.scriptCache.indexOf(cookie.id) !== -1){
                        return true;
                    }

                    cookiebar.scriptCache.push(cookie.id);
                    break;
            }

            return false;
        };

        const registerEvents = function(){
            let btnToggleCookies = cookiebar.dom.querySelectorAll('[data-toggle-cookies]');
            let btnToggleGroups  = cookiebar.dom.querySelectorAll('[data-toggle-group]');
            let btnAction        = cookiebar.dom.querySelectorAll('[data-save],[data-accept-all],[data-deny-all]');

            if(btnAction.length){
                btnAction.forEach(function(btn){
                    btn.addEventListener('click', save);
                });
            }

            if(btnToggleCookies.length){
                btnToggleCookies.forEach(function(btn){
                    btn.addEventListener('click', toggleCookies);
                });
            }

            if(btnToggleGroups.length){
                btnToggleGroups.forEach(function(btn){
                    btn.addEventListener('click', toggleGroup);
                });
            }
        };

        const restoreCookieStatus = function(){
            let arrCookies = getStorage();

            if(!arrCookies.cookies){
                return;
            }

            arrCookies.cookies.forEach(function(cookieId, index){
                let input = cookiebar.dom.querySelector('[id="c' + cookieId + '"]');

                if(!!input) {
                    input.checked = true;
                }
            });

            let arrGroupInputs = cookiebar.dom.querySelectorAll('input[name="group[]"]');

            if(!!arrGroupInputs){
                arrGroupInputs.forEach(function(groupInput){
                    if(groupInput.disabled){
                        return;
                    }

                    let inputs = groupInput.parentElement.querySelectorAll('input[name="cookie[]"]');
                    let arrGroup = [];

                    if(!!inputs) {
                        inputs.forEach(function(input){
                            if(!input.disabled){
                                arrGroup.push(!!input.checked);
                            }
                        });

                        if(arrGroup.indexOf(false) === -1)
                        {
                            groupInput.checked = true;
                        }
                        else if(arrGroup.indexOf(true) !== -1 && arrGroup.indexOf(false) !== -1){
                            groupInput.classList.add(cookiebar.settings.classes.onGroupSplitSelection);
                        }
                    }
                });
            }
        };

        const checkVisibility = function(){
            if(cookiebar.show) {
                cookiebar.dom.classList.remove(cookiebar.settings.classes.onSave);
                cookiebar.dom.classList.add(cookiebar.settings.classes.onShow);
            }
            else cookiebar.dom.classList.remove(cookiebar.settings.classes.onShow);
        };

        const toggleCookies = function(){
            let state  = this.checked;
            let inputs = this.parentElement.querySelectorAll('input[name="cookie[]"]');

            if(inputs){
                inputs.forEach(function(input, index){
                    if(!input.disabled){
                        input.checked = state;
                    }
                });
            }

            this.classList.remove(cookiebar.settings.classes.onGroupSplitSelection);
        };

        const toggleGroup = function(){
            let state = !this.classList.contains(cookiebar.settings.classes.onGroupToggle);
            let groups = this.parentElement.querySelectorAll('.toggle-group');

            if(groups){
                groups.forEach(function(group, index){
                    group.style.display = state ? 'block' : 'none';
                });
            }

            this.classList.toggle(cookiebar.settings.classes.onGroupToggle);
        };

        const log = function(){
            let request = new XMLHttpRequest();

            let parameter = {
                referrer: window.location.pathname,
                configId: cookiebar.settings.configId,
                pageId:   cookiebar.settings.pageId,
                version:  cookiebar.settings.version,
                cookies:  getStorage().cookies
            };

            request.open('GET', '/cookiebar/log?' + serialize(parameter), true);
            request.send();
        };

        const polyfill = function(){
            // execute only for ie
            if(!window.document.documentMode)
            {
                return;
            }

            if (window.NodeList && !NodeList.prototype.forEach) {
                NodeList.prototype.forEach = Array.prototype.forEach;
            }

            (function (arr) {
                arr.forEach(function (item) {
                    if (item.hasOwnProperty('append')) {
                        return;
                    }
                    Object.defineProperty(item, 'append', {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: function append() {
                            var argArr = Array.prototype.slice.call(arguments),
                                docFrag = document.createDocumentFragment();

                            argArr.forEach(function (argItem) {
                                var isNode = argItem instanceof Node;
                                docFrag.appendChild(isNode ? argItem : document.createTextNode(String(argItem)));
                            });

                            this.appendChild(docFrag);
                        }
                    });
                });
            })([Element.prototype, Document.prototype, DocumentFragment.prototype]);

            (function (arr) {
                arr.forEach(function (item) {
                    if (item.hasOwnProperty('prepend')) {
                        return;
                    }
                    Object.defineProperty(item, 'prepend', {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: function prepend() {
                            var argArr = Array.prototype.slice.call(arguments),
                                docFrag = document.createDocumentFragment();

                            argArr.forEach(function (argItem) {
                                var isNode = argItem instanceof Node;
                                docFrag.appendChild(isNode ? argItem : document.createTextNode(String(argItem)));
                            });

                            this.insertBefore(docFrag, this.firstChild);
                        }
                    });
                });
            })([Element.prototype, Document.prototype, DocumentFragment.prototype]);
        };

        /** Helper methods */

        const serialize = function (obj, prefix) {
            let str = [],
                p;
            for (p in obj) {
                if (obj.hasOwnProperty(p)) {
                    let k = prefix ? prefix + "[" + p + "]" : p,
                        v = obj[p];
                    str.push((v !== null && typeof v === "object") ?
                        serialize(v, k) :
                        encodeURIComponent(k) + "=" + encodeURIComponent(v));
                }
            }
            return str.join("&");
        };

        const extend = function () {
            let extended = {};
            let deep = false;
            let i = 0;
            let length = arguments.length;

            if ( Object.prototype.toString.call( arguments[0] ) === '[object Boolean]' ) {
                deep = arguments[0];
                i++;
            }

            let merge = function (obj) {
                for ( let prop in obj ) {
                    if ( Object.prototype.hasOwnProperty.call( obj, prop ) ) {
                        // If deep merge and property is an object, merge properties
                        if ( deep && Object.prototype.toString.call(obj[prop]) === '[object Object]' ) {
                            extended[prop] = extend( true, extended[prop], obj[prop] );
                        } else {
                            extended[prop] = obj[prop];
                        }
                    }
                }
            };

            for ( ; i < length; i++ ) {
                let obj = arguments[i];
                merge(obj);
            }

            return extended;
        };

        const createScript = function(html) {
            let script = document.createElement('script');
                script.type = 'text/javascript';
                script.innerHTML = html;

            return script;
        };

        const setStorage = function(objStorage){
            localStorage.setItem(generateToken(), JSON.stringify(objStorage));
        };

        const getStorage = function() {
            let objStorage = localStorage.getItem(generateToken());

            if(null === objStorage){
                objStorage = {
                    configId: cookiebar.settings.configId,
                    pageId: cookiebar.settings.pageId,
                    version: -1,
                    cookies: []
                };

                localStorage.setItem(generateToken(), JSON.stringify(objStorage));
            }else{
                objStorage = JSON.parse(objStorage);
            }

            return objStorage;
        };

        const generateToken = function(){
            return cookiebar.settings.token + '_' + cookiebar.settings.configId;
        };

        /** Public methods */

        p.get = function(){
            return cookiebar;
        };

        p.getStorage = function(){
            return getStorage();
        };

        p.issetCookie = function(varCookie){
            let cookieId;
            let arrCookies = getStorage();

            if(!arrCookies.cookies){
                return false;
            }

            if(typeof varCookie == 'number'){
                return arrCookies.cookies.indexOf(varCookie) !== -1;
            }

            for(cookieId in cookiebar.settings.cookies){
                if(null !== cookiebar.settings.cookies[cookieId].token && cookiebar.settings.cookies[cookieId].token.indexOf(varCookie) !== -1){
                    return true;
                }
            }

            return arrCookies.cookies.indexOf(varCookie.toString()) !== -1;
        };

        p.unblock = function(element, cookieId, url){
            if(element.tagName.toLowerCase() === 'iframe'){
                element.src = url;
            }else if(element.tagName.toLowerCase()){
                window.location.href = url;
            }

            push(cookieId);
        };

        p.show = function(restore){
            cookiebar.show = true;
            checkVisibility();

            if(!!restore){
                restoreCookieStatus();
            }
        };

        p.hide = function(){
            cookiebar.show = false;
            checkVisibility();
        };

        polyfill();
        init();

        return p;
    };

    return Constructor;
})();
