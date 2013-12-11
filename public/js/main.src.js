/*! password_gauge v0.1.0 2013-12-11 */
/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.9 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global) {
  var req, s, head, baseElement, dataMain, src,
    interactiveScript, currentlyAddingScript, mainScript, subPath,
    version = '2.1.9',
    commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
    cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
    jsSuffixRegExp = /\.js$/,
    currDirRegExp = /^\.\//,
    op = Object.prototype,
    ostring = op.toString,
    hasOwn = op.hasOwnProperty,
    ap = Array.prototype,
    apsp = ap.splice,
    isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document),
    isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
  //PS3 indicates loaded and complete, but need to wait for complete
  //specifically. Sequence is 'loading', 'loaded', execution,
  // then 'complete'. The UA check is unfortunate, but not sure how
  //to feature test w/o causing perf issues.
    readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
      /^complete$/ : /^(complete|loaded)$/,
    defContextName = '_',
  //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
    isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
    contexts = {},
    cfg = {},
    globalDefQueue = [],
    useInteractive = false;

  function isFunction(it) {
    return ostring.call(it) === '[object Function]';
  }

  function isArray(it) {
    return ostring.call(it) === '[object Array]';
  }

  /**
   * Helper function for iterating over an array. If the func returns
   * a true value, it will break out of the loop.
   */
  function each(ary, func) {
    if (ary) {
      var i;
      for (i = 0; i < ary.length; i += 1) {
        if (ary[i] && func(ary[i], i, ary)) {
          break;
        }
      }
    }
  }

  /**
   * Helper function for iterating over an array backwards. If the func
   * returns a true value, it will break out of the loop.
   */
  function eachReverse(ary, func) {
    if (ary) {
      var i;
      for (i = ary.length - 1; i > -1; i -= 1) {
        if (ary[i] && func(ary[i], i, ary)) {
          break;
        }
      }
    }
  }

  function hasProp(obj, prop) {
    return hasOwn.call(obj, prop);
  }

  function getOwn(obj, prop) {
    return hasProp(obj, prop) && obj[prop];
  }

  /**
   * Cycles over properties in an object and calls a function for each
   * property value. If the function returns a truthy value, then the
   * iteration is stopped.
   */
  function eachProp(obj, func) {
    var prop;
    for (prop in obj) {
      if (hasProp(obj, prop)) {
        if (func(obj[prop], prop)) {
          break;
        }
      }
    }
  }

  /**
   * Simple function to mix in properties from source into target,
   * but only if target does not already have a property of the same name.
   */
  function mixin(target, source, force, deepStringMixin) {
    if (source) {
      eachProp(source, function (value, prop) {
        if (force || !hasProp(target, prop)) {
          if (deepStringMixin && typeof value !== 'string') {
            if (!target[prop]) {
              target[prop] = {};
            }
            mixin(target[prop], value, force, deepStringMixin);
          } else {
            target[prop] = value;
          }
        }
      });
    }
    return target;
  }

  //Similar to Function.prototype.bind, but the 'this' object is specified
  //first, since it is easier to read/figure out what 'this' will be.
  function bind(obj, fn) {
    return function () {
      return fn.apply(obj, arguments);
    };
  }

  function scripts() {
    return document.getElementsByTagName('script');
  }

  function defaultOnError(err) {
    throw err;
  }

  //Allow getting a global that expressed in
  //dot notation, like 'a.b.c'.
  function getGlobal(value) {
    if (!value) {
      return value;
    }
    var g = global;
    each(value.split('.'), function (part) {
      g = g[part];
    });
    return g;
  }

  /**
   * Constructs an error with a pointer to an URL with more information.
   * @param {String} id the error ID that maps to an ID on a web page.
   * @param {String} message human readable error.
   * @param {Error} [err] the original error, if there is one.
   *
   * @returns {Error}
   */
  function makeError(id, msg, err, requireModules) {
    var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
    e.requireType = id;
    e.requireModules = requireModules;
    if (err) {
      e.originalError = err;
    }
    return e;
  }

  if (typeof define !== 'undefined') {
    //If a define is already in play via another AMD loader,
    //do not overwrite.
    return;
  }

  if (typeof requirejs !== 'undefined') {
    if (isFunction(requirejs)) {
      //Do not overwrite and existing requirejs instance.
      return;
    }
    cfg = requirejs;
    requirejs = undefined;
  }

  //Allow for a require config object
  if (typeof require !== 'undefined' && !isFunction(require)) {
    //assume it is a config object.
    cfg = require;
    require = undefined;
  }

  function newContext(contextName) {
    var inCheckLoaded, Module, context, handlers,
      checkLoadedTimeoutId,
      config = {
        //Defaults. Do not set a default for map
        //config to speed up normalize(), which
        //will run faster if there is no default.
        waitSeconds: 7,
        baseUrl: './',
        paths: {},
        pkgs: {},
        shim: {},
        config: {}
      },
      registry = {},
    //registry of just enabled modules, to speed
    //cycle breaking code when lots of modules
    //are registered, but not activated.
      enabledRegistry = {},
      undefEvents = {},
      defQueue = [],
      defined = {},
      urlFetched = {},
      requireCounter = 1,
      unnormalizedCounter = 1;

    /**
     * Trims the . and .. from an array of path segments.
     * It will keep a leading path segment if a .. will become
     * the first path segment, to help with module name lookups,
     * which act like paths, but can be remapped. But the end result,
     * all paths that use this function should look normalized.
     * NOTE: this method MODIFIES the input array.
     * @param {Array} ary the array of path segments.
     */
    function trimDots(ary) {
      var i, part;
      for (i = 0; ary[i]; i += 1) {
        part = ary[i];
        if (part === '.') {
          ary.splice(i, 1);
          i -= 1;
        } else if (part === '..') {
          if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
            //End of the line. Keep at least one non-dot
            //path segment at the front so it can be mapped
            //correctly to disk. Otherwise, there is likely
            //no path mapping for a path starting with '..'.
            //This can still fail, but catches the most reasonable
            //uses of ..
            break;
          } else if (i > 0) {
            ary.splice(i - 1, 2);
            i -= 2;
          }
        }
      }
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @param {Boolean} applyMap apply the map config to the value. Should
     * only be done if this normalization is for a dependency ID.
     * @returns {String} normalized name
     */
    function normalize(name, baseName, applyMap) {
      var pkgName, pkgConfig, mapValue, nameParts, i, j, nameSegment,
        foundMap, foundI, foundStarMap, starI,
        baseParts = baseName && baseName.split('/'),
        normalizedBaseParts = baseParts,
        map = config.map,
        starMap = map && map['*'];

      //Adjust any relative paths.
      if (name && name.charAt(0) === '.') {
        //If have a base name, try to normalize against it,
        //otherwise, assume it is a top-level require that will
        //be relative to baseUrl in the end.
        if (baseName) {
          if (getOwn(config.pkgs, baseName)) {
            //If the baseName is a package name, then just treat it as one
            //name to concat the name with.
            normalizedBaseParts = baseParts = [baseName];
          } else {
            //Convert baseName to array, and lop off the last part,
            //so that . matches that 'directory' and not name of the baseName's
            //module. For instance, baseName of 'one/two/three', maps to
            //'one/two/three.js', but we want the directory, 'one/two' for
            //this normalization.
            normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
          }

          name = normalizedBaseParts.concat(name.split('/'));
          trimDots(name);

          //Some use of packages may use a . path to reference the
          //'main' module name, so normalize for that.
          pkgConfig = getOwn(config.pkgs, (pkgName = name[0]));
          name = name.join('/');
          if (pkgConfig && name === pkgName + '/' + pkgConfig.main) {
            name = pkgName;
          }
        } else if (name.indexOf('./') === 0) {
          // No baseName, so this is ID is resolved relative
          // to baseUrl, pull off the leading dot.
          name = name.substring(2);
        }
      }

      //Apply map config if available.
      if (applyMap && map && (baseParts || starMap)) {
        nameParts = name.split('/');

        for (i = nameParts.length; i > 0; i -= 1) {
          nameSegment = nameParts.slice(0, i).join('/');

          if (baseParts) {
            //Find the longest baseName segment match in the config.
            //So, do joins on the biggest to smallest lengths of baseParts.
            for (j = baseParts.length; j > 0; j -= 1) {
              mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

              //baseName segment has config, find if it has one for
              //this name.
              if (mapValue) {
                mapValue = getOwn(mapValue, nameSegment);
                if (mapValue) {
                  //Match, update name to the new value.
                  foundMap = mapValue;
                  foundI = i;
                  break;
                }
              }
            }
          }

          if (foundMap) {
            break;
          }

          //Check for a star map match, but just hold on to it,
          //if there is a shorter segment match later in a matching
          //config, then favor over this star map.
          if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
            foundStarMap = getOwn(starMap, nameSegment);
            starI = i;
          }
        }

        if (!foundMap && foundStarMap) {
          foundMap = foundStarMap;
          foundI = starI;
        }

        if (foundMap) {
          nameParts.splice(0, foundI, foundMap);
          name = nameParts.join('/');
        }
      }

      return name;
    }

    function removeScript(name) {
      if (isBrowser) {
        each(scripts(), function (scriptNode) {
          if (scriptNode.getAttribute('data-requiremodule') === name &&
            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
            scriptNode.parentNode.removeChild(scriptNode);
            return true;
          }
        });
      }
    }

    function hasPathFallback(id) {
      var pathConfig = getOwn(config.paths, id);
      if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
        //Pop off the first array value, since it failed, and
        //retry
        pathConfig.shift();
        context.require.undef(id);
        context.require([id]);
        return true;
      }
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
      var prefix,
        index = name ? name.indexOf('!') : -1;
      if (index > -1) {
        prefix = name.substring(0, index);
        name = name.substring(index + 1, name.length);
      }
      return [prefix, name];
    }

    /**
     * Creates a module mapping that includes plugin prefix, module
     * name, and path. If parentModuleMap is provided it will
     * also normalize the name via require.normalize()
     *
     * @param {String} name the module name
     * @param {String} [parentModuleMap] parent module map
     * for the module name, used to resolve relative names.
     * @param {Boolean} isNormalized: is the ID already normalized.
     * This is true if this call is done for a define() module ID.
     * @param {Boolean} applyMap: apply the map config to the ID.
     * Should only be true if this map is for a dependency.
     *
     * @returns {Object}
     */
    function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
      var url, pluginModule, suffix, nameParts,
        prefix = null,
        parentName = parentModuleMap ? parentModuleMap.name : null,
        originalName = name,
        isDefine = true,
        normalizedName = '';

      //If no name, then it means it is a require call, generate an
      //internal name.
      if (!name) {
        isDefine = false;
        name = '_@r' + (requireCounter += 1);
      }

      nameParts = splitPrefix(name);
      prefix = nameParts[0];
      name = nameParts[1];

      if (prefix) {
        prefix = normalize(prefix, parentName, applyMap);
        pluginModule = getOwn(defined, prefix);
      }

      //Account for relative paths if there is a base name.
      if (name) {
        if (prefix) {
          if (pluginModule && pluginModule.normalize) {
            //Plugin is loaded, use its normalize method.
            normalizedName = pluginModule.normalize(name, function (name) {
              return normalize(name, parentName, applyMap);
            });
          } else {
            normalizedName = normalize(name, parentName, applyMap);
          }
        } else {
          //A regular module.
          normalizedName = normalize(name, parentName, applyMap);

          //Normalized name may be a plugin ID due to map config
          //application in normalize. The map config values must
          //already be normalized, so do not need to redo that part.
          nameParts = splitPrefix(normalizedName);
          prefix = nameParts[0];
          normalizedName = nameParts[1];
          isNormalized = true;

          url = context.nameToUrl(normalizedName);
        }
      }

      //If the id is a plugin id that cannot be determined if it needs
      //normalization, stamp it with a unique ID so two matching relative
      //ids that may conflict can be separate.
      suffix = prefix && !pluginModule && !isNormalized ?
        '_unnormalized' + (unnormalizedCounter += 1) :
        '';

      return {
        prefix: prefix,
        name: normalizedName,
        parentMap: parentModuleMap,
        unnormalized: !!suffix,
        url: url,
        originalName: originalName,
        isDefine: isDefine,
        id: (prefix ?
          prefix + '!' + normalizedName :
          normalizedName) + suffix
      };
    }

    function getModule(depMap) {
      var id = depMap.id,
        mod = getOwn(registry, id);

      if (!mod) {
        mod = registry[id] = new context.Module(depMap);
      }

      return mod;
    }

    function on(depMap, name, fn) {
      var id = depMap.id,
        mod = getOwn(registry, id);

      if (hasProp(defined, id) &&
        (!mod || mod.defineEmitComplete)) {
        if (name === 'defined') {
          fn(defined[id]);
        }
      } else {
        mod = getModule(depMap);
        if (mod.error && name === 'error') {
          fn(mod.error);
        } else {
          mod.on(name, fn);
        }
      }
    }

    function onError(err, errback) {
      var ids = err.requireModules,
        notified = false;

      if (errback) {
        errback(err);
      } else {
        each(ids, function (id) {
          var mod = getOwn(registry, id);
          if (mod) {
            //Set error on module, so it skips timeout checks.
            mod.error = err;
            if (mod.events.error) {
              notified = true;
              mod.emit('error', err);
            }
          }
        });

        if (!notified) {
          req.onError(err);
        }
      }
    }

    /**
     * Internal method to transfer globalQueue items to this context's
     * defQueue.
     */
    function takeGlobalQueue() {
      //Push all the globalDefQueue items into the context's defQueue
      if (globalDefQueue.length) {
        //Array splice in the values since the context code has a
        //local var ref to defQueue, so cannot just reassign the one
        //on context.
        apsp.apply(defQueue,
          [defQueue.length - 1, 0].concat(globalDefQueue));
        globalDefQueue = [];
      }
    }

    handlers = {
      'require': function (mod) {
        if (mod.require) {
          return mod.require;
        } else {
          return (mod.require = context.makeRequire(mod.map));
        }
      },
      'exports': function (mod) {
        mod.usingExports = true;
        if (mod.map.isDefine) {
          if (mod.exports) {
            return mod.exports;
          } else {
            return (mod.exports = defined[mod.map.id] = {});
          }
        }
      },
      'module': function (mod) {
        if (mod.module) {
          return mod.module;
        } else {
          return (mod.module = {
            id: mod.map.id,
            uri: mod.map.url,
            config: function () {
              var c,
                pkg = getOwn(config.pkgs, mod.map.id);
              // For packages, only support config targeted
              // at the main module.
              c = pkg ? getOwn(config.config, mod.map.id + '/' + pkg.main) :
                getOwn(config.config, mod.map.id);
              return  c || {};
            },
            exports: defined[mod.map.id]
          });
        }
      }
    };

    function cleanRegistry(id) {
      //Clean up machinery used for waiting modules.
      delete registry[id];
      delete enabledRegistry[id];
    }

    function breakCycle(mod, traced, processed) {
      var id = mod.map.id;

      if (mod.error) {
        mod.emit('error', mod.error);
      } else {
        traced[id] = true;
        each(mod.depMaps, function (depMap, i) {
          var depId = depMap.id,
            dep = getOwn(registry, depId);

          //Only force things that have not completed
          //being defined, so still in the registry,
          //and only if it has not been matched up
          //in the module already.
          if (dep && !mod.depMatched[i] && !processed[depId]) {
            if (getOwn(traced, depId)) {
              mod.defineDep(i, defined[depId]);
              mod.check(); //pass false?
            } else {
              breakCycle(dep, traced, processed);
            }
          }
        });
        processed[id] = true;
      }
    }

    function checkLoaded() {
      var map, modId, err, usingPathFallback,
        waitInterval = config.waitSeconds * 1000,
      //It is possible to disable the wait interval by using waitSeconds of 0.
        expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
        noLoads = [],
        reqCalls = [],
        stillLoading = false,
        needCycleCheck = true;

      //Do not bother if this call was a result of a cycle break.
      if (inCheckLoaded) {
        return;
      }

      inCheckLoaded = true;

      //Figure out the state of all the modules.
      eachProp(enabledRegistry, function (mod) {
        map = mod.map;
        modId = map.id;

        //Skip things that are not enabled or in error state.
        if (!mod.enabled) {
          return;
        }

        if (!map.isDefine) {
          reqCalls.push(mod);
        }

        if (!mod.error) {
          //If the module should be executed, and it has not
          //been inited and time is up, remember it.
          if (!mod.inited && expired) {
            if (hasPathFallback(modId)) {
              usingPathFallback = true;
              stillLoading = true;
            } else {
              noLoads.push(modId);
              removeScript(modId);
            }
          } else if (!mod.inited && mod.fetched && map.isDefine) {
            stillLoading = true;
            if (!map.prefix) {
              //No reason to keep looking for unfinished
              //loading. If the only stillLoading is a
              //plugin resource though, keep going,
              //because it may be that a plugin resource
              //is waiting on a non-plugin cycle.
              return (needCycleCheck = false);
            }
          }
        }
      });

      if (expired && noLoads.length) {
        //If wait time expired, throw error of unloaded modules.
        err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
        err.contextName = context.contextName;
        return onError(err);
      }

      //Not expired, check for a cycle.
      if (needCycleCheck) {
        each(reqCalls, function (mod) {
          breakCycle(mod, {}, {});
        });
      }

      //If still waiting on loads, and the waiting load is something
      //other than a plugin resource, or there are still outstanding
      //scripts, then just try back later.
      if ((!expired || usingPathFallback) && stillLoading) {
        //Something is still waiting to load. Wait for it, but only
        //if a timeout is not already in effect.
        if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
          checkLoadedTimeoutId = setTimeout(function () {
            checkLoadedTimeoutId = 0;
            checkLoaded();
          }, 50);
        }
      }

      inCheckLoaded = false;
    }

    Module = function (map) {
      this.events = getOwn(undefEvents, map.id) || {};
      this.map = map;
      this.shim = getOwn(config.shim, map.id);
      this.depExports = [];
      this.depMaps = [];
      this.depMatched = [];
      this.pluginMaps = {};
      this.depCount = 0;

      /* this.exports this.factory
       this.depMaps = [],
       this.enabled, this.fetched
       */
    };

    Module.prototype = {
      init: function (depMaps, factory, errback, options) {
        options = options || {};

        //Do not do more inits if already done. Can happen if there
        //are multiple define calls for the same module. That is not
        //a normal, common case, but it is also not unexpected.
        if (this.inited) {
          return;
        }

        this.factory = factory;

        if (errback) {
          //Register for errors on this module.
          this.on('error', errback);
        } else if (this.events.error) {
          //If no errback already, but there are error listeners
          //on this module, set up an errback to pass to the deps.
          errback = bind(this, function (err) {
            this.emit('error', err);
          });
        }

        //Do a copy of the dependency array, so that
        //source inputs are not modified. For example
        //"shim" deps are passed in here directly, and
        //doing a direct modification of the depMaps array
        //would affect that config.
        this.depMaps = depMaps && depMaps.slice(0);

        this.errback = errback;

        //Indicate this module has be initialized
        this.inited = true;

        this.ignore = options.ignore;

        //Could have option to init this module in enabled mode,
        //or could have been previously marked as enabled. However,
        //the dependencies are not known until init is called. So
        //if enabled previously, now trigger dependencies as enabled.
        if (options.enabled || this.enabled) {
          //Enable this module and dependencies.
          //Will call this.check()
          this.enable();
        } else {
          this.check();
        }
      },

      defineDep: function (i, depExports) {
        //Because of cycles, defined callback for a given
        //export can be called more than once.
        if (!this.depMatched[i]) {
          this.depMatched[i] = true;
          this.depCount -= 1;
          this.depExports[i] = depExports;
        }
      },

      fetch: function () {
        if (this.fetched) {
          return;
        }
        this.fetched = true;

        context.startTime = (new Date()).getTime();

        var map = this.map;

        //If the manager is for a plugin managed resource,
        //ask the plugin to load it now.
        if (this.shim) {
          context.makeRequire(this.map, {
            enableBuildCallback: true
          })(this.shim.deps || [], bind(this, function () {
              return map.prefix ? this.callPlugin() : this.load();
            }));
        } else {
          //Regular dependency.
          return map.prefix ? this.callPlugin() : this.load();
        }
      },

      load: function () {
        var url = this.map.url;

        //Regular dependency.
        if (!urlFetched[url]) {
          urlFetched[url] = true;
          context.load(this.map.id, url);
        }
      },

      /**
       * Checks if the module is ready to define itself, and if so,
       * define it.
       */
      check: function () {
        if (!this.enabled || this.enabling) {
          return;
        }

        var err, cjsModule,
          id = this.map.id,
          depExports = this.depExports,
          exports = this.exports,
          factory = this.factory;

        if (!this.inited) {
          this.fetch();
        } else if (this.error) {
          this.emit('error', this.error);
        } else if (!this.defining) {
          //The factory could trigger another require call
          //that would result in checking this module to
          //define itself again. If already in the process
          //of doing that, skip this work.
          this.defining = true;

          if (this.depCount < 1 && !this.defined) {
            if (isFunction(factory)) {
              //If there is an error listener, favor passing
              //to that instead of throwing an error. However,
              //only do it for define()'d  modules. require
              //errbacks should not be called for failures in
              //their callbacks (#699). However if a global
              //onError is set, use that.
              if ((this.events.error && this.map.isDefine) ||
                req.onError !== defaultOnError) {
                try {
                  exports = context.execCb(id, factory, depExports, exports);
                } catch (e) {
                  err = e;
                }
              } else {
                exports = context.execCb(id, factory, depExports, exports);
              }

              if (this.map.isDefine) {
                //If setting exports via 'module' is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                cjsModule = this.module;
                if (cjsModule &&
                  cjsModule.exports !== undefined &&
                  //Make sure it is not already the exports value
                  cjsModule.exports !== this.exports) {
                  exports = cjsModule.exports;
                } else if (exports === undefined && this.usingExports) {
                  //exports already set the defined value.
                  exports = this.exports;
                }
              }

              if (err) {
                err.requireMap = this.map;
                err.requireModules = this.map.isDefine ? [this.map.id] : null;
                err.requireType = this.map.isDefine ? 'define' : 'require';
                return onError((this.error = err));
              }

            } else {
              //Just a literal value
              exports = factory;
            }

            this.exports = exports;

            if (this.map.isDefine && !this.ignore) {
              defined[id] = exports;

              if (req.onResourceLoad) {
                req.onResourceLoad(context, this.map, this.depMaps);
              }
            }

            //Clean up
            cleanRegistry(id);

            this.defined = true;
          }

          //Finished the define stage. Allow calling check again
          //to allow define notifications below in the case of a
          //cycle.
          this.defining = false;

          if (this.defined && !this.defineEmitted) {
            this.defineEmitted = true;
            this.emit('defined', this.exports);
            this.defineEmitComplete = true;
          }

        }
      },

      callPlugin: function () {
        var map = this.map,
          id = map.id,
        //Map already normalized the prefix.
          pluginMap = makeModuleMap(map.prefix);

        //Mark this as a dependency for this plugin, so it
        //can be traced for cycles.
        this.depMaps.push(pluginMap);

        on(pluginMap, 'defined', bind(this, function (plugin) {
          var load, normalizedMap, normalizedMod,
            name = this.map.name,
            parentName = this.map.parentMap ? this.map.parentMap.name : null,
            localRequire = context.makeRequire(map.parentMap, {
              enableBuildCallback: true
            });

          //If current map is not normalized, wait for that
          //normalized name to load instead of continuing.
          if (this.map.unnormalized) {
            //Normalize the ID if the plugin allows it.
            if (plugin.normalize) {
              name = plugin.normalize(name, function (name) {
                return normalize(name, parentName, true);
              }) || '';
            }

            //prefix and name should already be normalized, no need
            //for applying map config again either.
            normalizedMap = makeModuleMap(map.prefix + '!' + name,
              this.map.parentMap);
            on(normalizedMap,
              'defined', bind(this, function (value) {
                this.init([], function () { return value; }, null, {
                  enabled: true,
                  ignore: true
                });
              }));

            normalizedMod = getOwn(registry, normalizedMap.id);
            if (normalizedMod) {
              //Mark this as a dependency for this plugin, so it
              //can be traced for cycles.
              this.depMaps.push(normalizedMap);

              if (this.events.error) {
                normalizedMod.on('error', bind(this, function (err) {
                  this.emit('error', err);
                }));
              }
              normalizedMod.enable();
            }

            return;
          }

          load = bind(this, function (value) {
            this.init([], function () { return value; }, null, {
              enabled: true
            });
          });

          load.error = bind(this, function (err) {
            this.inited = true;
            this.error = err;
            err.requireModules = [id];

            //Remove temp unnormalized modules for this module,
            //since they will never be resolved otherwise now.
            eachProp(registry, function (mod) {
              if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                cleanRegistry(mod.map.id);
              }
            });

            onError(err);
          });

          //Allow plugins to load other code without having to know the
          //context or how to 'complete' the load.
          load.fromText = bind(this, function (text, textAlt) {
            /*jslint evil: true */
            var moduleName = map.name,
              moduleMap = makeModuleMap(moduleName),
              hasInteractive = useInteractive;

            //As of 2.1.0, support just passing the text, to reinforce
            //fromText only being called once per resource. Still
            //support old style of passing moduleName but discard
            //that moduleName in favor of the internal ref.
            if (textAlt) {
              text = textAlt;
            }

            //Turn off interactive script matching for IE for any define
            //calls in the text, then turn it back on at the end.
            if (hasInteractive) {
              useInteractive = false;
            }

            //Prime the system by creating a module instance for
            //it.
            getModule(moduleMap);

            //Transfer any config to this other module.
            if (hasProp(config.config, id)) {
              config.config[moduleName] = config.config[id];
            }

            try {
              req.exec(text);
            } catch (e) {
              return onError(makeError('fromtexteval',
                'fromText eval for ' + id +
                  ' failed: ' + e,
                e,
                [id]));
            }

            if (hasInteractive) {
              useInteractive = true;
            }

            //Mark this as a dependency for the plugin
            //resource
            this.depMaps.push(moduleMap);

            //Support anonymous modules.
            context.completeLoad(moduleName);

            //Bind the value of that module to the value for this
            //resource ID.
            localRequire([moduleName], load);
          });

          //Use parentName here since the plugin's name is not reliable,
          //could be some weird string with no path that actually wants to
          //reference the parentName's path.
          plugin.load(map.name, localRequire, load, config);
        }));

        context.enable(pluginMap, this);
        this.pluginMaps[pluginMap.id] = pluginMap;
      },

      enable: function () {
        enabledRegistry[this.map.id] = this;
        this.enabled = true;

        //Set flag mentioning that the module is enabling,
        //so that immediate calls to the defined callbacks
        //for dependencies do not trigger inadvertent load
        //with the depCount still being zero.
        this.enabling = true;

        //Enable each dependency
        each(this.depMaps, bind(this, function (depMap, i) {
          var id, mod, handler;

          if (typeof depMap === 'string') {
            //Dependency needs to be converted to a depMap
            //and wired up to this module.
            depMap = makeModuleMap(depMap,
              (this.map.isDefine ? this.map : this.map.parentMap),
              false,
              !this.skipMap);
            this.depMaps[i] = depMap;

            handler = getOwn(handlers, depMap.id);

            if (handler) {
              this.depExports[i] = handler(this);
              return;
            }

            this.depCount += 1;

            on(depMap, 'defined', bind(this, function (depExports) {
              this.defineDep(i, depExports);
              this.check();
            }));

            if (this.errback) {
              on(depMap, 'error', bind(this, this.errback));
            }
          }

          id = depMap.id;
          mod = registry[id];

          //Skip special modules like 'require', 'exports', 'module'
          //Also, don't call enable if it is already enabled,
          //important in circular dependency cases.
          if (!hasProp(handlers, id) && mod && !mod.enabled) {
            context.enable(depMap, this);
          }
        }));

        //Enable each plugin that is used in
        //a dependency
        eachProp(this.pluginMaps, bind(this, function (pluginMap) {
          var mod = getOwn(registry, pluginMap.id);
          if (mod && !mod.enabled) {
            context.enable(pluginMap, this);
          }
        }));

        this.enabling = false;

        this.check();
      },

      on: function (name, cb) {
        var cbs = this.events[name];
        if (!cbs) {
          cbs = this.events[name] = [];
        }
        cbs.push(cb);
      },

      emit: function (name, evt) {
        each(this.events[name], function (cb) {
          cb(evt);
        });
        if (name === 'error') {
          //Now that the error handler was triggered, remove
          //the listeners, since this broken Module instance
          //can stay around for a while in the registry.
          delete this.events[name];
        }
      }
    };

    function callGetModule(args) {
      //Skip modules already defined.
      if (!hasProp(defined, args[0])) {
        getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
      }
    }

    function removeListener(node, func, name, ieName) {
      //Favor detachEvent because of IE9
      //issue, see attachEvent/addEventListener comment elsewhere
      //in this file.
      if (node.detachEvent && !isOpera) {
        //Probably IE. If not it will throw an error, which will be
        //useful to know.
        if (ieName) {
          node.detachEvent(ieName, func);
        }
      } else {
        node.removeEventListener(name, func, false);
      }
    }

    /**
     * Given an event from a script node, get the requirejs info from it,
     * and then removes the event listeners on the node.
     * @param {Event} evt
     * @returns {Object}
     */
    function getScriptData(evt) {
      //Using currentTarget instead of target for Firefox 2.0's sake. Not
      //all old browsers will be supported, but this one was easy enough
      //to support and still makes sense.
      var node = evt.currentTarget || evt.srcElement;

      //Remove the listeners once here.
      removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
      removeListener(node, context.onScriptError, 'error');

      return {
        node: node,
        id: node && node.getAttribute('data-requiremodule')
      };
    }

    function intakeDefines() {
      var args;

      //Any defined modules in the global queue, intake them now.
      takeGlobalQueue();

      //Make sure any remaining defQueue items get properly processed.
      while (defQueue.length) {
        args = defQueue.shift();
        if (args[0] === null) {
          return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
        } else {
          //args are id, deps, factory. Should be normalized by the
          //define() function.
          callGetModule(args);
        }
      }
    }

    context = {
      config: config,
      contextName: contextName,
      registry: registry,
      defined: defined,
      urlFetched: urlFetched,
      defQueue: defQueue,
      Module: Module,
      makeModuleMap: makeModuleMap,
      nextTick: req.nextTick,
      onError: onError,

      /**
       * Set a configuration for the context.
       * @param {Object} cfg config object to integrate.
       */
      configure: function (cfg) {
        //Make sure the baseUrl ends in a slash.
        if (cfg.baseUrl) {
          if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
            cfg.baseUrl += '/';
          }
        }

        //Save off the paths and packages since they require special processing,
        //they are additive.
        var pkgs = config.pkgs,
          shim = config.shim,
          objs = {
            paths: true,
            config: true,
            map: true
          };

        eachProp(cfg, function (value, prop) {
          if (objs[prop]) {
            if (prop === 'map') {
              if (!config.map) {
                config.map = {};
              }
              mixin(config[prop], value, true, true);
            } else {
              mixin(config[prop], value, true);
            }
          } else {
            config[prop] = value;
          }
        });

        //Merge shim
        if (cfg.shim) {
          eachProp(cfg.shim, function (value, id) {
            //Normalize the structure
            if (isArray(value)) {
              value = {
                deps: value
              };
            }
            if ((value.exports || value.init) && !value.exportsFn) {
              value.exportsFn = context.makeShimExports(value);
            }
            shim[id] = value;
          });
          config.shim = shim;
        }

        //Adjust packages if necessary.
        if (cfg.packages) {
          each(cfg.packages, function (pkgObj) {
            var location;

            pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;
            location = pkgObj.location;

            //Create a brand new object on pkgs, since currentPackages can
            //be passed in again, and config.pkgs is the internal transformed
            //state for all package configs.
            pkgs[pkgObj.name] = {
              name: pkgObj.name,
              location: location || pkgObj.name,
              //Remove leading dot in main, so main paths are normalized,
              //and remove any trailing .js, since different package
              //envs have different conventions: some use a module name,
              //some use a file name.
              main: (pkgObj.main || 'main')
                .replace(currDirRegExp, '')
                .replace(jsSuffixRegExp, '')
            };
          });

          //Done with modifications, assing packages back to context config
          config.pkgs = pkgs;
        }

        //If there are any "waiting to execute" modules in the registry,
        //update the maps for them, since their info, like URLs to load,
        //may have changed.
        eachProp(registry, function (mod, id) {
          //If module already has init called, since it is too
          //late to modify them, and ignore unnormalized ones
          //since they are transient.
          if (!mod.inited && !mod.map.unnormalized) {
            mod.map = makeModuleMap(id);
          }
        });

        //If a deps array or a config callback is specified, then call
        //require with those args. This is useful when require is defined as a
        //config object before require.js is loaded.
        if (cfg.deps || cfg.callback) {
          context.require(cfg.deps || [], cfg.callback);
        }
      },

      makeShimExports: function (value) {
        function fn() {
          var ret;
          if (value.init) {
            ret = value.init.apply(global, arguments);
          }
          return ret || (value.exports && getGlobal(value.exports));
        }
        return fn;
      },

      makeRequire: function (relMap, options) {
        options = options || {};

        function localRequire(deps, callback, errback) {
          var id, map, requireMod;

          if (options.enableBuildCallback && callback && isFunction(callback)) {
            callback.__requireJsBuild = true;
          }

          if (typeof deps === 'string') {
            if (isFunction(callback)) {
              //Invalid call
              return onError(makeError('requireargs', 'Invalid require call'), errback);
            }

            //If require|exports|module are requested, get the
            //value for them from the special handlers. Caveat:
            //this only works while module is being defined.
            if (relMap && hasProp(handlers, deps)) {
              return handlers[deps](registry[relMap.id]);
            }

            //Synchronous access to one module. If require.get is
            //available (as in the Node adapter), prefer that.
            if (req.get) {
              return req.get(context, deps, relMap, localRequire);
            }

            //Normalize module name, if it contains . or ..
            map = makeModuleMap(deps, relMap, false, true);
            id = map.id;

            if (!hasProp(defined, id)) {
              return onError(makeError('notloaded', 'Module name "' +
                id +
                '" has not been loaded yet for context: ' +
                contextName +
                (relMap ? '' : '. Use require([])')));
            }
            return defined[id];
          }

          //Grab defines waiting in the global queue.
          intakeDefines();

          //Mark all the dependencies as needing to be loaded.
          context.nextTick(function () {
            //Some defines could have been added since the
            //require call, collect them.
            intakeDefines();

            requireMod = getModule(makeModuleMap(null, relMap));

            //Store if map config should be applied to this require
            //call for dependencies.
            requireMod.skipMap = options.skipMap;

            requireMod.init(deps, callback, errback, {
              enabled: true
            });

            checkLoaded();
          });

          return localRequire;
        }

        mixin(localRequire, {
          isBrowser: isBrowser,

          /**
           * Converts a module name + .extension into an URL path.
           * *Requires* the use of a module name. It does not support using
           * plain URLs like nameToUrl.
           */
          toUrl: function (moduleNamePlusExt) {
            var ext,
              index = moduleNamePlusExt.lastIndexOf('.'),
              segment = moduleNamePlusExt.split('/')[0],
              isRelative = segment === '.' || segment === '..';

            //Have a file extension alias, and it is not the
            //dots from a relative path.
            if (index !== -1 && (!isRelative || index > 1)) {
              ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
              moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
            }

            return context.nameToUrl(normalize(moduleNamePlusExt,
              relMap && relMap.id, true), ext,  true);
          },

          defined: function (id) {
            return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
          },

          specified: function (id) {
            id = makeModuleMap(id, relMap, false, true).id;
            return hasProp(defined, id) || hasProp(registry, id);
          }
        });

        //Only allow undef on top level require calls
        if (!relMap) {
          localRequire.undef = function (id) {
            //Bind any waiting define() calls to this context,
            //fix for #408
            takeGlobalQueue();

            var map = makeModuleMap(id, relMap, true),
              mod = getOwn(registry, id);

            removeScript(id);

            delete defined[id];
            delete urlFetched[map.url];
            delete undefEvents[id];

            if (mod) {
              //Hold on to listeners in case the
              //module will be attempted to be reloaded
              //using a different config.
              if (mod.events.defined) {
                undefEvents[id] = mod.events;
              }

              cleanRegistry(id);
            }
          };
        }

        return localRequire;
      },

      /**
       * Called to enable a module if it is still in the registry
       * awaiting enablement. A second arg, parent, the parent module,
       * is passed in for context, when this method is overriden by
       * the optimizer. Not shown here to keep code compact.
       */
      enable: function (depMap) {
        var mod = getOwn(registry, depMap.id);
        if (mod) {
          getModule(depMap).enable();
        }
      },

      /**
       * Internal method used by environment adapters to complete a load event.
       * A load event could be a script load or just a load pass from a synchronous
       * load call.
       * @param {String} moduleName the name of the module to potentially complete.
       */
      completeLoad: function (moduleName) {
        var found, args, mod,
          shim = getOwn(config.shim, moduleName) || {},
          shExports = shim.exports;

        takeGlobalQueue();

        while (defQueue.length) {
          args = defQueue.shift();
          if (args[0] === null) {
            args[0] = moduleName;
            //If already found an anonymous module and bound it
            //to this name, then this is some other anon module
            //waiting for its completeLoad to fire.
            if (found) {
              break;
            }
            found = true;
          } else if (args[0] === moduleName) {
            //Found matching define call for this script!
            found = true;
          }

          callGetModule(args);
        }

        //Do this after the cycle of callGetModule in case the result
        //of those calls/init calls changes the registry.
        mod = getOwn(registry, moduleName);

        if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
          if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
            if (hasPathFallback(moduleName)) {
              return;
            } else {
              return onError(makeError('nodefine',
                'No define call for ' + moduleName,
                null,
                [moduleName]));
            }
          } else {
            //A script that does not call define(), so just simulate
            //the call for it.
            callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
          }
        }

        checkLoaded();
      },

      /**
       * Converts a module name to a file path. Supports cases where
       * moduleName may actually be just an URL.
       * Note that it **does not** call normalize on the moduleName,
       * it is assumed to have already been normalized. This is an
       * internal API, not a public one. Use toUrl for the public API.
       */
      nameToUrl: function (moduleName, ext, skipExt) {
        var paths, pkgs, pkg, pkgPath, syms, i, parentModule, url,
          parentPath;

        //If a colon is in the URL, it indicates a protocol is used and it is just
        //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
        //or ends with .js, then assume the user meant to use an url and not a module id.
        //The slash is important for protocol-less URLs as well as full paths.
        if (req.jsExtRegExp.test(moduleName)) {
          //Just a plain path, not module name lookup, so just return it.
          //Add extension if it is included. This is a bit wonky, only non-.js things pass
          //an extension, this method probably needs to be reworked.
          url = moduleName + (ext || '');
        } else {
          //A module that needs to be converted to a path.
          paths = config.paths;
          pkgs = config.pkgs;

          syms = moduleName.split('/');
          //For each module name segment, see if there is a path
          //registered for it. Start with most specific name
          //and work up from it.
          for (i = syms.length; i > 0; i -= 1) {
            parentModule = syms.slice(0, i).join('/');
            pkg = getOwn(pkgs, parentModule);
            parentPath = getOwn(paths, parentModule);
            if (parentPath) {
              //If an array, it means there are a few choices,
              //Choose the one that is desired
              if (isArray(parentPath)) {
                parentPath = parentPath[0];
              }
              syms.splice(0, i, parentPath);
              break;
            } else if (pkg) {
              //If module name is just the package name, then looking
              //for the main module.
              if (moduleName === pkg.name) {
                pkgPath = pkg.location + '/' + pkg.main;
              } else {
                pkgPath = pkg.location;
              }
              syms.splice(0, i, pkgPath);
              break;
            }
          }

          //Join the path parts together, then figure out if baseUrl is needed.
          url = syms.join('/');
          url += (ext || (/^data\:|\?/.test(url) || skipExt ? '' : '.js'));
          url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
        }

        return config.urlArgs ? url +
          ((url.indexOf('?') === -1 ? '?' : '&') +
            config.urlArgs) : url;
      },

      //Delegates to req.load. Broken out as a separate function to
      //allow overriding in the optimizer.
      load: function (id, url) {
        req.load(context, id, url);
      },

      /**
       * Executes a module callback function. Broken out as a separate function
       * solely to allow the build system to sequence the files in the built
       * layer in the right sequence.
       *
       * @private
       */
      execCb: function (name, callback, args, exports) {
        return callback.apply(exports, args);
      },

      /**
       * callback for script loads, used to check status of loading.
       *
       * @param {Event} evt the event from the browser for the script
       * that was loaded.
       */
      onScriptLoad: function (evt) {
        //Using currentTarget instead of target for Firefox 2.0's sake. Not
        //all old browsers will be supported, but this one was easy enough
        //to support and still makes sense.
        if (evt.type === 'load' ||
          (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
          //Reset interactive script so a script node is not held onto for
          //to long.
          interactiveScript = null;

          //Pull out the name of the module and the context.
          var data = getScriptData(evt);
          context.completeLoad(data.id);
        }
      },

      /**
       * Callback for script errors.
       */
      onScriptError: function (evt) {
        var data = getScriptData(evt);
        if (!hasPathFallback(data.id)) {
          return onError(makeError('scripterror', 'Script error for: ' + data.id, evt, [data.id]));
        }
      }
    };

    context.require = context.makeRequire();
    return context;
  }

  /**
   * Main entry point.
   *
   * If the only argument to require is a string, then the module that
   * is represented by that string is fetched for the appropriate context.
   *
   * If the first argument is an array, then it will be treated as an array
   * of dependency string names to fetch. An optional function callback can
   * be specified to execute when all of those dependencies are available.
   *
   * Make a local req variable to help Caja compliance (it assumes things
   * on a require that are not standardized), and to give a short
   * name for minification/local scope use.
   */
  req = requirejs = function (deps, callback, errback, optional) {

    //Find the right context, use default
    var context, config,
      contextName = defContextName;

    // Determine if have config object in the call.
    if (!isArray(deps) && typeof deps !== 'string') {
      // deps is a config object
      config = deps;
      if (isArray(callback)) {
        // Adjust args if there are dependencies
        deps = callback;
        callback = errback;
        errback = optional;
      } else {
        deps = [];
      }
    }

    if (config && config.context) {
      contextName = config.context;
    }

    context = getOwn(contexts, contextName);
    if (!context) {
      context = contexts[contextName] = req.s.newContext(contextName);
    }

    if (config) {
      context.configure(config);
    }

    return context.require(deps, callback, errback);
  };

  /**
   * Support require.config() to make it easier to cooperate with other
   * AMD loaders on globally agreed names.
   */
  req.config = function (config) {
    return req(config);
  };

  /**
   * Execute something after the current tick
   * of the event loop. Override for other envs
   * that have a better solution than setTimeout.
   * @param  {Function} fn function to execute later.
   */
  req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
    setTimeout(fn, 4);
  } : function (fn) { fn(); };

  /**
   * Export require as a global, but only if it does not already exist.
   */
  if (!require) {
    require = req;
  }

  req.version = version;

  //Used to filter out dependencies that are already paths.
  req.jsExtRegExp = /^\/|:|\?|\.js$/;
  req.isBrowser = isBrowser;
  s = req.s = {
    contexts: contexts,
    newContext: newContext
  };

  //Create default context.
  req({});

  //Exports some context-sensitive methods on global require.
  each([
    'toUrl',
    'undef',
    'defined',
    'specified'
  ], function (prop) {
    //Reference from contexts instead of early binding to default context,
    //so that during builds, the latest instance of the default context
    //with its config gets used.
    req[prop] = function () {
      var ctx = contexts[defContextName];
      return ctx.require[prop].apply(ctx, arguments);
    };
  });

  if (isBrowser) {
    head = s.head = document.getElementsByTagName('head')[0];
    //If BASE tag is in play, using appendChild is a problem for IE6.
    //When that browser dies, this can be removed. Details in this jQuery bug:
    //http://dev.jquery.com/ticket/2709
    baseElement = document.getElementsByTagName('base')[0];
    if (baseElement) {
      head = s.head = baseElement.parentNode;
    }
  }

  /**
   * Any errors that require explicitly generates will be passed to this
   * function. Intercept/override it if you want custom error handling.
   * @param {Error} err the error object.
   */
  req.onError = defaultOnError;

  /**
   * Creates the node for the load command. Only used in browser envs.
   */
  req.createNode = function (config, moduleName, url) {
    var node = config.xhtml ?
      document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
      document.createElement('script');
    node.type = config.scriptType || 'text/javascript';
    node.charset = 'utf-8';
    node.async = true;
    return node;
  };

  /**
   * Does the request to load a module for the browser case.
   * Make this a separate function to allow other environments
   * to override it.
   *
   * @param {Object} context the require context to find state.
   * @param {String} moduleName the name of the module.
   * @param {Object} url the URL to the module.
   */
  req.load = function (context, moduleName, url) {
    var config = (context && context.config) || {},
      node;
    if (isBrowser) {
      //In the browser so use a script tag
      node = req.createNode(config, moduleName, url);

      node.setAttribute('data-requirecontext', context.contextName);
      node.setAttribute('data-requiremodule', moduleName);

      //Set up load listener. Test attachEvent first because IE9 has
      //a subtle issue in its addEventListener and script onload firings
      //that do not match the behavior of all other browsers with
      //addEventListener support, which fire the onload event for a
      //script right after the script execution. See:
      //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
      //UNFORTUNATELY Opera implements attachEvent but does not follow the script
      //script execution mode.
      if (node.attachEvent &&
        //Check if node.attachEvent is artificially added by custom script or
        //natively supported by browser
        //read https://github.com/jrburke/requirejs/issues/187
        //if we can NOT find [native code] then it must NOT natively supported.
        //in IE8, node.attachEvent does not have toString()
        //Note the test for "[native code" with no closing brace, see:
        //https://github.com/jrburke/requirejs/issues/273
        !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
        !isOpera) {
        //Probably IE. IE (at least 6-8) do not fire
        //script onload right after executing the script, so
        //we cannot tie the anonymous define call to a name.
        //However, IE reports the script as being in 'interactive'
        //readyState at the time of the define call.
        useInteractive = true;

        node.attachEvent('onreadystatechange', context.onScriptLoad);
        //It would be great to add an error handler here to catch
        //404s in IE9+. However, onreadystatechange will fire before
        //the error handler, so that does not help. If addEventListener
        //is used, then IE will fire error before load, but we cannot
        //use that pathway given the connect.microsoft.com issue
        //mentioned above about not doing the 'script execute,
        //then fire the script load event listener before execute
        //next script' that other browsers do.
        //Best hope: IE10 fixes the issues,
        //and then destroys all installs of IE 6-9.
        //node.attachEvent('onerror', context.onScriptError);
      } else {
        node.addEventListener('load', context.onScriptLoad, false);
        node.addEventListener('error', context.onScriptError, false);
      }
      node.src = url;

      //For some cache cases in IE 6-8, the script executes before the end
      //of the appendChild execution, so to tie an anonymous define
      //call to the module name (which is stored on the node), hold on
      //to a reference to this node, but clear after the DOM insertion.
      currentlyAddingScript = node;
      if (baseElement) {
        head.insertBefore(node, baseElement);
      } else {
        head.appendChild(node);
      }
      currentlyAddingScript = null;

      return node;
    } else if (isWebWorker) {
      try {
        //In a web worker, use importScripts. This is not a very
        //efficient use of importScripts, importScripts will block until
        //its script is downloaded and evaluated. However, if web workers
        //are in play, the expectation that a build has been done so that
        //only one script needs to be loaded anyway. This may need to be
        //reevaluated if other use cases become common.
        importScripts(url);

        //Account for anonymous modules
        context.completeLoad(moduleName);
      } catch (e) {
        context.onError(makeError('importscripts',
          'importScripts failed for ' +
            moduleName + ' at ' + url,
          e,
          [moduleName]));
      }
    }
  };

  function getInteractiveScript() {
    if (interactiveScript && interactiveScript.readyState === 'interactive') {
      return interactiveScript;
    }

    eachReverse(scripts(), function (script) {
      if (script.readyState === 'interactive') {
        return (interactiveScript = script);
      }
    });
    return interactiveScript;
  }

  //Look for a data-main script attribute, which could also adjust the baseUrl.
  if (isBrowser && !cfg.skipDataMain) {
    //Figure out baseUrl. Get it from the script tag with require.js in it.
    eachReverse(scripts(), function (script) {
      //Set the 'head' where we can append children by
      //using the script's parent.
      if (!head) {
        head = script.parentNode;
      }

      //Look for a data-main attribute to set main script for the page
      //to load. If it is there, the path to data main becomes the
      //baseUrl, if it is not already set.
      dataMain = script.getAttribute('data-main');
      if (dataMain) {
        //Preserve dataMain in case it is a path (i.e. contains '?')
        mainScript = dataMain;

        //Set final baseUrl if there is not already an explicit one.
        if (!cfg.baseUrl) {
          //Pull off the directory of data-main for use as the
          //baseUrl.
          src = mainScript.split('/');
          mainScript = src.pop();
          subPath = src.length ? src.join('/')  + '/' : './';

          cfg.baseUrl = subPath;
        }

        //Strip off any trailing .js since mainScript is now
        //like a module name.
        mainScript = mainScript.replace(jsSuffixRegExp, '');

        //If mainScript is still a path, fall back to dataMain
        if (req.jsExtRegExp.test(mainScript)) {
          mainScript = dataMain;
        }

        //Put the data-main script in the files to load.
        cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

        return true;
      }
    });
  }

  /**
   * The function that handles definitions of modules. Differs from
   * require() in that a string for the module should be the first argument,
   * and the function to execute after dependencies are loaded should
   * return a value to define the module corresponding to the first argument's
   * name.
   */
  define = function (name, deps, callback) {
    var node, context;

    //Allow for anonymous modules
    if (typeof name !== 'string') {
      //Adjust args appropriately
      callback = deps;
      deps = name;
      name = null;
    }

    //This module may not have dependencies
    if (!isArray(deps)) {
      callback = deps;
      deps = null;
    }

    //If no name, and callback is a function, then figure out if it a
    //CommonJS thing with dependencies.
    if (!deps && isFunction(callback)) {
      deps = [];
      //Remove comments from the callback string,
      //look for require calls, and pull them into the dependencies,
      //but only if there are function args.
      if (callback.length) {
        callback
          .toString()
          .replace(commentRegExp, '')
          .replace(cjsRequireRegExp, function (match, dep) {
            deps.push(dep);
          });

        //May be a CommonJS thing even without require calls, but still
        //could use exports, and module. Avoid doing exports and module
        //work though if it just needs require.
        //REQUIRES the function to expect the CommonJS variables in the
        //order listed below.
        deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
      }
    }

    //If in IE 6-8 and hit an anonymous define() call, do the interactive
    //work.
    if (useInteractive) {
      node = currentlyAddingScript || getInteractiveScript();
      if (node) {
        if (!name) {
          name = node.getAttribute('data-requiremodule');
        }
        context = contexts[node.getAttribute('data-requirecontext')];
      }
    }

    //Always save off evaluating the def call until the script onload handler.
    //This allows multiple modules to be in a file without prematurely
    //tracing dependencies, and allows for anonymous module support,
    //where the module name is not known until the script onload event
    //occurs. If no context, use the global queue, and get it processed
    //in the onscript load callback.
    (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
  };

  define.amd = {
    jQuery: true
  };


  /**
   * Executes the text. Normally just uses eval, but can be modified
   * to use a better, environment-specific call. Only used for transpiling
   * loader plugins, not for plain JS modules.
   * @param {String} text the text to execute/evaluate.
   */
  req.exec = function (text) {
    /*jslint evil: true */
    return eval(text);
  };

  //Set up with config info.
  req(cfg);
}(this));


/*!
 * jQuery JavaScript Library v2.0.3
 * http://jquery.com/
 *
 * Includes Sizzle.js
 * http://sizzlejs.com/
 *
 * Copyright 2005, 2013 jQuery Foundation, Inc. and other contributors
 * Released under the MIT license
 * http://jquery.org/license
 *
 * Date: 2013-07-03T13:30Z
 */
(function( window, undefined ) {

// Can't do this because several apps including ASP.NET trace
// the stack via arguments.caller.callee and Firefox dies if
// you try to trace through "use strict" call chains. (#13335)
// Support: Firefox 18+
//"use strict";
  var
  // A central reference to the root jQuery(document)
    rootjQuery,

  // The deferred used on DOM ready
    readyList,

  // Support: IE9
  // For `typeof xmlNode.method` instead of `xmlNode.method !== undefined`
    core_strundefined = typeof undefined,

  // Use the correct document accordingly with window argument (sandbox)
    location = window.location,
    document = window.document,
    docElem = document.documentElement,

  // Map over jQuery in case of overwrite
    _jQuery = window.jQuery,

  // Map over the $ in case of overwrite
    _$ = window.$,

  // [[Class]] -> type pairs
    class2type = {},

  // List of deleted data cache ids, so we can reuse them
    core_deletedIds = [],

    core_version = "2.0.3",

  // Save a reference to some core methods
    core_concat = core_deletedIds.concat,
    core_push = core_deletedIds.push,
    core_slice = core_deletedIds.slice,
    core_indexOf = core_deletedIds.indexOf,
    core_toString = class2type.toString,
    core_hasOwn = class2type.hasOwnProperty,
    core_trim = core_version.trim,

  // Define a local copy of jQuery
    jQuery = function( selector, context ) {
      // The jQuery object is actually just the init constructor 'enhanced'
      return new jQuery.fn.init( selector, context, rootjQuery );
    },

  // Used for matching numbers
    core_pnum = /[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/.source,

  // Used for splitting on whitespace
    core_rnotwhite = /\S+/g,

  // A simple way to check for HTML strings
  // Prioritize #id over <tag> to avoid XSS via location.hash (#9521)
  // Strict HTML recognition (#11290: must start with <)
    rquickExpr = /^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]*))$/,

  // Match a standalone tag
    rsingleTag = /^<(\w+)\s*\/?>(?:<\/\1>|)$/,

  // Matches dashed string for camelizing
    rmsPrefix = /^-ms-/,
    rdashAlpha = /-([\da-z])/gi,

  // Used by jQuery.camelCase as callback to replace()
    fcamelCase = function( all, letter ) {
      return letter.toUpperCase();
    },

  // The ready event handler and self cleanup method
    completed = function() {
      document.removeEventListener( "DOMContentLoaded", completed, false );
      window.removeEventListener( "load", completed, false );
      jQuery.ready();
    };

  jQuery.fn = jQuery.prototype = {
    // The current version of jQuery being used
    jquery: core_version,

    constructor: jQuery,
    init: function( selector, context, rootjQuery ) {
      var match, elem;

      // HANDLE: $(""), $(null), $(undefined), $(false)
      if ( !selector ) {
        return this;
      }

      // Handle HTML strings
      if ( typeof selector === "string" ) {
        if ( selector.charAt(0) === "<" && selector.charAt( selector.length - 1 ) === ">" && selector.length >= 3 ) {
          // Assume that strings that start and end with <> are HTML and skip the regex check
          match = [ null, selector, null ];

        } else {
          match = rquickExpr.exec( selector );
        }

        // Match html or make sure no context is specified for #id
        if ( match && (match[1] || !context) ) {

          // HANDLE: $(html) -> $(array)
          if ( match[1] ) {
            context = context instanceof jQuery ? context[0] : context;

            // scripts is true for back-compat
            jQuery.merge( this, jQuery.parseHTML(
              match[1],
              context && context.nodeType ? context.ownerDocument || context : document,
              true
            ) );

            // HANDLE: $(html, props)
            if ( rsingleTag.test( match[1] ) && jQuery.isPlainObject( context ) ) {
              for ( match in context ) {
                // Properties of context are called as methods if possible
                if ( jQuery.isFunction( this[ match ] ) ) {
                  this[ match ]( context[ match ] );

                  // ...and otherwise set as attributes
                } else {
                  this.attr( match, context[ match ] );
                }
              }
            }

            return this;

            // HANDLE: $(#id)
          } else {
            elem = document.getElementById( match[2] );

            // Check parentNode to catch when Blackberry 4.6 returns
            // nodes that are no longer in the document #6963
            if ( elem && elem.parentNode ) {
              // Inject the element directly into the jQuery object
              this.length = 1;
              this[0] = elem;
            }

            this.context = document;
            this.selector = selector;
            return this;
          }

          // HANDLE: $(expr, $(...))
        } else if ( !context || context.jquery ) {
          return ( context || rootjQuery ).find( selector );

          // HANDLE: $(expr, context)
          // (which is just equivalent to: $(context).find(expr)
        } else {
          return this.constructor( context ).find( selector );
        }

        // HANDLE: $(DOMElement)
      } else if ( selector.nodeType ) {
        this.context = this[0] = selector;
        this.length = 1;
        return this;

        // HANDLE: $(function)
        // Shortcut for document ready
      } else if ( jQuery.isFunction( selector ) ) {
        return rootjQuery.ready( selector );
      }

      if ( selector.selector !== undefined ) {
        this.selector = selector.selector;
        this.context = selector.context;
      }

      return jQuery.makeArray( selector, this );
    },

    // Start with an empty selector
    selector: "",

    // The default length of a jQuery object is 0
    length: 0,

    toArray: function() {
      return core_slice.call( this );
    },

    // Get the Nth element in the matched element set OR
    // Get the whole matched element set as a clean array
    get: function( num ) {
      return num == null ?

        // Return a 'clean' array
        this.toArray() :

        // Return just the object
        ( num < 0 ? this[ this.length + num ] : this[ num ] );
    },

    // Take an array of elements and push it onto the stack
    // (returning the new matched element set)
    pushStack: function( elems ) {

      // Build a new jQuery matched element set
      var ret = jQuery.merge( this.constructor(), elems );

      // Add the old object onto the stack (as a reference)
      ret.prevObject = this;
      ret.context = this.context;

      // Return the newly-formed element set
      return ret;
    },

    // Execute a callback for every element in the matched set.
    // (You can seed the arguments with an array of args, but this is
    // only used internally.)
    each: function( callback, args ) {
      return jQuery.each( this, callback, args );
    },

    ready: function( fn ) {
      // Add the callback
      jQuery.ready.promise().done( fn );

      return this;
    },

    slice: function() {
      return this.pushStack( core_slice.apply( this, arguments ) );
    },

    first: function() {
      return this.eq( 0 );
    },

    last: function() {
      return this.eq( -1 );
    },

    eq: function( i ) {
      var len = this.length,
        j = +i + ( i < 0 ? len : 0 );
      return this.pushStack( j >= 0 && j < len ? [ this[j] ] : [] );
    },

    map: function( callback ) {
      return this.pushStack( jQuery.map(this, function( elem, i ) {
        return callback.call( elem, i, elem );
      }));
    },

    end: function() {
      return this.prevObject || this.constructor(null);
    },

    // For internal use only.
    // Behaves like an Array's method, not like a jQuery method.
    push: core_push,
    sort: [].sort,
    splice: [].splice
  };

// Give the init function the jQuery prototype for later instantiation
  jQuery.fn.init.prototype = jQuery.fn;

  jQuery.extend = jQuery.fn.extend = function() {
    var options, name, src, copy, copyIsArray, clone,
      target = arguments[0] || {},
      i = 1,
      length = arguments.length,
      deep = false;

    // Handle a deep copy situation
    if ( typeof target === "boolean" ) {
      deep = target;
      target = arguments[1] || {};
      // skip the boolean and the target
      i = 2;
    }

    // Handle case when target is a string or something (possible in deep copy)
    if ( typeof target !== "object" && !jQuery.isFunction(target) ) {
      target = {};
    }

    // extend jQuery itself if only one argument is passed
    if ( length === i ) {
      target = this;
      --i;
    }

    for ( ; i < length; i++ ) {
      // Only deal with non-null/undefined values
      if ( (options = arguments[ i ]) != null ) {
        // Extend the base object
        for ( name in options ) {
          src = target[ name ];
          copy = options[ name ];

          // Prevent never-ending loop
          if ( target === copy ) {
            continue;
          }

          // Recurse if we're merging plain objects or arrays
          if ( deep && copy && ( jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)) ) ) {
            if ( copyIsArray ) {
              copyIsArray = false;
              clone = src && jQuery.isArray(src) ? src : [];

            } else {
              clone = src && jQuery.isPlainObject(src) ? src : {};
            }

            // Never move original objects, clone them
            target[ name ] = jQuery.extend( deep, clone, copy );

            // Don't bring in undefined values
          } else if ( copy !== undefined ) {
            target[ name ] = copy;
          }
        }
      }
    }

    // Return the modified object
    return target;
  };

  jQuery.extend({
    // Unique for each copy of jQuery on the page
    expando: "jQuery" + ( core_version + Math.random() ).replace( /\D/g, "" ),

    noConflict: function( deep ) {
      if ( window.$ === jQuery ) {
        window.$ = _$;
      }

      if ( deep && window.jQuery === jQuery ) {
        window.jQuery = _jQuery;
      }

      return jQuery;
    },

    // Is the DOM ready to be used? Set to true once it occurs.
    isReady: false,

    // A counter to track how many items to wait for before
    // the ready event fires. See #6781
    readyWait: 1,

    // Hold (or release) the ready event
    holdReady: function( hold ) {
      if ( hold ) {
        jQuery.readyWait++;
      } else {
        jQuery.ready( true );
      }
    },

    // Handle when the DOM is ready
    ready: function( wait ) {

      // Abort if there are pending holds or we're already ready
      if ( wait === true ? --jQuery.readyWait : jQuery.isReady ) {
        return;
      }

      // Remember that the DOM is ready
      jQuery.isReady = true;

      // If a normal DOM Ready event fired, decrement, and wait if need be
      if ( wait !== true && --jQuery.readyWait > 0 ) {
        return;
      }

      // If there are functions bound, to execute
      readyList.resolveWith( document, [ jQuery ] );

      // Trigger any bound ready events
      if ( jQuery.fn.trigger ) {
        jQuery( document ).trigger("ready").off("ready");
      }
    },

    // See test/unit/core.js for details concerning isFunction.
    // Since version 1.3, DOM methods and functions like alert
    // aren't supported. They return false on IE (#2968).
    isFunction: function( obj ) {
      return jQuery.type(obj) === "function";
    },

    isArray: Array.isArray,

    isWindow: function( obj ) {
      return obj != null && obj === obj.window;
    },

    isNumeric: function( obj ) {
      return !isNaN( parseFloat(obj) ) && isFinite( obj );
    },

    type: function( obj ) {
      if ( obj == null ) {
        return String( obj );
      }
      // Support: Safari <= 5.1 (functionish RegExp)
      return typeof obj === "object" || typeof obj === "function" ?
        class2type[ core_toString.call(obj) ] || "object" :
        typeof obj;
    },

    isPlainObject: function( obj ) {
      // Not plain objects:
      // - Any object or value whose internal [[Class]] property is not "[object Object]"
      // - DOM nodes
      // - window
      if ( jQuery.type( obj ) !== "object" || obj.nodeType || jQuery.isWindow( obj ) ) {
        return false;
      }

      // Support: Firefox <20
      // The try/catch suppresses exceptions thrown when attempting to access
      // the "constructor" property of certain host objects, ie. |window.location|
      // https://bugzilla.mozilla.org/show_bug.cgi?id=814622
      try {
        if ( obj.constructor &&
          !core_hasOwn.call( obj.constructor.prototype, "isPrototypeOf" ) ) {
          return false;
        }
      } catch ( e ) {
        return false;
      }

      // If the function hasn't returned already, we're confident that
      // |obj| is a plain object, created by {} or constructed with new Object
      return true;
    },

    isEmptyObject: function( obj ) {
      var name;
      for ( name in obj ) {
        return false;
      }
      return true;
    },

    error: function( msg ) {
      throw new Error( msg );
    },

    // data: string of html
    // context (optional): If specified, the fragment will be created in this context, defaults to document
    // keepScripts (optional): If true, will include scripts passed in the html string
    parseHTML: function( data, context, keepScripts ) {
      if ( !data || typeof data !== "string" ) {
        return null;
      }
      if ( typeof context === "boolean" ) {
        keepScripts = context;
        context = false;
      }
      context = context || document;

      var parsed = rsingleTag.exec( data ),
        scripts = !keepScripts && [];

      // Single tag
      if ( parsed ) {
        return [ context.createElement( parsed[1] ) ];
      }

      parsed = jQuery.buildFragment( [ data ], context, scripts );

      if ( scripts ) {
        jQuery( scripts ).remove();
      }

      return jQuery.merge( [], parsed.childNodes );
    },

    parseJSON: JSON.parse,

    // Cross-browser xml parsing
    parseXML: function( data ) {
      var xml, tmp;
      if ( !data || typeof data !== "string" ) {
        return null;
      }

      // Support: IE9
      try {
        tmp = new DOMParser();
        xml = tmp.parseFromString( data , "text/xml" );
      } catch ( e ) {
        xml = undefined;
      }

      if ( !xml || xml.getElementsByTagName( "parsererror" ).length ) {
        jQuery.error( "Invalid XML: " + data );
      }
      return xml;
    },

    noop: function() {},

    // Evaluates a script in a global context
    globalEval: function( code ) {
      var script,
        indirect = eval;

      code = jQuery.trim( code );

      if ( code ) {
        // If the code includes a valid, prologue position
        // strict mode pragma, execute code by injecting a
        // script tag into the document.
        if ( code.indexOf("use strict") === 1 ) {
          script = document.createElement("script");
          script.text = code;
          document.head.appendChild( script ).parentNode.removeChild( script );
        } else {
          // Otherwise, avoid the DOM node creation, insertion
          // and removal by using an indirect global eval
          indirect( code );
        }
      }
    },

    // Convert dashed to camelCase; used by the css and data modules
    // Microsoft forgot to hump their vendor prefix (#9572)
    camelCase: function( string ) {
      return string.replace( rmsPrefix, "ms-" ).replace( rdashAlpha, fcamelCase );
    },

    nodeName: function( elem, name ) {
      return elem.nodeName && elem.nodeName.toLowerCase() === name.toLowerCase();
    },

    // args is for internal usage only
    each: function( obj, callback, args ) {
      var value,
        i = 0,
        length = obj.length,
        isArray = isArraylike( obj );

      if ( args ) {
        if ( isArray ) {
          for ( ; i < length; i++ ) {
            value = callback.apply( obj[ i ], args );

            if ( value === false ) {
              break;
            }
          }
        } else {
          for ( i in obj ) {
            value = callback.apply( obj[ i ], args );

            if ( value === false ) {
              break;
            }
          }
        }

        // A special, fast, case for the most common use of each
      } else {
        if ( isArray ) {
          for ( ; i < length; i++ ) {
            value = callback.call( obj[ i ], i, obj[ i ] );

            if ( value === false ) {
              break;
            }
          }
        } else {
          for ( i in obj ) {
            value = callback.call( obj[ i ], i, obj[ i ] );

            if ( value === false ) {
              break;
            }
          }
        }
      }

      return obj;
    },

    trim: function( text ) {
      return text == null ? "" : core_trim.call( text );
    },

    // results is for internal usage only
    makeArray: function( arr, results ) {
      var ret = results || [];

      if ( arr != null ) {
        if ( isArraylike( Object(arr) ) ) {
          jQuery.merge( ret,
            typeof arr === "string" ?
              [ arr ] : arr
          );
        } else {
          core_push.call( ret, arr );
        }
      }

      return ret;
    },

    inArray: function( elem, arr, i ) {
      return arr == null ? -1 : core_indexOf.call( arr, elem, i );
    },

    merge: function( first, second ) {
      var l = second.length,
        i = first.length,
        j = 0;

      if ( typeof l === "number" ) {
        for ( ; j < l; j++ ) {
          first[ i++ ] = second[ j ];
        }
      } else {
        while ( second[j] !== undefined ) {
          first[ i++ ] = second[ j++ ];
        }
      }

      first.length = i;

      return first;
    },

    grep: function( elems, callback, inv ) {
      var retVal,
        ret = [],
        i = 0,
        length = elems.length;
      inv = !!inv;

      // Go through the array, only saving the items
      // that pass the validator function
      for ( ; i < length; i++ ) {
        retVal = !!callback( elems[ i ], i );
        if ( inv !== retVal ) {
          ret.push( elems[ i ] );
        }
      }

      return ret;
    },

    // arg is for internal usage only
    map: function( elems, callback, arg ) {
      var value,
        i = 0,
        length = elems.length,
        isArray = isArraylike( elems ),
        ret = [];

      // Go through the array, translating each of the items to their
      if ( isArray ) {
        for ( ; i < length; i++ ) {
          value = callback( elems[ i ], i, arg );

          if ( value != null ) {
            ret[ ret.length ] = value;
          }
        }

        // Go through every key on the object,
      } else {
        for ( i in elems ) {
          value = callback( elems[ i ], i, arg );

          if ( value != null ) {
            ret[ ret.length ] = value;
          }
        }
      }

      // Flatten any nested arrays
      return core_concat.apply( [], ret );
    },

    // A global GUID counter for objects
    guid: 1,

    // Bind a function to a context, optionally partially applying any
    // arguments.
    proxy: function( fn, context ) {
      var tmp, args, proxy;

      if ( typeof context === "string" ) {
        tmp = fn[ context ];
        context = fn;
        fn = tmp;
      }

      // Quick check to determine if target is callable, in the spec
      // this throws a TypeError, but we will just return undefined.
      if ( !jQuery.isFunction( fn ) ) {
        return undefined;
      }

      // Simulated bind
      args = core_slice.call( arguments, 2 );
      proxy = function() {
        return fn.apply( context || this, args.concat( core_slice.call( arguments ) ) );
      };

      // Set the guid of unique handler to the same of original handler, so it can be removed
      proxy.guid = fn.guid = fn.guid || jQuery.guid++;

      return proxy;
    },

    // Multifunctional method to get and set values of a collection
    // The value/s can optionally be executed if it's a function
    access: function( elems, fn, key, value, chainable, emptyGet, raw ) {
      var i = 0,
        length = elems.length,
        bulk = key == null;

      // Sets many values
      if ( jQuery.type( key ) === "object" ) {
        chainable = true;
        for ( i in key ) {
          jQuery.access( elems, fn, i, key[i], true, emptyGet, raw );
        }

        // Sets one value
      } else if ( value !== undefined ) {
        chainable = true;

        if ( !jQuery.isFunction( value ) ) {
          raw = true;
        }

        if ( bulk ) {
          // Bulk operations run against the entire set
          if ( raw ) {
            fn.call( elems, value );
            fn = null;

            // ...except when executing function values
          } else {
            bulk = fn;
            fn = function( elem, key, value ) {
              return bulk.call( jQuery( elem ), value );
            };
          }
        }

        if ( fn ) {
          for ( ; i < length; i++ ) {
            fn( elems[i], key, raw ? value : value.call( elems[i], i, fn( elems[i], key ) ) );
          }
        }
      }

      return chainable ?
        elems :

        // Gets
        bulk ?
          fn.call( elems ) :
          length ? fn( elems[0], key ) : emptyGet;
    },

    now: Date.now,

    // A method for quickly swapping in/out CSS properties to get correct calculations.
    // Note: this method belongs to the css module but it's needed here for the support module.
    // If support gets modularized, this method should be moved back to the css module.
    swap: function( elem, options, callback, args ) {
      var ret, name,
        old = {};

      // Remember the old values, and insert the new ones
      for ( name in options ) {
        old[ name ] = elem.style[ name ];
        elem.style[ name ] = options[ name ];
      }

      ret = callback.apply( elem, args || [] );

      // Revert the old values
      for ( name in options ) {
        elem.style[ name ] = old[ name ];
      }

      return ret;
    }
  });

  jQuery.ready.promise = function( obj ) {
    if ( !readyList ) {

      readyList = jQuery.Deferred();

      // Catch cases where $(document).ready() is called after the browser event has already occurred.
      // we once tried to use readyState "interactive" here, but it caused issues like the one
      // discovered by ChrisS here: http://bugs.jquery.com/ticket/12282#comment:15
      if ( document.readyState === "complete" ) {
        // Handle it asynchronously to allow scripts the opportunity to delay ready
        setTimeout( jQuery.ready );

      } else {

        // Use the handy event callback
        document.addEventListener( "DOMContentLoaded", completed, false );

        // A fallback to window.onload, that will always work
        window.addEventListener( "load", completed, false );
      }
    }
    return readyList.promise( obj );
  };

// Populate the class2type map
  jQuery.each("Boolean Number String Function Array Date RegExp Object Error".split(" "), function(i, name) {
    class2type[ "[object " + name + "]" ] = name.toLowerCase();
  });

  function isArraylike( obj ) {
    var length = obj.length,
      type = jQuery.type( obj );

    if ( jQuery.isWindow( obj ) ) {
      return false;
    }

    if ( obj.nodeType === 1 && length ) {
      return true;
    }

    return type === "array" || type !== "function" &&
      ( length === 0 ||
        typeof length === "number" && length > 0 && ( length - 1 ) in obj );
  }

// All jQuery objects should point back to these
  rootjQuery = jQuery(document);
  /*!
   * Sizzle CSS Selector Engine v1.9.4-pre
   * http://sizzlejs.com/
   *
   * Copyright 2013 jQuery Foundation, Inc. and other contributors
   * Released under the MIT license
   * http://jquery.org/license
   *
   * Date: 2013-06-03
   */
  (function( window, undefined ) {

    var i,
      support,
      cachedruns,
      Expr,
      getText,
      isXML,
      compile,
      outermostContext,
      sortInput,

    // Local document vars
      setDocument,
      document,
      docElem,
      documentIsHTML,
      rbuggyQSA,
      rbuggyMatches,
      matches,
      contains,

    // Instance-specific data
      expando = "sizzle" + -(new Date()),
      preferredDoc = window.document,
      dirruns = 0,
      done = 0,
      classCache = createCache(),
      tokenCache = createCache(),
      compilerCache = createCache(),
      hasDuplicate = false,
      sortOrder = function( a, b ) {
        if ( a === b ) {
          hasDuplicate = true;
          return 0;
        }
        return 0;
      },

    // General-purpose constants
      strundefined = typeof undefined,
      MAX_NEGATIVE = 1 << 31,

    // Instance methods
      hasOwn = ({}).hasOwnProperty,
      arr = [],
      pop = arr.pop,
      push_native = arr.push,
      push = arr.push,
      slice = arr.slice,
    // Use a stripped-down indexOf if we can't use a native one
      indexOf = arr.indexOf || function( elem ) {
        var i = 0,
          len = this.length;
        for ( ; i < len; i++ ) {
          if ( this[i] === elem ) {
            return i;
          }
        }
        return -1;
      },

      booleans = "checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|ismap|loop|multiple|open|readonly|required|scoped",

    // Regular expressions

    // Whitespace characters http://www.w3.org/TR/css3-selectors/#whitespace
      whitespace = "[\\x20\\t\\r\\n\\f]",
    // http://www.w3.org/TR/css3-syntax/#characters
      characterEncoding = "(?:\\\\.|[\\w-]|[^\\x00-\\xa0])+",

    // Loosely modeled on CSS identifier characters
    // An unquoted value should be a CSS identifier http://www.w3.org/TR/css3-selectors/#attribute-selectors
    // Proper syntax: http://www.w3.org/TR/CSS21/syndata.html#value-def-identifier
      identifier = characterEncoding.replace( "w", "w#" ),

    // Acceptable operators http://www.w3.org/TR/selectors/#attribute-selectors
      attributes = "\\[" + whitespace + "*(" + characterEncoding + ")" + whitespace +
        "*(?:([*^$|!~]?=)" + whitespace + "*(?:(['\"])((?:\\\\.|[^\\\\])*?)\\3|(" + identifier + ")|)|)" + whitespace + "*\\]",

    // Prefer arguments quoted,
    //   then not containing pseudos/brackets,
    //   then attribute selectors/non-parenthetical expressions,
    //   then anything else
    // These preferences are here to reduce the number of selectors
    //   needing tokenize in the PSEUDO preFilter
      pseudos = ":(" + characterEncoding + ")(?:\\(((['\"])((?:\\\\.|[^\\\\])*?)\\3|((?:\\\\.|[^\\\\()[\\]]|" + attributes.replace( 3, 8 ) + ")*)|.*)\\)|)",

    // Leading and non-escaped trailing whitespace, capturing some non-whitespace characters preceding the latter
      rtrim = new RegExp( "^" + whitespace + "+|((?:^|[^\\\\])(?:\\\\.)*)" + whitespace + "+$", "g" ),

      rcomma = new RegExp( "^" + whitespace + "*," + whitespace + "*" ),
      rcombinators = new RegExp( "^" + whitespace + "*([>+~]|" + whitespace + ")" + whitespace + "*" ),

      rsibling = new RegExp( whitespace + "*[+~]" ),
      rattributeQuotes = new RegExp( "=" + whitespace + "*([^\\]'\"]*)" + whitespace + "*\\]", "g" ),

      rpseudo = new RegExp( pseudos ),
      ridentifier = new RegExp( "^" + identifier + "$" ),

      matchExpr = {
        "ID": new RegExp( "^#(" + characterEncoding + ")" ),
        "CLASS": new RegExp( "^\\.(" + characterEncoding + ")" ),
        "TAG": new RegExp( "^(" + characterEncoding.replace( "w", "w*" ) + ")" ),
        "ATTR": new RegExp( "^" + attributes ),
        "PSEUDO": new RegExp( "^" + pseudos ),
        "CHILD": new RegExp( "^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\(" + whitespace +
          "*(even|odd|(([+-]|)(\\d*)n|)" + whitespace + "*(?:([+-]|)" + whitespace +
          "*(\\d+)|))" + whitespace + "*\\)|)", "i" ),
        "bool": new RegExp( "^(?:" + booleans + ")$", "i" ),
        // For use in libraries implementing .is()
        // We use this for POS matching in `select`
        "needsContext": new RegExp( "^" + whitespace + "*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\(" +
          whitespace + "*((?:-\\d)?\\d*)" + whitespace + "*\\)|)(?=[^-]|$)", "i" )
      },

      rnative = /^[^{]+\{\s*\[native \w/,

    // Easily-parseable/retrievable ID or TAG or CLASS selectors
      rquickExpr = /^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,

      rinputs = /^(?:input|select|textarea|button)$/i,
      rheader = /^h\d$/i,

      rescape = /'|\\/g,

    // CSS escapes http://www.w3.org/TR/CSS21/syndata.html#escaped-characters
      runescape = new RegExp( "\\\\([\\da-f]{1,6}" + whitespace + "?|(" + whitespace + ")|.)", "ig" ),
      funescape = function( _, escaped, escapedWhitespace ) {
        var high = "0x" + escaped - 0x10000;
        // NaN means non-codepoint
        // Support: Firefox
        // Workaround erroneous numeric interpretation of +"0x"
        return high !== high || escapedWhitespace ?
          escaped :
          // BMP codepoint
          high < 0 ?
            String.fromCharCode( high + 0x10000 ) :
            // Supplemental Plane codepoint (surrogate pair)
            String.fromCharCode( high >> 10 | 0xD800, high & 0x3FF | 0xDC00 );
      };

// Optimize for push.apply( _, NodeList )
    try {
      push.apply(
        (arr = slice.call( preferredDoc.childNodes )),
        preferredDoc.childNodes
      );
      // Support: Android<4.0
      // Detect silently failing push.apply
      arr[ preferredDoc.childNodes.length ].nodeType;
    } catch ( e ) {
      push = { apply: arr.length ?

        // Leverage slice if possible
        function( target, els ) {
          push_native.apply( target, slice.call(els) );
        } :

        // Support: IE<9
        // Otherwise append directly
        function( target, els ) {
          var j = target.length,
            i = 0;
          // Can't trust NodeList.length
          while ( (target[j++] = els[i++]) ) {}
          target.length = j - 1;
        }
      };
    }

    function Sizzle( selector, context, results, seed ) {
      var match, elem, m, nodeType,
      // QSA vars
        i, groups, old, nid, newContext, newSelector;

      if ( ( context ? context.ownerDocument || context : preferredDoc ) !== document ) {
        setDocument( context );
      }

      context = context || document;
      results = results || [];

      if ( !selector || typeof selector !== "string" ) {
        return results;
      }

      if ( (nodeType = context.nodeType) !== 1 && nodeType !== 9 ) {
        return [];
      }

      if ( documentIsHTML && !seed ) {

        // Shortcuts
        if ( (match = rquickExpr.exec( selector )) ) {
          // Speed-up: Sizzle("#ID")
          if ( (m = match[1]) ) {
            if ( nodeType === 9 ) {
              elem = context.getElementById( m );
              // Check parentNode to catch when Blackberry 4.6 returns
              // nodes that are no longer in the document #6963
              if ( elem && elem.parentNode ) {
                // Handle the case where IE, Opera, and Webkit return items
                // by name instead of ID
                if ( elem.id === m ) {
                  results.push( elem );
                  return results;
                }
              } else {
                return results;
              }
            } else {
              // Context is not a document
              if ( context.ownerDocument && (elem = context.ownerDocument.getElementById( m )) &&
                contains( context, elem ) && elem.id === m ) {
                results.push( elem );
                return results;
              }
            }

            // Speed-up: Sizzle("TAG")
          } else if ( match[2] ) {
            push.apply( results, context.getElementsByTagName( selector ) );
            return results;

            // Speed-up: Sizzle(".CLASS")
          } else if ( (m = match[3]) && support.getElementsByClassName && context.getElementsByClassName ) {
            push.apply( results, context.getElementsByClassName( m ) );
            return results;
          }
        }

        // QSA path
        if ( support.qsa && (!rbuggyQSA || !rbuggyQSA.test( selector )) ) {
          nid = old = expando;
          newContext = context;
          newSelector = nodeType === 9 && selector;

          // qSA works strangely on Element-rooted queries
          // We can work around this by specifying an extra ID on the root
          // and working up from there (Thanks to Andrew Dupont for the technique)
          // IE 8 doesn't work on object elements
          if ( nodeType === 1 && context.nodeName.toLowerCase() !== "object" ) {
            groups = tokenize( selector );

            if ( (old = context.getAttribute("id")) ) {
              nid = old.replace( rescape, "\\$&" );
            } else {
              context.setAttribute( "id", nid );
            }
            nid = "[id='" + nid + "'] ";

            i = groups.length;
            while ( i-- ) {
              groups[i] = nid + toSelector( groups[i] );
            }
            newContext = rsibling.test( selector ) && context.parentNode || context;
            newSelector = groups.join(",");
          }

          if ( newSelector ) {
            try {
              push.apply( results,
                newContext.querySelectorAll( newSelector )
              );
              return results;
            } catch(qsaError) {
            } finally {
              if ( !old ) {
                context.removeAttribute("id");
              }
            }
          }
        }
      }

      // All others
      return select( selector.replace( rtrim, "$1" ), context, results, seed );
    }

    /**
     * Create key-value caches of limited size
     * @returns {Function(string, Object)} Returns the Object data after storing it on itself with
     *	property name the (space-suffixed) string and (if the cache is larger than Expr.cacheLength)
     *	deleting the oldest entry
     */
    function createCache() {
      var keys = [];

      function cache( key, value ) {
        // Use (key + " ") to avoid collision with native prototype properties (see Issue #157)
        if ( keys.push( key += " " ) > Expr.cacheLength ) {
          // Only keep the most recent entries
          delete cache[ keys.shift() ];
        }
        return (cache[ key ] = value);
      }
      return cache;
    }

    /**
     * Mark a function for special use by Sizzle
     * @param {Function} fn The function to mark
     */
    function markFunction( fn ) {
      fn[ expando ] = true;
      return fn;
    }

    /**
     * Support testing using an element
     * @param {Function} fn Passed the created div and expects a boolean result
     */
    function assert( fn ) {
      var div = document.createElement("div");

      try {
        return !!fn( div );
      } catch (e) {
        return false;
      } finally {
        // Remove from its parent by default
        if ( div.parentNode ) {
          div.parentNode.removeChild( div );
        }
        // release memory in IE
        div = null;
      }
    }

    /**
     * Adds the same handler for all of the specified attrs
     * @param {String} attrs Pipe-separated list of attributes
     * @param {Function} handler The method that will be applied
     */
    function addHandle( attrs, handler ) {
      var arr = attrs.split("|"),
        i = attrs.length;

      while ( i-- ) {
        Expr.attrHandle[ arr[i] ] = handler;
      }
    }

    /**
     * Checks document order of two siblings
     * @param {Element} a
     * @param {Element} b
     * @returns {Number} Returns less than 0 if a precedes b, greater than 0 if a follows b
     */
    function siblingCheck( a, b ) {
      var cur = b && a,
        diff = cur && a.nodeType === 1 && b.nodeType === 1 &&
          ( ~b.sourceIndex || MAX_NEGATIVE ) -
            ( ~a.sourceIndex || MAX_NEGATIVE );

      // Use IE sourceIndex if available on both nodes
      if ( diff ) {
        return diff;
      }

      // Check if b follows a
      if ( cur ) {
        while ( (cur = cur.nextSibling) ) {
          if ( cur === b ) {
            return -1;
          }
        }
      }

      return a ? 1 : -1;
    }

    /**
     * Returns a function to use in pseudos for input types
     * @param {String} type
     */
    function createInputPseudo( type ) {
      return function( elem ) {
        var name = elem.nodeName.toLowerCase();
        return name === "input" && elem.type === type;
      };
    }

    /**
     * Returns a function to use in pseudos for buttons
     * @param {String} type
     */
    function createButtonPseudo( type ) {
      return function( elem ) {
        var name = elem.nodeName.toLowerCase();
        return (name === "input" || name === "button") && elem.type === type;
      };
    }

    /**
     * Returns a function to use in pseudos for positionals
     * @param {Function} fn
     */
    function createPositionalPseudo( fn ) {
      return markFunction(function( argument ) {
        argument = +argument;
        return markFunction(function( seed, matches ) {
          var j,
            matchIndexes = fn( [], seed.length, argument ),
            i = matchIndexes.length;

          // Match elements found at the specified indexes
          while ( i-- ) {
            if ( seed[ (j = matchIndexes[i]) ] ) {
              seed[j] = !(matches[j] = seed[j]);
            }
          }
        });
      });
    }

    /**
     * Detect xml
     * @param {Element|Object} elem An element or a document
     */
    isXML = Sizzle.isXML = function( elem ) {
      // documentElement is verified for cases where it doesn't yet exist
      // (such as loading iframes in IE - #4833)
      var documentElement = elem && (elem.ownerDocument || elem).documentElement;
      return documentElement ? documentElement.nodeName !== "HTML" : false;
    };

// Expose support vars for convenience
    support = Sizzle.support = {};

    /**
     * Sets document-related variables once based on the current document
     * @param {Element|Object} [doc] An element or document object to use to set the document
     * @returns {Object} Returns the current document
     */
    setDocument = Sizzle.setDocument = function( node ) {
      var doc = node ? node.ownerDocument || node : preferredDoc,
        parent = doc.defaultView;

      // If no document and documentElement is available, return
      if ( doc === document || doc.nodeType !== 9 || !doc.documentElement ) {
        return document;
      }

      // Set our document
      document = doc;
      docElem = doc.documentElement;

      // Support tests
      documentIsHTML = !isXML( doc );

      // Support: IE>8
      // If iframe document is assigned to "document" variable and if iframe has been reloaded,
      // IE will throw "permission denied" error when accessing "document" variable, see jQuery #13936
      // IE6-8 do not support the defaultView property so parent will be undefined
      if ( parent && parent.attachEvent && parent !== parent.top ) {
        parent.attachEvent( "onbeforeunload", function() {
          setDocument();
        });
      }

      /* Attributes
       ---------------------------------------------------------------------- */

      // Support: IE<8
      // Verify that getAttribute really returns attributes and not properties (excepting IE8 booleans)
      support.attributes = assert(function( div ) {
        div.className = "i";
        return !div.getAttribute("className");
      });

      /* getElement(s)By*
       ---------------------------------------------------------------------- */

      // Check if getElementsByTagName("*") returns only elements
      support.getElementsByTagName = assert(function( div ) {
        div.appendChild( doc.createComment("") );
        return !div.getElementsByTagName("*").length;
      });

      // Check if getElementsByClassName can be trusted
      support.getElementsByClassName = assert(function( div ) {
        div.innerHTML = "<div class='a'></div><div class='a i'></div>";

        // Support: Safari<4
        // Catch class over-caching
        div.firstChild.className = "i";
        // Support: Opera<10
        // Catch gEBCN failure to find non-leading classes
        return div.getElementsByClassName("i").length === 2;
      });

      // Support: IE<10
      // Check if getElementById returns elements by name
      // The broken getElementById methods don't pick up programatically-set names,
      // so use a roundabout getElementsByName test
      support.getById = assert(function( div ) {
        docElem.appendChild( div ).id = expando;
        return !doc.getElementsByName || !doc.getElementsByName( expando ).length;
      });

      // ID find and filter
      if ( support.getById ) {
        Expr.find["ID"] = function( id, context ) {
          if ( typeof context.getElementById !== strundefined && documentIsHTML ) {
            var m = context.getElementById( id );
            // Check parentNode to catch when Blackberry 4.6 returns
            // nodes that are no longer in the document #6963
            return m && m.parentNode ? [m] : [];
          }
        };
        Expr.filter["ID"] = function( id ) {
          var attrId = id.replace( runescape, funescape );
          return function( elem ) {
            return elem.getAttribute("id") === attrId;
          };
        };
      } else {
        // Support: IE6/7
        // getElementById is not reliable as a find shortcut
        delete Expr.find["ID"];

        Expr.filter["ID"] =  function( id ) {
          var attrId = id.replace( runescape, funescape );
          return function( elem ) {
            var node = typeof elem.getAttributeNode !== strundefined && elem.getAttributeNode("id");
            return node && node.value === attrId;
          };
        };
      }

      // Tag
      Expr.find["TAG"] = support.getElementsByTagName ?
        function( tag, context ) {
          if ( typeof context.getElementsByTagName !== strundefined ) {
            return context.getElementsByTagName( tag );
          }
        } :
        function( tag, context ) {
          var elem,
            tmp = [],
            i = 0,
            results = context.getElementsByTagName( tag );

          // Filter out possible comments
          if ( tag === "*" ) {
            while ( (elem = results[i++]) ) {
              if ( elem.nodeType === 1 ) {
                tmp.push( elem );
              }
            }

            return tmp;
          }
          return results;
        };

      // Class
      Expr.find["CLASS"] = support.getElementsByClassName && function( className, context ) {
        if ( typeof context.getElementsByClassName !== strundefined && documentIsHTML ) {
          return context.getElementsByClassName( className );
        }
      };

      /* QSA/matchesSelector
       ---------------------------------------------------------------------- */

      // QSA and matchesSelector support

      // matchesSelector(:active) reports false when true (IE9/Opera 11.5)
      rbuggyMatches = [];

      // qSa(:focus) reports false when true (Chrome 21)
      // We allow this because of a bug in IE8/9 that throws an error
      // whenever `document.activeElement` is accessed on an iframe
      // So, we allow :focus to pass through QSA all the time to avoid the IE error
      // See http://bugs.jquery.com/ticket/13378
      rbuggyQSA = [];

      if ( (support.qsa = rnative.test( doc.querySelectorAll )) ) {
        // Build QSA regex
        // Regex strategy adopted from Diego Perini
        assert(function( div ) {
          // Select is set to empty string on purpose
          // This is to test IE's treatment of not explicitly
          // setting a boolean content attribute,
          // since its presence should be enough
          // http://bugs.jquery.com/ticket/12359
          div.innerHTML = "<select><option selected=''></option></select>";

          // Support: IE8
          // Boolean attributes and "value" are not treated correctly
          if ( !div.querySelectorAll("[selected]").length ) {
            rbuggyQSA.push( "\\[" + whitespace + "*(?:value|" + booleans + ")" );
          }

          // Webkit/Opera - :checked should return selected option elements
          // http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
          // IE8 throws error here and will not see later tests
          if ( !div.querySelectorAll(":checked").length ) {
            rbuggyQSA.push(":checked");
          }
        });

        assert(function( div ) {

          // Support: Opera 10-12/IE8
          // ^= $= *= and empty values
          // Should not select anything
          // Support: Windows 8 Native Apps
          // The type attribute is restricted during .innerHTML assignment
          var input = doc.createElement("input");
          input.setAttribute( "type", "hidden" );
          div.appendChild( input ).setAttribute( "t", "" );

          if ( div.querySelectorAll("[t^='']").length ) {
            rbuggyQSA.push( "[*^$]=" + whitespace + "*(?:''|\"\")" );
          }

          // FF 3.5 - :enabled/:disabled and hidden elements (hidden elements are still enabled)
          // IE8 throws error here and will not see later tests
          if ( !div.querySelectorAll(":enabled").length ) {
            rbuggyQSA.push( ":enabled", ":disabled" );
          }

          // Opera 10-11 does not throw on post-comma invalid pseudos
          div.querySelectorAll("*,:x");
          rbuggyQSA.push(",.*:");
        });
      }

      if ( (support.matchesSelector = rnative.test( (matches = docElem.webkitMatchesSelector ||
        docElem.mozMatchesSelector ||
        docElem.oMatchesSelector ||
        docElem.msMatchesSelector) )) ) {

        assert(function( div ) {
          // Check to see if it's possible to do matchesSelector
          // on a disconnected node (IE 9)
          support.disconnectedMatch = matches.call( div, "div" );

          // This should fail with an exception
          // Gecko does not error, returns false instead
          matches.call( div, "[s!='']:x" );
          rbuggyMatches.push( "!=", pseudos );
        });
      }

      rbuggyQSA = rbuggyQSA.length && new RegExp( rbuggyQSA.join("|") );
      rbuggyMatches = rbuggyMatches.length && new RegExp( rbuggyMatches.join("|") );

      /* Contains
       ---------------------------------------------------------------------- */

      // Element contains another
      // Purposefully does not implement inclusive descendent
      // As in, an element does not contain itself
      contains = rnative.test( docElem.contains ) || docElem.compareDocumentPosition ?
        function( a, b ) {
          var adown = a.nodeType === 9 ? a.documentElement : a,
            bup = b && b.parentNode;
          return a === bup || !!( bup && bup.nodeType === 1 && (
            adown.contains ?
              adown.contains( bup ) :
              a.compareDocumentPosition && a.compareDocumentPosition( bup ) & 16
            ));
        } :
        function( a, b ) {
          if ( b ) {
            while ( (b = b.parentNode) ) {
              if ( b === a ) {
                return true;
              }
            }
          }
          return false;
        };

      /* Sorting
       ---------------------------------------------------------------------- */

      // Document order sorting
      sortOrder = docElem.compareDocumentPosition ?
        function( a, b ) {

          // Flag for duplicate removal
          if ( a === b ) {
            hasDuplicate = true;
            return 0;
          }

          var compare = b.compareDocumentPosition && a.compareDocumentPosition && a.compareDocumentPosition( b );

          if ( compare ) {
            // Disconnected nodes
            if ( compare & 1 ||
              (!support.sortDetached && b.compareDocumentPosition( a ) === compare) ) {

              // Choose the first element that is related to our preferred document
              if ( a === doc || contains(preferredDoc, a) ) {
                return -1;
              }
              if ( b === doc || contains(preferredDoc, b) ) {
                return 1;
              }

              // Maintain original order
              return sortInput ?
                ( indexOf.call( sortInput, a ) - indexOf.call( sortInput, b ) ) :
                0;
            }

            return compare & 4 ? -1 : 1;
          }

          // Not directly comparable, sort on existence of method
          return a.compareDocumentPosition ? -1 : 1;
        } :
        function( a, b ) {
          var cur,
            i = 0,
            aup = a.parentNode,
            bup = b.parentNode,
            ap = [ a ],
            bp = [ b ];

          // Exit early if the nodes are identical
          if ( a === b ) {
            hasDuplicate = true;
            return 0;

            // Parentless nodes are either documents or disconnected
          } else if ( !aup || !bup ) {
            return a === doc ? -1 :
              b === doc ? 1 :
                aup ? -1 :
                  bup ? 1 :
                    sortInput ?
                      ( indexOf.call( sortInput, a ) - indexOf.call( sortInput, b ) ) :
                      0;

            // If the nodes are siblings, we can do a quick check
          } else if ( aup === bup ) {
            return siblingCheck( a, b );
          }

          // Otherwise we need full lists of their ancestors for comparison
          cur = a;
          while ( (cur = cur.parentNode) ) {
            ap.unshift( cur );
          }
          cur = b;
          while ( (cur = cur.parentNode) ) {
            bp.unshift( cur );
          }

          // Walk down the tree looking for a discrepancy
          while ( ap[i] === bp[i] ) {
            i++;
          }

          return i ?
            // Do a sibling check if the nodes have a common ancestor
            siblingCheck( ap[i], bp[i] ) :

            // Otherwise nodes in our document sort first
            ap[i] === preferredDoc ? -1 :
              bp[i] === preferredDoc ? 1 :
                0;
        };

      return doc;
    };

    Sizzle.matches = function( expr, elements ) {
      return Sizzle( expr, null, null, elements );
    };

    Sizzle.matchesSelector = function( elem, expr ) {
      // Set document vars if needed
      if ( ( elem.ownerDocument || elem ) !== document ) {
        setDocument( elem );
      }

      // Make sure that attribute selectors are quoted
      expr = expr.replace( rattributeQuotes, "='$1']" );

      if ( support.matchesSelector && documentIsHTML &&
        ( !rbuggyMatches || !rbuggyMatches.test( expr ) ) &&
        ( !rbuggyQSA     || !rbuggyQSA.test( expr ) ) ) {

        try {
          var ret = matches.call( elem, expr );

          // IE 9's matchesSelector returns false on disconnected nodes
          if ( ret || support.disconnectedMatch ||
            // As well, disconnected nodes are said to be in a document
            // fragment in IE 9
            elem.document && elem.document.nodeType !== 11 ) {
            return ret;
          }
        } catch(e) {}
      }

      return Sizzle( expr, document, null, [elem] ).length > 0;
    };

    Sizzle.contains = function( context, elem ) {
      // Set document vars if needed
      if ( ( context.ownerDocument || context ) !== document ) {
        setDocument( context );
      }
      return contains( context, elem );
    };

    Sizzle.attr = function( elem, name ) {
      // Set document vars if needed
      if ( ( elem.ownerDocument || elem ) !== document ) {
        setDocument( elem );
      }

      var fn = Expr.attrHandle[ name.toLowerCase() ],
      // Don't get fooled by Object.prototype properties (jQuery #13807)
        val = fn && hasOwn.call( Expr.attrHandle, name.toLowerCase() ) ?
          fn( elem, name, !documentIsHTML ) :
          undefined;

      return val === undefined ?
        support.attributes || !documentIsHTML ?
          elem.getAttribute( name ) :
          (val = elem.getAttributeNode(name)) && val.specified ?
            val.value :
            null :
        val;
    };

    Sizzle.error = function( msg ) {
      throw new Error( "Syntax error, unrecognized expression: " + msg );
    };

    /**
     * Document sorting and removing duplicates
     * @param {ArrayLike} results
     */
    Sizzle.uniqueSort = function( results ) {
      var elem,
        duplicates = [],
        j = 0,
        i = 0;

      // Unless we *know* we can detect duplicates, assume their presence
      hasDuplicate = !support.detectDuplicates;
      sortInput = !support.sortStable && results.slice( 0 );
      results.sort( sortOrder );

      if ( hasDuplicate ) {
        while ( (elem = results[i++]) ) {
          if ( elem === results[ i ] ) {
            j = duplicates.push( i );
          }
        }
        while ( j-- ) {
          results.splice( duplicates[ j ], 1 );
        }
      }

      return results;
    };

    /**
     * Utility function for retrieving the text value of an array of DOM nodes
     * @param {Array|Element} elem
     */
    getText = Sizzle.getText = function( elem ) {
      var node,
        ret = "",
        i = 0,
        nodeType = elem.nodeType;

      if ( !nodeType ) {
        // If no nodeType, this is expected to be an array
        for ( ; (node = elem[i]); i++ ) {
          // Do not traverse comment nodes
          ret += getText( node );
        }
      } else if ( nodeType === 1 || nodeType === 9 || nodeType === 11 ) {
        // Use textContent for elements
        // innerText usage removed for consistency of new lines (see #11153)
        if ( typeof elem.textContent === "string" ) {
          return elem.textContent;
        } else {
          // Traverse its children
          for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
            ret += getText( elem );
          }
        }
      } else if ( nodeType === 3 || nodeType === 4 ) {
        return elem.nodeValue;
      }
      // Do not include comment or processing instruction nodes

      return ret;
    };

    Expr = Sizzle.selectors = {

      // Can be adjusted by the user
      cacheLength: 50,

      createPseudo: markFunction,

      match: matchExpr,

      attrHandle: {},

      find: {},

      relative: {
        ">": { dir: "parentNode", first: true },
        " ": { dir: "parentNode" },
        "+": { dir: "previousSibling", first: true },
        "~": { dir: "previousSibling" }
      },

      preFilter: {
        "ATTR": function( match ) {
          match[1] = match[1].replace( runescape, funescape );

          // Move the given value to match[3] whether quoted or unquoted
          match[3] = ( match[4] || match[5] || "" ).replace( runescape, funescape );

          if ( match[2] === "~=" ) {
            match[3] = " " + match[3] + " ";
          }

          return match.slice( 0, 4 );
        },

        "CHILD": function( match ) {
          /* matches from matchExpr["CHILD"]
           1 type (only|nth|...)
           2 what (child|of-type)
           3 argument (even|odd|\d*|\d*n([+-]\d+)?|...)
           4 xn-component of xn+y argument ([+-]?\d*n|)
           5 sign of xn-component
           6 x of xn-component
           7 sign of y-component
           8 y of y-component
           */
          match[1] = match[1].toLowerCase();

          if ( match[1].slice( 0, 3 ) === "nth" ) {
            // nth-* requires argument
            if ( !match[3] ) {
              Sizzle.error( match[0] );
            }

            // numeric x and y parameters for Expr.filter.CHILD
            // remember that false/true cast respectively to 0/1
            match[4] = +( match[4] ? match[5] + (match[6] || 1) : 2 * ( match[3] === "even" || match[3] === "odd" ) );
            match[5] = +( ( match[7] + match[8] ) || match[3] === "odd" );

            // other types prohibit arguments
          } else if ( match[3] ) {
            Sizzle.error( match[0] );
          }

          return match;
        },

        "PSEUDO": function( match ) {
          var excess,
            unquoted = !match[5] && match[2];

          if ( matchExpr["CHILD"].test( match[0] ) ) {
            return null;
          }

          // Accept quoted arguments as-is
          if ( match[3] && match[4] !== undefined ) {
            match[2] = match[4];

            // Strip excess characters from unquoted arguments
          } else if ( unquoted && rpseudo.test( unquoted ) &&
            // Get excess from tokenize (recursively)
            (excess = tokenize( unquoted, true )) &&
            // advance to the next closing parenthesis
            (excess = unquoted.indexOf( ")", unquoted.length - excess ) - unquoted.length) ) {

            // excess is a negative index
            match[0] = match[0].slice( 0, excess );
            match[2] = unquoted.slice( 0, excess );
          }

          // Return only captures needed by the pseudo filter method (type and argument)
          return match.slice( 0, 3 );
        }
      },

      filter: {

        "TAG": function( nodeNameSelector ) {
          var nodeName = nodeNameSelector.replace( runescape, funescape ).toLowerCase();
          return nodeNameSelector === "*" ?
            function() { return true; } :
            function( elem ) {
              return elem.nodeName && elem.nodeName.toLowerCase() === nodeName;
            };
        },

        "CLASS": function( className ) {
          var pattern = classCache[ className + " " ];

          return pattern ||
            (pattern = new RegExp( "(^|" + whitespace + ")" + className + "(" + whitespace + "|$)" )) &&
              classCache( className, function( elem ) {
                return pattern.test( typeof elem.className === "string" && elem.className || typeof elem.getAttribute !== strundefined && elem.getAttribute("class") || "" );
              });
        },

        "ATTR": function( name, operator, check ) {
          return function( elem ) {
            var result = Sizzle.attr( elem, name );

            if ( result == null ) {
              return operator === "!=";
            }
            if ( !operator ) {
              return true;
            }

            result += "";

            return operator === "=" ? result === check :
              operator === "!=" ? result !== check :
                operator === "^=" ? check && result.indexOf( check ) === 0 :
                  operator === "*=" ? check && result.indexOf( check ) > -1 :
                    operator === "$=" ? check && result.slice( -check.length ) === check :
                      operator === "~=" ? ( " " + result + " " ).indexOf( check ) > -1 :
                        operator === "|=" ? result === check || result.slice( 0, check.length + 1 ) === check + "-" :
                          false;
          };
        },

        "CHILD": function( type, what, argument, first, last ) {
          var simple = type.slice( 0, 3 ) !== "nth",
            forward = type.slice( -4 ) !== "last",
            ofType = what === "of-type";

          return first === 1 && last === 0 ?

            // Shortcut for :nth-*(n)
            function( elem ) {
              return !!elem.parentNode;
            } :

            function( elem, context, xml ) {
              var cache, outerCache, node, diff, nodeIndex, start,
                dir = simple !== forward ? "nextSibling" : "previousSibling",
                parent = elem.parentNode,
                name = ofType && elem.nodeName.toLowerCase(),
                useCache = !xml && !ofType;

              if ( parent ) {

                // :(first|last|only)-(child|of-type)
                if ( simple ) {
                  while ( dir ) {
                    node = elem;
                    while ( (node = node[ dir ]) ) {
                      if ( ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1 ) {
                        return false;
                      }
                    }
                    // Reverse direction for :only-* (if we haven't yet done so)
                    start = dir = type === "only" && !start && "nextSibling";
                  }
                  return true;
                }

                start = [ forward ? parent.firstChild : parent.lastChild ];

                // non-xml :nth-child(...) stores cache data on `parent`
                if ( forward && useCache ) {
                  // Seek `elem` from a previously-cached index
                  outerCache = parent[ expando ] || (parent[ expando ] = {});
                  cache = outerCache[ type ] || [];
                  nodeIndex = cache[0] === dirruns && cache[1];
                  diff = cache[0] === dirruns && cache[2];
                  node = nodeIndex && parent.childNodes[ nodeIndex ];

                  while ( (node = ++nodeIndex && node && node[ dir ] ||

                    // Fallback to seeking `elem` from the start
                    (diff = nodeIndex = 0) || start.pop()) ) {

                    // When found, cache indexes on `parent` and break
                    if ( node.nodeType === 1 && ++diff && node === elem ) {
                      outerCache[ type ] = [ dirruns, nodeIndex, diff ];
                      break;
                    }
                  }

                  // Use previously-cached element index if available
                } else if ( useCache && (cache = (elem[ expando ] || (elem[ expando ] = {}))[ type ]) && cache[0] === dirruns ) {
                  diff = cache[1];

                  // xml :nth-child(...) or :nth-last-child(...) or :nth(-last)?-of-type(...)
                } else {
                  // Use the same loop as above to seek `elem` from the start
                  while ( (node = ++nodeIndex && node && node[ dir ] ||
                    (diff = nodeIndex = 0) || start.pop()) ) {

                    if ( ( ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1 ) && ++diff ) {
                      // Cache the index of each encountered element
                      if ( useCache ) {
                        (node[ expando ] || (node[ expando ] = {}))[ type ] = [ dirruns, diff ];
                      }

                      if ( node === elem ) {
                        break;
                      }
                    }
                  }
                }

                // Incorporate the offset, then check against cycle size
                diff -= last;
                return diff === first || ( diff % first === 0 && diff / first >= 0 );
              }
            };
        },

        "PSEUDO": function( pseudo, argument ) {
          // pseudo-class names are case-insensitive
          // http://www.w3.org/TR/selectors/#pseudo-classes
          // Prioritize by case sensitivity in case custom pseudos are added with uppercase letters
          // Remember that setFilters inherits from pseudos
          var args,
            fn = Expr.pseudos[ pseudo ] || Expr.setFilters[ pseudo.toLowerCase() ] ||
              Sizzle.error( "unsupported pseudo: " + pseudo );

          // The user may use createPseudo to indicate that
          // arguments are needed to create the filter function
          // just as Sizzle does
          if ( fn[ expando ] ) {
            return fn( argument );
          }

          // But maintain support for old signatures
          if ( fn.length > 1 ) {
            args = [ pseudo, pseudo, "", argument ];
            return Expr.setFilters.hasOwnProperty( pseudo.toLowerCase() ) ?
              markFunction(function( seed, matches ) {
                var idx,
                  matched = fn( seed, argument ),
                  i = matched.length;
                while ( i-- ) {
                  idx = indexOf.call( seed, matched[i] );
                  seed[ idx ] = !( matches[ idx ] = matched[i] );
                }
              }) :
              function( elem ) {
                return fn( elem, 0, args );
              };
          }

          return fn;
        }
      },

      pseudos: {
        // Potentially complex pseudos
        "not": markFunction(function( selector ) {
          // Trim the selector passed to compile
          // to avoid treating leading and trailing
          // spaces as combinators
          var input = [],
            results = [],
            matcher = compile( selector.replace( rtrim, "$1" ) );

          return matcher[ expando ] ?
            markFunction(function( seed, matches, context, xml ) {
              var elem,
                unmatched = matcher( seed, null, xml, [] ),
                i = seed.length;

              // Match elements unmatched by `matcher`
              while ( i-- ) {
                if ( (elem = unmatched[i]) ) {
                  seed[i] = !(matches[i] = elem);
                }
              }
            }) :
            function( elem, context, xml ) {
              input[0] = elem;
              matcher( input, null, xml, results );
              return !results.pop();
            };
        }),

        "has": markFunction(function( selector ) {
          return function( elem ) {
            return Sizzle( selector, elem ).length > 0;
          };
        }),

        "contains": markFunction(function( text ) {
          return function( elem ) {
            return ( elem.textContent || elem.innerText || getText( elem ) ).indexOf( text ) > -1;
          };
        }),

        // "Whether an element is represented by a :lang() selector
        // is based solely on the element's language value
        // being equal to the identifier C,
        // or beginning with the identifier C immediately followed by "-".
        // The matching of C against the element's language value is performed case-insensitively.
        // The identifier C does not have to be a valid language name."
        // http://www.w3.org/TR/selectors/#lang-pseudo
        "lang": markFunction( function( lang ) {
          // lang value must be a valid identifier
          if ( !ridentifier.test(lang || "") ) {
            Sizzle.error( "unsupported lang: " + lang );
          }
          lang = lang.replace( runescape, funescape ).toLowerCase();
          return function( elem ) {
            var elemLang;
            do {
              if ( (elemLang = documentIsHTML ?
                elem.lang :
                elem.getAttribute("xml:lang") || elem.getAttribute("lang")) ) {

                elemLang = elemLang.toLowerCase();
                return elemLang === lang || elemLang.indexOf( lang + "-" ) === 0;
              }
            } while ( (elem = elem.parentNode) && elem.nodeType === 1 );
            return false;
          };
        }),

        // Miscellaneous
        "target": function( elem ) {
          var hash = window.location && window.location.hash;
          return hash && hash.slice( 1 ) === elem.id;
        },

        "root": function( elem ) {
          return elem === docElem;
        },

        "focus": function( elem ) {
          return elem === document.activeElement && (!document.hasFocus || document.hasFocus()) && !!(elem.type || elem.href || ~elem.tabIndex);
        },

        // Boolean properties
        "enabled": function( elem ) {
          return elem.disabled === false;
        },

        "disabled": function( elem ) {
          return elem.disabled === true;
        },

        "checked": function( elem ) {
          // In CSS3, :checked should return both checked and selected elements
          // http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
          var nodeName = elem.nodeName.toLowerCase();
          return (nodeName === "input" && !!elem.checked) || (nodeName === "option" && !!elem.selected);
        },

        "selected": function( elem ) {
          // Accessing this property makes selected-by-default
          // options in Safari work properly
          if ( elem.parentNode ) {
            elem.parentNode.selectedIndex;
          }

          return elem.selected === true;
        },

        // Contents
        "empty": function( elem ) {
          // http://www.w3.org/TR/selectors/#empty-pseudo
          // :empty is only affected by element nodes and content nodes(including text(3), cdata(4)),
          //   not comment, processing instructions, or others
          // Thanks to Diego Perini for the nodeName shortcut
          //   Greater than "@" means alpha characters (specifically not starting with "#" or "?")
          for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
            if ( elem.nodeName > "@" || elem.nodeType === 3 || elem.nodeType === 4 ) {
              return false;
            }
          }
          return true;
        },

        "parent": function( elem ) {
          return !Expr.pseudos["empty"]( elem );
        },

        // Element/input types
        "header": function( elem ) {
          return rheader.test( elem.nodeName );
        },

        "input": function( elem ) {
          return rinputs.test( elem.nodeName );
        },

        "button": function( elem ) {
          var name = elem.nodeName.toLowerCase();
          return name === "input" && elem.type === "button" || name === "button";
        },

        "text": function( elem ) {
          var attr;
          // IE6 and 7 will map elem.type to 'text' for new HTML5 types (search, etc)
          // use getAttribute instead to test this case
          return elem.nodeName.toLowerCase() === "input" &&
            elem.type === "text" &&
            ( (attr = elem.getAttribute("type")) == null || attr.toLowerCase() === elem.type );
        },

        // Position-in-collection
        "first": createPositionalPseudo(function() {
          return [ 0 ];
        }),

        "last": createPositionalPseudo(function( matchIndexes, length ) {
          return [ length - 1 ];
        }),

        "eq": createPositionalPseudo(function( matchIndexes, length, argument ) {
          return [ argument < 0 ? argument + length : argument ];
        }),

        "even": createPositionalPseudo(function( matchIndexes, length ) {
          var i = 0;
          for ( ; i < length; i += 2 ) {
            matchIndexes.push( i );
          }
          return matchIndexes;
        }),

        "odd": createPositionalPseudo(function( matchIndexes, length ) {
          var i = 1;
          for ( ; i < length; i += 2 ) {
            matchIndexes.push( i );
          }
          return matchIndexes;
        }),

        "lt": createPositionalPseudo(function( matchIndexes, length, argument ) {
          var i = argument < 0 ? argument + length : argument;
          for ( ; --i >= 0; ) {
            matchIndexes.push( i );
          }
          return matchIndexes;
        }),

        "gt": createPositionalPseudo(function( matchIndexes, length, argument ) {
          var i = argument < 0 ? argument + length : argument;
          for ( ; ++i < length; ) {
            matchIndexes.push( i );
          }
          return matchIndexes;
        })
      }
    };

    Expr.pseudos["nth"] = Expr.pseudos["eq"];

// Add button/input type pseudos
    for ( i in { radio: true, checkbox: true, file: true, password: true, image: true } ) {
      Expr.pseudos[ i ] = createInputPseudo( i );
    }
    for ( i in { submit: true, reset: true } ) {
      Expr.pseudos[ i ] = createButtonPseudo( i );
    }

// Easy API for creating new setFilters
    function setFilters() {}
    setFilters.prototype = Expr.filters = Expr.pseudos;
    Expr.setFilters = new setFilters();

    function tokenize( selector, parseOnly ) {
      var matched, match, tokens, type,
        soFar, groups, preFilters,
        cached = tokenCache[ selector + " " ];

      if ( cached ) {
        return parseOnly ? 0 : cached.slice( 0 );
      }

      soFar = selector;
      groups = [];
      preFilters = Expr.preFilter;

      while ( soFar ) {

        // Comma and first run
        if ( !matched || (match = rcomma.exec( soFar )) ) {
          if ( match ) {
            // Don't consume trailing commas as valid
            soFar = soFar.slice( match[0].length ) || soFar;
          }
          groups.push( tokens = [] );
        }

        matched = false;

        // Combinators
        if ( (match = rcombinators.exec( soFar )) ) {
          matched = match.shift();
          tokens.push({
            value: matched,
            // Cast descendant combinators to space
            type: match[0].replace( rtrim, " " )
          });
          soFar = soFar.slice( matched.length );
        }

        // Filters
        for ( type in Expr.filter ) {
          if ( (match = matchExpr[ type ].exec( soFar )) && (!preFilters[ type ] ||
            (match = preFilters[ type ]( match ))) ) {
            matched = match.shift();
            tokens.push({
              value: matched,
              type: type,
              matches: match
            });
            soFar = soFar.slice( matched.length );
          }
        }

        if ( !matched ) {
          break;
        }
      }

      // Return the length of the invalid excess
      // if we're just parsing
      // Otherwise, throw an error or return tokens
      return parseOnly ?
        soFar.length :
        soFar ?
          Sizzle.error( selector ) :
          // Cache the tokens
          tokenCache( selector, groups ).slice( 0 );
    }

    function toSelector( tokens ) {
      var i = 0,
        len = tokens.length,
        selector = "";
      for ( ; i < len; i++ ) {
        selector += tokens[i].value;
      }
      return selector;
    }

    function addCombinator( matcher, combinator, base ) {
      var dir = combinator.dir,
        checkNonElements = base && dir === "parentNode",
        doneName = done++;

      return combinator.first ?
        // Check against closest ancestor/preceding element
        function( elem, context, xml ) {
          while ( (elem = elem[ dir ]) ) {
            if ( elem.nodeType === 1 || checkNonElements ) {
              return matcher( elem, context, xml );
            }
          }
        } :

        // Check against all ancestor/preceding elements
        function( elem, context, xml ) {
          var data, cache, outerCache,
            dirkey = dirruns + " " + doneName;

          // We can't set arbitrary data on XML nodes, so they don't benefit from dir caching
          if ( xml ) {
            while ( (elem = elem[ dir ]) ) {
              if ( elem.nodeType === 1 || checkNonElements ) {
                if ( matcher( elem, context, xml ) ) {
                  return true;
                }
              }
            }
          } else {
            while ( (elem = elem[ dir ]) ) {
              if ( elem.nodeType === 1 || checkNonElements ) {
                outerCache = elem[ expando ] || (elem[ expando ] = {});
                if ( (cache = outerCache[ dir ]) && cache[0] === dirkey ) {
                  if ( (data = cache[1]) === true || data === cachedruns ) {
                    return data === true;
                  }
                } else {
                  cache = outerCache[ dir ] = [ dirkey ];
                  cache[1] = matcher( elem, context, xml ) || cachedruns;
                  if ( cache[1] === true ) {
                    return true;
                  }
                }
              }
            }
          }
        };
    }

    function elementMatcher( matchers ) {
      return matchers.length > 1 ?
        function( elem, context, xml ) {
          var i = matchers.length;
          while ( i-- ) {
            if ( !matchers[i]( elem, context, xml ) ) {
              return false;
            }
          }
          return true;
        } :
        matchers[0];
    }

    function condense( unmatched, map, filter, context, xml ) {
      var elem,
        newUnmatched = [],
        i = 0,
        len = unmatched.length,
        mapped = map != null;

      for ( ; i < len; i++ ) {
        if ( (elem = unmatched[i]) ) {
          if ( !filter || filter( elem, context, xml ) ) {
            newUnmatched.push( elem );
            if ( mapped ) {
              map.push( i );
            }
          }
        }
      }

      return newUnmatched;
    }

    function setMatcher( preFilter, selector, matcher, postFilter, postFinder, postSelector ) {
      if ( postFilter && !postFilter[ expando ] ) {
        postFilter = setMatcher( postFilter );
      }
      if ( postFinder && !postFinder[ expando ] ) {
        postFinder = setMatcher( postFinder, postSelector );
      }
      return markFunction(function( seed, results, context, xml ) {
        var temp, i, elem,
          preMap = [],
          postMap = [],
          preexisting = results.length,

        // Get initial elements from seed or context
          elems = seed || multipleContexts( selector || "*", context.nodeType ? [ context ] : context, [] ),

        // Prefilter to get matcher input, preserving a map for seed-results synchronization
          matcherIn = preFilter && ( seed || !selector ) ?
            condense( elems, preMap, preFilter, context, xml ) :
            elems,

          matcherOut = matcher ?
            // If we have a postFinder, or filtered seed, or non-seed postFilter or preexisting results,
            postFinder || ( seed ? preFilter : preexisting || postFilter ) ?

              // ...intermediate processing is necessary
              [] :

              // ...otherwise use results directly
              results :
            matcherIn;

        // Find primary matches
        if ( matcher ) {
          matcher( matcherIn, matcherOut, context, xml );
        }

        // Apply postFilter
        if ( postFilter ) {
          temp = condense( matcherOut, postMap );
          postFilter( temp, [], context, xml );

          // Un-match failing elements by moving them back to matcherIn
          i = temp.length;
          while ( i-- ) {
            if ( (elem = temp[i]) ) {
              matcherOut[ postMap[i] ] = !(matcherIn[ postMap[i] ] = elem);
            }
          }
        }

        if ( seed ) {
          if ( postFinder || preFilter ) {
            if ( postFinder ) {
              // Get the final matcherOut by condensing this intermediate into postFinder contexts
              temp = [];
              i = matcherOut.length;
              while ( i-- ) {
                if ( (elem = matcherOut[i]) ) {
                  // Restore matcherIn since elem is not yet a final match
                  temp.push( (matcherIn[i] = elem) );
                }
              }
              postFinder( null, (matcherOut = []), temp, xml );
            }

            // Move matched elements from seed to results to keep them synchronized
            i = matcherOut.length;
            while ( i-- ) {
              if ( (elem = matcherOut[i]) &&
                (temp = postFinder ? indexOf.call( seed, elem ) : preMap[i]) > -1 ) {

                seed[temp] = !(results[temp] = elem);
              }
            }
          }

          // Add elements to results, through postFinder if defined
        } else {
          matcherOut = condense(
            matcherOut === results ?
              matcherOut.splice( preexisting, matcherOut.length ) :
              matcherOut
          );
          if ( postFinder ) {
            postFinder( null, results, matcherOut, xml );
          } else {
            push.apply( results, matcherOut );
          }
        }
      });
    }

    function matcherFromTokens( tokens ) {
      var checkContext, matcher, j,
        len = tokens.length,
        leadingRelative = Expr.relative[ tokens[0].type ],
        implicitRelative = leadingRelative || Expr.relative[" "],
        i = leadingRelative ? 1 : 0,

      // The foundational matcher ensures that elements are reachable from top-level context(s)
        matchContext = addCombinator( function( elem ) {
          return elem === checkContext;
        }, implicitRelative, true ),
        matchAnyContext = addCombinator( function( elem ) {
          return indexOf.call( checkContext, elem ) > -1;
        }, implicitRelative, true ),
        matchers = [ function( elem, context, xml ) {
          return ( !leadingRelative && ( xml || context !== outermostContext ) ) || (
            (checkContext = context).nodeType ?
              matchContext( elem, context, xml ) :
              matchAnyContext( elem, context, xml ) );
        } ];

      for ( ; i < len; i++ ) {
        if ( (matcher = Expr.relative[ tokens[i].type ]) ) {
          matchers = [ addCombinator(elementMatcher( matchers ), matcher) ];
        } else {
          matcher = Expr.filter[ tokens[i].type ].apply( null, tokens[i].matches );

          // Return special upon seeing a positional matcher
          if ( matcher[ expando ] ) {
            // Find the next relative operator (if any) for proper handling
            j = ++i;
            for ( ; j < len; j++ ) {
              if ( Expr.relative[ tokens[j].type ] ) {
                break;
              }
            }
            return setMatcher(
              i > 1 && elementMatcher( matchers ),
              i > 1 && toSelector(
                // If the preceding token was a descendant combinator, insert an implicit any-element `*`
                tokens.slice( 0, i - 1 ).concat({ value: tokens[ i - 2 ].type === " " ? "*" : "" })
              ).replace( rtrim, "$1" ),
              matcher,
              i < j && matcherFromTokens( tokens.slice( i, j ) ),
              j < len && matcherFromTokens( (tokens = tokens.slice( j )) ),
              j < len && toSelector( tokens )
            );
          }
          matchers.push( matcher );
        }
      }

      return elementMatcher( matchers );
    }

    function matcherFromGroupMatchers( elementMatchers, setMatchers ) {
      // A counter to specify which element is currently being matched
      var matcherCachedRuns = 0,
        bySet = setMatchers.length > 0,
        byElement = elementMatchers.length > 0,
        superMatcher = function( seed, context, xml, results, expandContext ) {
          var elem, j, matcher,
            setMatched = [],
            matchedCount = 0,
            i = "0",
            unmatched = seed && [],
            outermost = expandContext != null,
            contextBackup = outermostContext,
          // We must always have either seed elements or context
            elems = seed || byElement && Expr.find["TAG"]( "*", expandContext && context.parentNode || context ),
          // Use integer dirruns iff this is the outermost matcher
            dirrunsUnique = (dirruns += contextBackup == null ? 1 : Math.random() || 0.1);

          if ( outermost ) {
            outermostContext = context !== document && context;
            cachedruns = matcherCachedRuns;
          }

          // Add elements passing elementMatchers directly to results
          // Keep `i` a string if there are no elements so `matchedCount` will be "00" below
          for ( ; (elem = elems[i]) != null; i++ ) {
            if ( byElement && elem ) {
              j = 0;
              while ( (matcher = elementMatchers[j++]) ) {
                if ( matcher( elem, context, xml ) ) {
                  results.push( elem );
                  break;
                }
              }
              if ( outermost ) {
                dirruns = dirrunsUnique;
                cachedruns = ++matcherCachedRuns;
              }
            }

            // Track unmatched elements for set filters
            if ( bySet ) {
              // They will have gone through all possible matchers
              if ( (elem = !matcher && elem) ) {
                matchedCount--;
              }

              // Lengthen the array for every element, matched or not
              if ( seed ) {
                unmatched.push( elem );
              }
            }
          }

          // Apply set filters to unmatched elements
          matchedCount += i;
          if ( bySet && i !== matchedCount ) {
            j = 0;
            while ( (matcher = setMatchers[j++]) ) {
              matcher( unmatched, setMatched, context, xml );
            }

            if ( seed ) {
              // Reintegrate element matches to eliminate the need for sorting
              if ( matchedCount > 0 ) {
                while ( i-- ) {
                  if ( !(unmatched[i] || setMatched[i]) ) {
                    setMatched[i] = pop.call( results );
                  }
                }
              }

              // Discard index placeholder values to get only actual matches
              setMatched = condense( setMatched );
            }

            // Add matches to results
            push.apply( results, setMatched );

            // Seedless set matches succeeding multiple successful matchers stipulate sorting
            if ( outermost && !seed && setMatched.length > 0 &&
              ( matchedCount + setMatchers.length ) > 1 ) {

              Sizzle.uniqueSort( results );
            }
          }

          // Override manipulation of globals by nested matchers
          if ( outermost ) {
            dirruns = dirrunsUnique;
            outermostContext = contextBackup;
          }

          return unmatched;
        };

      return bySet ?
        markFunction( superMatcher ) :
        superMatcher;
    }

    compile = Sizzle.compile = function( selector, group /* Internal Use Only */ ) {
      var i,
        setMatchers = [],
        elementMatchers = [],
        cached = compilerCache[ selector + " " ];

      if ( !cached ) {
        // Generate a function of recursive functions that can be used to check each element
        if ( !group ) {
          group = tokenize( selector );
        }
        i = group.length;
        while ( i-- ) {
          cached = matcherFromTokens( group[i] );
          if ( cached[ expando ] ) {
            setMatchers.push( cached );
          } else {
            elementMatchers.push( cached );
          }
        }

        // Cache the compiled function
        cached = compilerCache( selector, matcherFromGroupMatchers( elementMatchers, setMatchers ) );
      }
      return cached;
    };

    function multipleContexts( selector, contexts, results ) {
      var i = 0,
        len = contexts.length;
      for ( ; i < len; i++ ) {
        Sizzle( selector, contexts[i], results );
      }
      return results;
    }

    function select( selector, context, results, seed ) {
      var i, tokens, token, type, find,
        match = tokenize( selector );

      if ( !seed ) {
        // Try to minimize operations if there is only one group
        if ( match.length === 1 ) {

          // Take a shortcut and set the context if the root selector is an ID
          tokens = match[0] = match[0].slice( 0 );
          if ( tokens.length > 2 && (token = tokens[0]).type === "ID" &&
            support.getById && context.nodeType === 9 && documentIsHTML &&
            Expr.relative[ tokens[1].type ] ) {

            context = ( Expr.find["ID"]( token.matches[0].replace(runescape, funescape), context ) || [] )[0];
            if ( !context ) {
              return results;
            }
            selector = selector.slice( tokens.shift().value.length );
          }

          // Fetch a seed set for right-to-left matching
          i = matchExpr["needsContext"].test( selector ) ? 0 : tokens.length;
          while ( i-- ) {
            token = tokens[i];

            // Abort if we hit a combinator
            if ( Expr.relative[ (type = token.type) ] ) {
              break;
            }
            if ( (find = Expr.find[ type ]) ) {
              // Search, expanding context for leading sibling combinators
              if ( (seed = find(
                token.matches[0].replace( runescape, funescape ),
                rsibling.test( tokens[0].type ) && context.parentNode || context
              )) ) {

                // If seed is empty or no tokens remain, we can return early
                tokens.splice( i, 1 );
                selector = seed.length && toSelector( tokens );
                if ( !selector ) {
                  push.apply( results, seed );
                  return results;
                }

                break;
              }
            }
          }
        }
      }

      // Compile and execute a filtering function
      // Provide `match` to avoid retokenization if we modified the selector above
      compile( selector, match )(
        seed,
        context,
        !documentIsHTML,
        results,
        rsibling.test( selector )
      );
      return results;
    }

// One-time assignments

// Sort stability
    support.sortStable = expando.split("").sort( sortOrder ).join("") === expando;

// Support: Chrome<14
// Always assume duplicates if they aren't passed to the comparison function
    support.detectDuplicates = hasDuplicate;

// Initialize against the default document
    setDocument();

// Support: Webkit<537.32 - Safari 6.0.3/Chrome 25 (fixed in Chrome 27)
// Detached nodes confoundingly follow *each other*
    support.sortDetached = assert(function( div1 ) {
      // Should return 1, but returns 4 (following)
      return div1.compareDocumentPosition( document.createElement("div") ) & 1;
    });

// Support: IE<8
// Prevent attribute/property "interpolation"
// http://msdn.microsoft.com/en-us/library/ms536429%28VS.85%29.aspx
    if ( !assert(function( div ) {
      div.innerHTML = "<a href='#'></a>";
      return div.firstChild.getAttribute("href") === "#" ;
    }) ) {
      addHandle( "type|href|height|width", function( elem, name, isXML ) {
        if ( !isXML ) {
          return elem.getAttribute( name, name.toLowerCase() === "type" ? 1 : 2 );
        }
      });
    }

// Support: IE<9
// Use defaultValue in place of getAttribute("value")
    if ( !support.attributes || !assert(function( div ) {
      div.innerHTML = "<input/>";
      div.firstChild.setAttribute( "value", "" );
      return div.firstChild.getAttribute( "value" ) === "";
    }) ) {
      addHandle( "value", function( elem, name, isXML ) {
        if ( !isXML && elem.nodeName.toLowerCase() === "input" ) {
          return elem.defaultValue;
        }
      });
    }

// Support: IE<9
// Use getAttributeNode to fetch booleans when getAttribute lies
    if ( !assert(function( div ) {
      return div.getAttribute("disabled") == null;
    }) ) {
      addHandle( booleans, function( elem, name, isXML ) {
        var val;
        if ( !isXML ) {
          return (val = elem.getAttributeNode( name )) && val.specified ?
            val.value :
            elem[ name ] === true ? name.toLowerCase() : null;
        }
      });
    }

    jQuery.find = Sizzle;
    jQuery.expr = Sizzle.selectors;
    jQuery.expr[":"] = jQuery.expr.pseudos;
    jQuery.unique = Sizzle.uniqueSort;
    jQuery.text = Sizzle.getText;
    jQuery.isXMLDoc = Sizzle.isXML;
    jQuery.contains = Sizzle.contains;


  })( window );
// String to Object options format cache
  var optionsCache = {};

// Convert String-formatted options into Object-formatted ones and store in cache
  function createOptions( options ) {
    var object = optionsCache[ options ] = {};
    jQuery.each( options.match( core_rnotwhite ) || [], function( _, flag ) {
      object[ flag ] = true;
    });
    return object;
  }

  /*
   * Create a callback list using the following parameters:
   *
   *	options: an optional list of space-separated options that will change how
   *			the callback list behaves or a more traditional option object
   *
   * By default a callback list will act like an event callback list and can be
   * "fired" multiple times.
   *
   * Possible options:
   *
   *	once:			will ensure the callback list can only be fired once (like a Deferred)
   *
   *	memory:			will keep track of previous values and will call any callback added
   *					after the list has been fired right away with the latest "memorized"
   *					values (like a Deferred)
   *
   *	unique:			will ensure a callback can only be added once (no duplicate in the list)
   *
   *	stopOnFalse:	interrupt callings when a callback returns false
   *
   */
  jQuery.Callbacks = function( options ) {

    // Convert options from String-formatted to Object-formatted if needed
    // (we check in cache first)
    options = typeof options === "string" ?
      ( optionsCache[ options ] || createOptions( options ) ) :
      jQuery.extend( {}, options );

    var // Last fire value (for non-forgettable lists)
      memory,
    // Flag to know if list was already fired
      fired,
    // Flag to know if list is currently firing
      firing,
    // First callback to fire (used internally by add and fireWith)
      firingStart,
    // End of the loop when firing
      firingLength,
    // Index of currently firing callback (modified by remove if needed)
      firingIndex,
    // Actual callback list
      list = [],
    // Stack of fire calls for repeatable lists
      stack = !options.once && [],
    // Fire callbacks
      fire = function( data ) {
        memory = options.memory && data;
        fired = true;
        firingIndex = firingStart || 0;
        firingStart = 0;
        firingLength = list.length;
        firing = true;
        for ( ; list && firingIndex < firingLength; firingIndex++ ) {
          if ( list[ firingIndex ].apply( data[ 0 ], data[ 1 ] ) === false && options.stopOnFalse ) {
            memory = false; // To prevent further calls using add
            break;
          }
        }
        firing = false;
        if ( list ) {
          if ( stack ) {
            if ( stack.length ) {
              fire( stack.shift() );
            }
          } else if ( memory ) {
            list = [];
          } else {
            self.disable();
          }
        }
      },
    // Actual Callbacks object
      self = {
        // Add a callback or a collection of callbacks to the list
        add: function() {
          if ( list ) {
            // First, we save the current length
            var start = list.length;
            (function add( args ) {
              jQuery.each( args, function( _, arg ) {
                var type = jQuery.type( arg );
                if ( type === "function" ) {
                  if ( !options.unique || !self.has( arg ) ) {
                    list.push( arg );
                  }
                } else if ( arg && arg.length && type !== "string" ) {
                  // Inspect recursively
                  add( arg );
                }
              });
            })( arguments );
            // Do we need to add the callbacks to the
            // current firing batch?
            if ( firing ) {
              firingLength = list.length;
              // With memory, if we're not firing then
              // we should call right away
            } else if ( memory ) {
              firingStart = start;
              fire( memory );
            }
          }
          return this;
        },
        // Remove a callback from the list
        remove: function() {
          if ( list ) {
            jQuery.each( arguments, function( _, arg ) {
              var index;
              while( ( index = jQuery.inArray( arg, list, index ) ) > -1 ) {
                list.splice( index, 1 );
                // Handle firing indexes
                if ( firing ) {
                  if ( index <= firingLength ) {
                    firingLength--;
                  }
                  if ( index <= firingIndex ) {
                    firingIndex--;
                  }
                }
              }
            });
          }
          return this;
        },
        // Check if a given callback is in the list.
        // If no argument is given, return whether or not list has callbacks attached.
        has: function( fn ) {
          return fn ? jQuery.inArray( fn, list ) > -1 : !!( list && list.length );
        },
        // Remove all callbacks from the list
        empty: function() {
          list = [];
          firingLength = 0;
          return this;
        },
        // Have the list do nothing anymore
        disable: function() {
          list = stack = memory = undefined;
          return this;
        },
        // Is it disabled?
        disabled: function() {
          return !list;
        },
        // Lock the list in its current state
        lock: function() {
          stack = undefined;
          if ( !memory ) {
            self.disable();
          }
          return this;
        },
        // Is it locked?
        locked: function() {
          return !stack;
        },
        // Call all callbacks with the given context and arguments
        fireWith: function( context, args ) {
          if ( list && ( !fired || stack ) ) {
            args = args || [];
            args = [ context, args.slice ? args.slice() : args ];
            if ( firing ) {
              stack.push( args );
            } else {
              fire( args );
            }
          }
          return this;
        },
        // Call all the callbacks with the given arguments
        fire: function() {
          self.fireWith( this, arguments );
          return this;
        },
        // To know if the callbacks have already been called at least once
        fired: function() {
          return !!fired;
        }
      };

    return self;
  };
  jQuery.extend({

    Deferred: function( func ) {
      var tuples = [
          // action, add listener, listener list, final state
          [ "resolve", "done", jQuery.Callbacks("once memory"), "resolved" ],
          [ "reject", "fail", jQuery.Callbacks("once memory"), "rejected" ],
          [ "notify", "progress", jQuery.Callbacks("memory") ]
        ],
        state = "pending",
        promise = {
          state: function() {
            return state;
          },
          always: function() {
            deferred.done( arguments ).fail( arguments );
            return this;
          },
          then: function( /* fnDone, fnFail, fnProgress */ ) {
            var fns = arguments;
            return jQuery.Deferred(function( newDefer ) {
              jQuery.each( tuples, function( i, tuple ) {
                var action = tuple[ 0 ],
                  fn = jQuery.isFunction( fns[ i ] ) && fns[ i ];
                // deferred[ done | fail | progress ] for forwarding actions to newDefer
                deferred[ tuple[1] ](function() {
                  var returned = fn && fn.apply( this, arguments );
                  if ( returned && jQuery.isFunction( returned.promise ) ) {
                    returned.promise()
                      .done( newDefer.resolve )
                      .fail( newDefer.reject )
                      .progress( newDefer.notify );
                  } else {
                    newDefer[ action + "With" ]( this === promise ? newDefer.promise() : this, fn ? [ returned ] : arguments );
                  }
                });
              });
              fns = null;
            }).promise();
          },
          // Get a promise for this deferred
          // If obj is provided, the promise aspect is added to the object
          promise: function( obj ) {
            return obj != null ? jQuery.extend( obj, promise ) : promise;
          }
        },
        deferred = {};

      // Keep pipe for back-compat
      promise.pipe = promise.then;

      // Add list-specific methods
      jQuery.each( tuples, function( i, tuple ) {
        var list = tuple[ 2 ],
          stateString = tuple[ 3 ];

        // promise[ done | fail | progress ] = list.add
        promise[ tuple[1] ] = list.add;

        // Handle state
        if ( stateString ) {
          list.add(function() {
            // state = [ resolved | rejected ]
            state = stateString;

            // [ reject_list | resolve_list ].disable; progress_list.lock
          }, tuples[ i ^ 1 ][ 2 ].disable, tuples[ 2 ][ 2 ].lock );
        }

        // deferred[ resolve | reject | notify ]
        deferred[ tuple[0] ] = function() {
          deferred[ tuple[0] + "With" ]( this === deferred ? promise : this, arguments );
          return this;
        };
        deferred[ tuple[0] + "With" ] = list.fireWith;
      });

      // Make the deferred a promise
      promise.promise( deferred );

      // Call given func if any
      if ( func ) {
        func.call( deferred, deferred );
      }

      // All done!
      return deferred;
    },

    // Deferred helper
    when: function( subordinate /* , ..., subordinateN */ ) {
      var i = 0,
        resolveValues = core_slice.call( arguments ),
        length = resolveValues.length,

      // the count of uncompleted subordinates
        remaining = length !== 1 || ( subordinate && jQuery.isFunction( subordinate.promise ) ) ? length : 0,

      // the master Deferred. If resolveValues consist of only a single Deferred, just use that.
        deferred = remaining === 1 ? subordinate : jQuery.Deferred(),

      // Update function for both resolve and progress values
        updateFunc = function( i, contexts, values ) {
          return function( value ) {
            contexts[ i ] = this;
            values[ i ] = arguments.length > 1 ? core_slice.call( arguments ) : value;
            if( values === progressValues ) {
              deferred.notifyWith( contexts, values );
            } else if ( !( --remaining ) ) {
              deferred.resolveWith( contexts, values );
            }
          };
        },

        progressValues, progressContexts, resolveContexts;

      // add listeners to Deferred subordinates; treat others as resolved
      if ( length > 1 ) {
        progressValues = new Array( length );
        progressContexts = new Array( length );
        resolveContexts = new Array( length );
        for ( ; i < length; i++ ) {
          if ( resolveValues[ i ] && jQuery.isFunction( resolveValues[ i ].promise ) ) {
            resolveValues[ i ].promise()
              .done( updateFunc( i, resolveContexts, resolveValues ) )
              .fail( deferred.reject )
              .progress( updateFunc( i, progressContexts, progressValues ) );
          } else {
            --remaining;
          }
        }
      }

      // if we're not waiting on anything, resolve the master
      if ( !remaining ) {
        deferred.resolveWith( resolveContexts, resolveValues );
      }

      return deferred.promise();
    }
  });
  jQuery.support = (function( support ) {
    var input = document.createElement("input"),
      fragment = document.createDocumentFragment(),
      div = document.createElement("div"),
      select = document.createElement("select"),
      opt = select.appendChild( document.createElement("option") );

    // Finish early in limited environments
    if ( !input.type ) {
      return support;
    }

    input.type = "checkbox";

    // Support: Safari 5.1, iOS 5.1, Android 4.x, Android 2.3
    // Check the default checkbox/radio value ("" on old WebKit; "on" elsewhere)
    support.checkOn = input.value !== "";

    // Must access the parent to make an option select properly
    // Support: IE9, IE10
    support.optSelected = opt.selected;

    // Will be defined later
    support.reliableMarginRight = true;
    support.boxSizingReliable = true;
    support.pixelPosition = false;

    // Make sure checked status is properly cloned
    // Support: IE9, IE10
    input.checked = true;
    support.noCloneChecked = input.cloneNode( true ).checked;

    // Make sure that the options inside disabled selects aren't marked as disabled
    // (WebKit marks them as disabled)
    select.disabled = true;
    support.optDisabled = !opt.disabled;

    // Check if an input maintains its value after becoming a radio
    // Support: IE9, IE10
    input = document.createElement("input");
    input.value = "t";
    input.type = "radio";
    support.radioValue = input.value === "t";

    // #11217 - WebKit loses check when the name is after the checked attribute
    input.setAttribute( "checked", "t" );
    input.setAttribute( "name", "t" );

    fragment.appendChild( input );

    // Support: Safari 5.1, Android 4.x, Android 2.3
    // old WebKit doesn't clone checked state correctly in fragments
    support.checkClone = fragment.cloneNode( true ).cloneNode( true ).lastChild.checked;

    // Support: Firefox, Chrome, Safari
    // Beware of CSP restrictions (https://developer.mozilla.org/en/Security/CSP)
    support.focusinBubbles = "onfocusin" in window;

    div.style.backgroundClip = "content-box";
    div.cloneNode( true ).style.backgroundClip = "";
    support.clearCloneStyle = div.style.backgroundClip === "content-box";

    // Run tests that need a body at doc ready
    jQuery(function() {
      var container, marginDiv,
      // Support: Firefox, Android 2.3 (Prefixed box-sizing versions).
        divReset = "padding:0;margin:0;border:0;display:block;-webkit-box-sizing:content-box;-moz-box-sizing:content-box;box-sizing:content-box",
        body = document.getElementsByTagName("body")[ 0 ];

      if ( !body ) {
        // Return for frameset docs that don't have a body
        return;
      }

      container = document.createElement("div");
      container.style.cssText = "border:0;width:0;height:0;position:absolute;top:0;left:-9999px;margin-top:1px";

      // Check box-sizing and margin behavior.
      body.appendChild( container ).appendChild( div );
      div.innerHTML = "";
      // Support: Firefox, Android 2.3 (Prefixed box-sizing versions).
      div.style.cssText = "-webkit-box-sizing:border-box;-moz-box-sizing:border-box;box-sizing:border-box;padding:1px;border:1px;display:block;width:4px;margin-top:1%;position:absolute;top:1%";

      // Workaround failing boxSizing test due to offsetWidth returning wrong value
      // with some non-1 values of body zoom, ticket #13543
      jQuery.swap( body, body.style.zoom != null ? { zoom: 1 } : {}, function() {
        support.boxSizing = div.offsetWidth === 4;
      });

      // Use window.getComputedStyle because jsdom on node.js will break without it.
      if ( window.getComputedStyle ) {
        support.pixelPosition = ( window.getComputedStyle( div, null ) || {} ).top !== "1%";
        support.boxSizingReliable = ( window.getComputedStyle( div, null ) || { width: "4px" } ).width === "4px";

        // Support: Android 2.3
        // Check if div with explicit width and no margin-right incorrectly
        // gets computed margin-right based on width of container. (#3333)
        // WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
        marginDiv = div.appendChild( document.createElement("div") );
        marginDiv.style.cssText = div.style.cssText = divReset;
        marginDiv.style.marginRight = marginDiv.style.width = "0";
        div.style.width = "1px";

        support.reliableMarginRight =
          !parseFloat( ( window.getComputedStyle( marginDiv, null ) || {} ).marginRight );
      }

      body.removeChild( container );
    });

    return support;
  })( {} );

  /*
   Implementation Summary

   1. Enforce API surface and semantic compatibility with 1.9.x branch
   2. Improve the module's maintainability by reducing the storage
   paths to a single mechanism.
   3. Use the same single mechanism to support "private" and "user" data.
   4. _Never_ expose "private" data to user code (TODO: Drop _data, _removeData)
   5. Avoid exposing implementation details on user objects (eg. expando properties)
   6. Provide a clear path for implementation upgrade to WeakMap in 2014
   */
  var data_user, data_priv,
    rbrace = /(?:\{[\s\S]*\}|\[[\s\S]*\])$/,
    rmultiDash = /([A-Z])/g;

  function Data() {
    // Support: Android < 4,
    // Old WebKit does not have Object.preventExtensions/freeze method,
    // return new empty object instead with no [[set]] accessor
    Object.defineProperty( this.cache = {}, 0, {
      get: function() {
        return {};
      }
    });

    this.expando = jQuery.expando + Math.random();
  }

  Data.uid = 1;

  Data.accepts = function( owner ) {
    // Accepts only:
    //  - Node
    //    - Node.ELEMENT_NODE
    //    - Node.DOCUMENT_NODE
    //  - Object
    //    - Any
    return owner.nodeType ?
      owner.nodeType === 1 || owner.nodeType === 9 : true;
  };

  Data.prototype = {
    key: function( owner ) {
      // We can accept data for non-element nodes in modern browsers,
      // but we should not, see #8335.
      // Always return the key for a frozen object.
      if ( !Data.accepts( owner ) ) {
        return 0;
      }

      var descriptor = {},
      // Check if the owner object already has a cache key
        unlock = owner[ this.expando ];

      // If not, create one
      if ( !unlock ) {
        unlock = Data.uid++;

        // Secure it in a non-enumerable, non-writable property
        try {
          descriptor[ this.expando ] = { value: unlock };
          Object.defineProperties( owner, descriptor );

          // Support: Android < 4
          // Fallback to a less secure definition
        } catch ( e ) {
          descriptor[ this.expando ] = unlock;
          jQuery.extend( owner, descriptor );
        }
      }

      // Ensure the cache object
      if ( !this.cache[ unlock ] ) {
        this.cache[ unlock ] = {};
      }

      return unlock;
    },
    set: function( owner, data, value ) {
      var prop,
      // There may be an unlock assigned to this node,
      // if there is no entry for this "owner", create one inline
      // and set the unlock as though an owner entry had always existed
        unlock = this.key( owner ),
        cache = this.cache[ unlock ];

      // Handle: [ owner, key, value ] args
      if ( typeof data === "string" ) {
        cache[ data ] = value;

        // Handle: [ owner, { properties } ] args
      } else {
        // Fresh assignments by object are shallow copied
        if ( jQuery.isEmptyObject( cache ) ) {
          jQuery.extend( this.cache[ unlock ], data );
          // Otherwise, copy the properties one-by-one to the cache object
        } else {
          for ( prop in data ) {
            cache[ prop ] = data[ prop ];
          }
        }
      }
      return cache;
    },
    get: function( owner, key ) {
      // Either a valid cache is found, or will be created.
      // New caches will be created and the unlock returned,
      // allowing direct access to the newly created
      // empty data object. A valid owner object must be provided.
      var cache = this.cache[ this.key( owner ) ];

      return key === undefined ?
        cache : cache[ key ];
    },
    access: function( owner, key, value ) {
      var stored;
      // In cases where either:
      //
      //   1. No key was specified
      //   2. A string key was specified, but no value provided
      //
      // Take the "read" path and allow the get method to determine
      // which value to return, respectively either:
      //
      //   1. The entire cache object
      //   2. The data stored at the key
      //
      if ( key === undefined ||
        ((key && typeof key === "string") && value === undefined) ) {

        stored = this.get( owner, key );

        return stored !== undefined ?
          stored : this.get( owner, jQuery.camelCase(key) );
      }

      // [*]When the key is not a string, or both a key and value
      // are specified, set or extend (existing objects) with either:
      //
      //   1. An object of properties
      //   2. A key and value
      //
      this.set( owner, key, value );

      // Since the "set" path can have two possible entry points
      // return the expected data based on which path was taken[*]
      return value !== undefined ? value : key;
    },
    remove: function( owner, key ) {
      var i, name, camel,
        unlock = this.key( owner ),
        cache = this.cache[ unlock ];

      if ( key === undefined ) {
        this.cache[ unlock ] = {};

      } else {
        // Support array or space separated string of keys
        if ( jQuery.isArray( key ) ) {
          // If "name" is an array of keys...
          // When data is initially created, via ("key", "val") signature,
          // keys will be converted to camelCase.
          // Since there is no way to tell _how_ a key was added, remove
          // both plain key and camelCase key. #12786
          // This will only penalize the array argument path.
          name = key.concat( key.map( jQuery.camelCase ) );
        } else {
          camel = jQuery.camelCase( key );
          // Try the string as a key before any manipulation
          if ( key in cache ) {
            name = [ key, camel ];
          } else {
            // If a key with the spaces exists, use it.
            // Otherwise, create an array by matching non-whitespace
            name = camel;
            name = name in cache ?
              [ name ] : ( name.match( core_rnotwhite ) || [] );
          }
        }

        i = name.length;
        while ( i-- ) {
          delete cache[ name[ i ] ];
        }
      }
    },
    hasData: function( owner ) {
      return !jQuery.isEmptyObject(
        this.cache[ owner[ this.expando ] ] || {}
      );
    },
    discard: function( owner ) {
      if ( owner[ this.expando ] ) {
        delete this.cache[ owner[ this.expando ] ];
      }
    }
  };

// These may be used throughout the jQuery core codebase
  data_user = new Data();
  data_priv = new Data();


  jQuery.extend({
    acceptData: Data.accepts,

    hasData: function( elem ) {
      return data_user.hasData( elem ) || data_priv.hasData( elem );
    },

    data: function( elem, name, data ) {
      return data_user.access( elem, name, data );
    },

    removeData: function( elem, name ) {
      data_user.remove( elem, name );
    },

    // TODO: Now that all calls to _data and _removeData have been replaced
    // with direct calls to data_priv methods, these can be deprecated.
    _data: function( elem, name, data ) {
      return data_priv.access( elem, name, data );
    },

    _removeData: function( elem, name ) {
      data_priv.remove( elem, name );
    }
  });

  jQuery.fn.extend({
    data: function( key, value ) {
      var attrs, name,
        elem = this[ 0 ],
        i = 0,
        data = null;

      // Gets all values
      if ( key === undefined ) {
        if ( this.length ) {
          data = data_user.get( elem );

          if ( elem.nodeType === 1 && !data_priv.get( elem, "hasDataAttrs" ) ) {
            attrs = elem.attributes;
            for ( ; i < attrs.length; i++ ) {
              name = attrs[ i ].name;

              if ( name.indexOf( "data-" ) === 0 ) {
                name = jQuery.camelCase( name.slice(5) );
                dataAttr( elem, name, data[ name ] );
              }
            }
            data_priv.set( elem, "hasDataAttrs", true );
          }
        }

        return data;
      }

      // Sets multiple values
      if ( typeof key === "object" ) {
        return this.each(function() {
          data_user.set( this, key );
        });
      }

      return jQuery.access( this, function( value ) {
        var data,
          camelKey = jQuery.camelCase( key );

        // The calling jQuery object (element matches) is not empty
        // (and therefore has an element appears at this[ 0 ]) and the
        // `value` parameter was not undefined. An empty jQuery object
        // will result in `undefined` for elem = this[ 0 ] which will
        // throw an exception if an attempt to read a data cache is made.
        if ( elem && value === undefined ) {
          // Attempt to get data from the cache
          // with the key as-is
          data = data_user.get( elem, key );
          if ( data !== undefined ) {
            return data;
          }

          // Attempt to get data from the cache
          // with the key camelized
          data = data_user.get( elem, camelKey );
          if ( data !== undefined ) {
            return data;
          }

          // Attempt to "discover" the data in
          // HTML5 custom data-* attrs
          data = dataAttr( elem, camelKey, undefined );
          if ( data !== undefined ) {
            return data;
          }

          // We tried really hard, but the data doesn't exist.
          return;
        }

        // Set the data...
        this.each(function() {
          // First, attempt to store a copy or reference of any
          // data that might've been store with a camelCased key.
          var data = data_user.get( this, camelKey );

          // For HTML5 data-* attribute interop, we have to
          // store property names with dashes in a camelCase form.
          // This might not apply to all properties...*
          data_user.set( this, camelKey, value );

          // *... In the case of properties that might _actually_
          // have dashes, we need to also store a copy of that
          // unchanged property.
          if ( key.indexOf("-") !== -1 && data !== undefined ) {
            data_user.set( this, key, value );
          }
        });
      }, null, value, arguments.length > 1, null, true );
    },

    removeData: function( key ) {
      return this.each(function() {
        data_user.remove( this, key );
      });
    }
  });

  function dataAttr( elem, key, data ) {
    var name;

    // If nothing was found internally, try to fetch any
    // data from the HTML5 data-* attribute
    if ( data === undefined && elem.nodeType === 1 ) {
      name = "data-" + key.replace( rmultiDash, "-$1" ).toLowerCase();
      data = elem.getAttribute( name );

      if ( typeof data === "string" ) {
        try {
          data = data === "true" ? true :
            data === "false" ? false :
              data === "null" ? null :
                // Only convert to a number if it doesn't change the string
                +data + "" === data ? +data :
                  rbrace.test( data ) ? JSON.parse( data ) :
                    data;
        } catch( e ) {}

        // Make sure we set the data so it isn't changed later
        data_user.set( elem, key, data );
      } else {
        data = undefined;
      }
    }
    return data;
  }
  jQuery.extend({
    queue: function( elem, type, data ) {
      var queue;

      if ( elem ) {
        type = ( type || "fx" ) + "queue";
        queue = data_priv.get( elem, type );

        // Speed up dequeue by getting out quickly if this is just a lookup
        if ( data ) {
          if ( !queue || jQuery.isArray( data ) ) {
            queue = data_priv.access( elem, type, jQuery.makeArray(data) );
          } else {
            queue.push( data );
          }
        }
        return queue || [];
      }
    },

    dequeue: function( elem, type ) {
      type = type || "fx";

      var queue = jQuery.queue( elem, type ),
        startLength = queue.length,
        fn = queue.shift(),
        hooks = jQuery._queueHooks( elem, type ),
        next = function() {
          jQuery.dequeue( elem, type );
        };

      // If the fx queue is dequeued, always remove the progress sentinel
      if ( fn === "inprogress" ) {
        fn = queue.shift();
        startLength--;
      }

      if ( fn ) {

        // Add a progress sentinel to prevent the fx queue from being
        // automatically dequeued
        if ( type === "fx" ) {
          queue.unshift( "inprogress" );
        }

        // clear up the last queue stop function
        delete hooks.stop;
        fn.call( elem, next, hooks );
      }

      if ( !startLength && hooks ) {
        hooks.empty.fire();
      }
    },

    // not intended for public consumption - generates a queueHooks object, or returns the current one
    _queueHooks: function( elem, type ) {
      var key = type + "queueHooks";
      return data_priv.get( elem, key ) || data_priv.access( elem, key, {
        empty: jQuery.Callbacks("once memory").add(function() {
          data_priv.remove( elem, [ type + "queue", key ] );
        })
      });
    }
  });

  jQuery.fn.extend({
    queue: function( type, data ) {
      var setter = 2;

      if ( typeof type !== "string" ) {
        data = type;
        type = "fx";
        setter--;
      }

      if ( arguments.length < setter ) {
        return jQuery.queue( this[0], type );
      }

      return data === undefined ?
        this :
        this.each(function() {
          var queue = jQuery.queue( this, type, data );

          // ensure a hooks for this queue
          jQuery._queueHooks( this, type );

          if ( type === "fx" && queue[0] !== "inprogress" ) {
            jQuery.dequeue( this, type );
          }
        });
    },
    dequeue: function( type ) {
      return this.each(function() {
        jQuery.dequeue( this, type );
      });
    },
    // Based off of the plugin by Clint Helfers, with permission.
    // http://blindsignals.com/index.php/2009/07/jquery-delay/
    delay: function( time, type ) {
      time = jQuery.fx ? jQuery.fx.speeds[ time ] || time : time;
      type = type || "fx";

      return this.queue( type, function( next, hooks ) {
        var timeout = setTimeout( next, time );
        hooks.stop = function() {
          clearTimeout( timeout );
        };
      });
    },
    clearQueue: function( type ) {
      return this.queue( type || "fx", [] );
    },
    // Get a promise resolved when queues of a certain type
    // are emptied (fx is the type by default)
    promise: function( type, obj ) {
      var tmp,
        count = 1,
        defer = jQuery.Deferred(),
        elements = this,
        i = this.length,
        resolve = function() {
          if ( !( --count ) ) {
            defer.resolveWith( elements, [ elements ] );
          }
        };

      if ( typeof type !== "string" ) {
        obj = type;
        type = undefined;
      }
      type = type || "fx";

      while( i-- ) {
        tmp = data_priv.get( elements[ i ], type + "queueHooks" );
        if ( tmp && tmp.empty ) {
          count++;
          tmp.empty.add( resolve );
        }
      }
      resolve();
      return defer.promise( obj );
    }
  });
  var nodeHook, boolHook,
    rclass = /[\t\r\n\f]/g,
    rreturn = /\r/g,
    rfocusable = /^(?:input|select|textarea|button)$/i;

  jQuery.fn.extend({
    attr: function( name, value ) {
      return jQuery.access( this, jQuery.attr, name, value, arguments.length > 1 );
    },

    removeAttr: function( name ) {
      return this.each(function() {
        jQuery.removeAttr( this, name );
      });
    },

    prop: function( name, value ) {
      return jQuery.access( this, jQuery.prop, name, value, arguments.length > 1 );
    },

    removeProp: function( name ) {
      return this.each(function() {
        delete this[ jQuery.propFix[ name ] || name ];
      });
    },

    addClass: function( value ) {
      var classes, elem, cur, clazz, j,
        i = 0,
        len = this.length,
        proceed = typeof value === "string" && value;

      if ( jQuery.isFunction( value ) ) {
        return this.each(function( j ) {
          jQuery( this ).addClass( value.call( this, j, this.className ) );
        });
      }

      if ( proceed ) {
        // The disjunction here is for better compressibility (see removeClass)
        classes = ( value || "" ).match( core_rnotwhite ) || [];

        for ( ; i < len; i++ ) {
          elem = this[ i ];
          cur = elem.nodeType === 1 && ( elem.className ?
            ( " " + elem.className + " " ).replace( rclass, " " ) :
            " "
            );

          if ( cur ) {
            j = 0;
            while ( (clazz = classes[j++]) ) {
              if ( cur.indexOf( " " + clazz + " " ) < 0 ) {
                cur += clazz + " ";
              }
            }
            elem.className = jQuery.trim( cur );

          }
        }
      }

      return this;
    },

    removeClass: function( value ) {
      var classes, elem, cur, clazz, j,
        i = 0,
        len = this.length,
        proceed = arguments.length === 0 || typeof value === "string" && value;

      if ( jQuery.isFunction( value ) ) {
        return this.each(function( j ) {
          jQuery( this ).removeClass( value.call( this, j, this.className ) );
        });
      }
      if ( proceed ) {
        classes = ( value || "" ).match( core_rnotwhite ) || [];

        for ( ; i < len; i++ ) {
          elem = this[ i ];
          // This expression is here for better compressibility (see addClass)
          cur = elem.nodeType === 1 && ( elem.className ?
            ( " " + elem.className + " " ).replace( rclass, " " ) :
            ""
            );

          if ( cur ) {
            j = 0;
            while ( (clazz = classes[j++]) ) {
              // Remove *all* instances
              while ( cur.indexOf( " " + clazz + " " ) >= 0 ) {
                cur = cur.replace( " " + clazz + " ", " " );
              }
            }
            elem.className = value ? jQuery.trim( cur ) : "";
          }
        }
      }

      return this;
    },

    toggleClass: function( value, stateVal ) {
      var type = typeof value;

      if ( typeof stateVal === "boolean" && type === "string" ) {
        return stateVal ? this.addClass( value ) : this.removeClass( value );
      }

      if ( jQuery.isFunction( value ) ) {
        return this.each(function( i ) {
          jQuery( this ).toggleClass( value.call(this, i, this.className, stateVal), stateVal );
        });
      }

      return this.each(function() {
        if ( type === "string" ) {
          // toggle individual class names
          var className,
            i = 0,
            self = jQuery( this ),
            classNames = value.match( core_rnotwhite ) || [];

          while ( (className = classNames[ i++ ]) ) {
            // check each className given, space separated list
            if ( self.hasClass( className ) ) {
              self.removeClass( className );
            } else {
              self.addClass( className );
            }
          }

          // Toggle whole class name
        } else if ( type === core_strundefined || type === "boolean" ) {
          if ( this.className ) {
            // store className if set
            data_priv.set( this, "__className__", this.className );
          }

          // If the element has a class name or if we're passed "false",
          // then remove the whole classname (if there was one, the above saved it).
          // Otherwise bring back whatever was previously saved (if anything),
          // falling back to the empty string if nothing was stored.
          this.className = this.className || value === false ? "" : data_priv.get( this, "__className__" ) || "";
        }
      });
    },

    hasClass: function( selector ) {
      var className = " " + selector + " ",
        i = 0,
        l = this.length;
      for ( ; i < l; i++ ) {
        if ( this[i].nodeType === 1 && (" " + this[i].className + " ").replace(rclass, " ").indexOf( className ) >= 0 ) {
          return true;
        }
      }

      return false;
    },

    val: function( value ) {
      var hooks, ret, isFunction,
        elem = this[0];

      if ( !arguments.length ) {
        if ( elem ) {
          hooks = jQuery.valHooks[ elem.type ] || jQuery.valHooks[ elem.nodeName.toLowerCase() ];

          if ( hooks && "get" in hooks && (ret = hooks.get( elem, "value" )) !== undefined ) {
            return ret;
          }

          ret = elem.value;

          return typeof ret === "string" ?
            // handle most common string cases
            ret.replace(rreturn, "") :
            // handle cases where value is null/undef or number
            ret == null ? "" : ret;
        }

        return;
      }

      isFunction = jQuery.isFunction( value );

      return this.each(function( i ) {
        var val;

        if ( this.nodeType !== 1 ) {
          return;
        }

        if ( isFunction ) {
          val = value.call( this, i, jQuery( this ).val() );
        } else {
          val = value;
        }

        // Treat null/undefined as ""; convert numbers to string
        if ( val == null ) {
          val = "";
        } else if ( typeof val === "number" ) {
          val += "";
        } else if ( jQuery.isArray( val ) ) {
          val = jQuery.map(val, function ( value ) {
            return value == null ? "" : value + "";
          });
        }

        hooks = jQuery.valHooks[ this.type ] || jQuery.valHooks[ this.nodeName.toLowerCase() ];

        // If set returns undefined, fall back to normal setting
        if ( !hooks || !("set" in hooks) || hooks.set( this, val, "value" ) === undefined ) {
          this.value = val;
        }
      });
    }
  });

  jQuery.extend({
    valHooks: {
      option: {
        get: function( elem ) {
          // attributes.value is undefined in Blackberry 4.7 but
          // uses .value. See #6932
          var val = elem.attributes.value;
          return !val || val.specified ? elem.value : elem.text;
        }
      },
      select: {
        get: function( elem ) {
          var value, option,
            options = elem.options,
            index = elem.selectedIndex,
            one = elem.type === "select-one" || index < 0,
            values = one ? null : [],
            max = one ? index + 1 : options.length,
            i = index < 0 ?
              max :
              one ? index : 0;

          // Loop through all the selected options
          for ( ; i < max; i++ ) {
            option = options[ i ];

            // IE6-9 doesn't update selected after form reset (#2551)
            if ( ( option.selected || i === index ) &&
              // Don't return options that are disabled or in a disabled optgroup
              ( jQuery.support.optDisabled ? !option.disabled : option.getAttribute("disabled") === null ) &&
              ( !option.parentNode.disabled || !jQuery.nodeName( option.parentNode, "optgroup" ) ) ) {

              // Get the specific value for the option
              value = jQuery( option ).val();

              // We don't need an array for one selects
              if ( one ) {
                return value;
              }

              // Multi-Selects return an array
              values.push( value );
            }
          }

          return values;
        },

        set: function( elem, value ) {
          var optionSet, option,
            options = elem.options,
            values = jQuery.makeArray( value ),
            i = options.length;

          while ( i-- ) {
            option = options[ i ];
            if ( (option.selected = jQuery.inArray( jQuery(option).val(), values ) >= 0) ) {
              optionSet = true;
            }
          }

          // force browsers to behave consistently when non-matching value is set
          if ( !optionSet ) {
            elem.selectedIndex = -1;
          }
          return values;
        }
      }
    },

    attr: function( elem, name, value ) {
      var hooks, ret,
        nType = elem.nodeType;

      // don't get/set attributes on text, comment and attribute nodes
      if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
        return;
      }

      // Fallback to prop when attributes are not supported
      if ( typeof elem.getAttribute === core_strundefined ) {
        return jQuery.prop( elem, name, value );
      }

      // All attributes are lowercase
      // Grab necessary hook if one is defined
      if ( nType !== 1 || !jQuery.isXMLDoc( elem ) ) {
        name = name.toLowerCase();
        hooks = jQuery.attrHooks[ name ] ||
          ( jQuery.expr.match.bool.test( name ) ? boolHook : nodeHook );
      }

      if ( value !== undefined ) {

        if ( value === null ) {
          jQuery.removeAttr( elem, name );

        } else if ( hooks && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ) {
          return ret;

        } else {
          elem.setAttribute( name, value + "" );
          return value;
        }

      } else if ( hooks && "get" in hooks && (ret = hooks.get( elem, name )) !== null ) {
        return ret;

      } else {
        ret = jQuery.find.attr( elem, name );

        // Non-existent attributes return null, we normalize to undefined
        return ret == null ?
          undefined :
          ret;
      }
    },

    removeAttr: function( elem, value ) {
      var name, propName,
        i = 0,
        attrNames = value && value.match( core_rnotwhite );

      if ( attrNames && elem.nodeType === 1 ) {
        while ( (name = attrNames[i++]) ) {
          propName = jQuery.propFix[ name ] || name;

          // Boolean attributes get special treatment (#10870)
          if ( jQuery.expr.match.bool.test( name ) ) {
            // Set corresponding property to false
            elem[ propName ] = false;
          }

          elem.removeAttribute( name );
        }
      }
    },

    attrHooks: {
      type: {
        set: function( elem, value ) {
          if ( !jQuery.support.radioValue && value === "radio" && jQuery.nodeName(elem, "input") ) {
            // Setting the type on a radio button after the value resets the value in IE6-9
            // Reset value to default in case type is set after value during creation
            var val = elem.value;
            elem.setAttribute( "type", value );
            if ( val ) {
              elem.value = val;
            }
            return value;
          }
        }
      }
    },

    propFix: {
      "for": "htmlFor",
      "class": "className"
    },

    prop: function( elem, name, value ) {
      var ret, hooks, notxml,
        nType = elem.nodeType;

      // don't get/set properties on text, comment and attribute nodes
      if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
        return;
      }

      notxml = nType !== 1 || !jQuery.isXMLDoc( elem );

      if ( notxml ) {
        // Fix name and attach hooks
        name = jQuery.propFix[ name ] || name;
        hooks = jQuery.propHooks[ name ];
      }

      if ( value !== undefined ) {
        return hooks && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ?
          ret :
          ( elem[ name ] = value );

      } else {
        return hooks && "get" in hooks && (ret = hooks.get( elem, name )) !== null ?
          ret :
          elem[ name ];
      }
    },

    propHooks: {
      tabIndex: {
        get: function( elem ) {
          return elem.hasAttribute( "tabindex" ) || rfocusable.test( elem.nodeName ) || elem.href ?
            elem.tabIndex :
            -1;
        }
      }
    }
  });

// Hooks for boolean attributes
  boolHook = {
    set: function( elem, value, name ) {
      if ( value === false ) {
        // Remove boolean attributes when set to false
        jQuery.removeAttr( elem, name );
      } else {
        elem.setAttribute( name, name );
      }
      return name;
    }
  };
  jQuery.each( jQuery.expr.match.bool.source.match( /\w+/g ), function( i, name ) {
    var getter = jQuery.expr.attrHandle[ name ] || jQuery.find.attr;

    jQuery.expr.attrHandle[ name ] = function( elem, name, isXML ) {
      var fn = jQuery.expr.attrHandle[ name ],
        ret = isXML ?
          undefined :
          /* jshint eqeqeq: false */
          // Temporarily disable this handler to check existence
          (jQuery.expr.attrHandle[ name ] = undefined) !=
            getter( elem, name, isXML ) ?

            name.toLowerCase() :
            null;

      // Restore handler
      jQuery.expr.attrHandle[ name ] = fn;

      return ret;
    };
  });

// Support: IE9+
// Selectedness for an option in an optgroup can be inaccurate
  if ( !jQuery.support.optSelected ) {
    jQuery.propHooks.selected = {
      get: function( elem ) {
        var parent = elem.parentNode;
        if ( parent && parent.parentNode ) {
          parent.parentNode.selectedIndex;
        }
        return null;
      }
    };
  }

  jQuery.each([
    "tabIndex",
    "readOnly",
    "maxLength",
    "cellSpacing",
    "cellPadding",
    "rowSpan",
    "colSpan",
    "useMap",
    "frameBorder",
    "contentEditable"
  ], function() {
    jQuery.propFix[ this.toLowerCase() ] = this;
  });

// Radios and checkboxes getter/setter
  jQuery.each([ "radio", "checkbox" ], function() {
    jQuery.valHooks[ this ] = {
      set: function( elem, value ) {
        if ( jQuery.isArray( value ) ) {
          return ( elem.checked = jQuery.inArray( jQuery(elem).val(), value ) >= 0 );
        }
      }
    };
    if ( !jQuery.support.checkOn ) {
      jQuery.valHooks[ this ].get = function( elem ) {
        // Support: Webkit
        // "" is returned instead of "on" if a value isn't specified
        return elem.getAttribute("value") === null ? "on" : elem.value;
      };
    }
  });
  var rkeyEvent = /^key/,
    rmouseEvent = /^(?:mouse|contextmenu)|click/,
    rfocusMorph = /^(?:focusinfocus|focusoutblur)$/,
    rtypenamespace = /^([^.]*)(?:\.(.+)|)$/;

  function returnTrue() {
    return true;
  }

  function returnFalse() {
    return false;
  }

  function safeActiveElement() {
    try {
      return document.activeElement;
    } catch ( err ) { }
  }

  /*
   * Helper functions for managing events -- not part of the public interface.
   * Props to Dean Edwards' addEvent library for many of the ideas.
   */
  jQuery.event = {

    global: {},

    add: function( elem, types, handler, data, selector ) {

      var handleObjIn, eventHandle, tmp,
        events, t, handleObj,
        special, handlers, type, namespaces, origType,
        elemData = data_priv.get( elem );

      // Don't attach events to noData or text/comment nodes (but allow plain objects)
      if ( !elemData ) {
        return;
      }

      // Caller can pass in an object of custom data in lieu of the handler
      if ( handler.handler ) {
        handleObjIn = handler;
        handler = handleObjIn.handler;
        selector = handleObjIn.selector;
      }

      // Make sure that the handler has a unique ID, used to find/remove it later
      if ( !handler.guid ) {
        handler.guid = jQuery.guid++;
      }

      // Init the element's event structure and main handler, if this is the first
      if ( !(events = elemData.events) ) {
        events = elemData.events = {};
      }
      if ( !(eventHandle = elemData.handle) ) {
        eventHandle = elemData.handle = function( e ) {
          // Discard the second event of a jQuery.event.trigger() and
          // when an event is called after a page has unloaded
          return typeof jQuery !== core_strundefined && (!e || jQuery.event.triggered !== e.type) ?
            jQuery.event.dispatch.apply( eventHandle.elem, arguments ) :
            undefined;
        };
        // Add elem as a property of the handle fn to prevent a memory leak with IE non-native events
        eventHandle.elem = elem;
      }

      // Handle multiple events separated by a space
      types = ( types || "" ).match( core_rnotwhite ) || [""];
      t = types.length;
      while ( t-- ) {
        tmp = rtypenamespace.exec( types[t] ) || [];
        type = origType = tmp[1];
        namespaces = ( tmp[2] || "" ).split( "." ).sort();

        // There *must* be a type, no attaching namespace-only handlers
        if ( !type ) {
          continue;
        }

        // If event changes its type, use the special event handlers for the changed type
        special = jQuery.event.special[ type ] || {};

        // If selector defined, determine special event api type, otherwise given type
        type = ( selector ? special.delegateType : special.bindType ) || type;

        // Update special based on newly reset type
        special = jQuery.event.special[ type ] || {};

        // handleObj is passed to all event handlers
        handleObj = jQuery.extend({
          type: type,
          origType: origType,
          data: data,
          handler: handler,
          guid: handler.guid,
          selector: selector,
          needsContext: selector && jQuery.expr.match.needsContext.test( selector ),
          namespace: namespaces.join(".")
        }, handleObjIn );

        // Init the event handler queue if we're the first
        if ( !(handlers = events[ type ]) ) {
          handlers = events[ type ] = [];
          handlers.delegateCount = 0;

          // Only use addEventListener if the special events handler returns false
          if ( !special.setup || special.setup.call( elem, data, namespaces, eventHandle ) === false ) {
            if ( elem.addEventListener ) {
              elem.addEventListener( type, eventHandle, false );
            }
          }
        }

        if ( special.add ) {
          special.add.call( elem, handleObj );

          if ( !handleObj.handler.guid ) {
            handleObj.handler.guid = handler.guid;
          }
        }

        // Add to the element's handler list, delegates in front
        if ( selector ) {
          handlers.splice( handlers.delegateCount++, 0, handleObj );
        } else {
          handlers.push( handleObj );
        }

        // Keep track of which events have ever been used, for event optimization
        jQuery.event.global[ type ] = true;
      }

      // Nullify elem to prevent memory leaks in IE
      elem = null;
    },

    // Detach an event or set of events from an element
    remove: function( elem, types, handler, selector, mappedTypes ) {

      var j, origCount, tmp,
        events, t, handleObj,
        special, handlers, type, namespaces, origType,
        elemData = data_priv.hasData( elem ) && data_priv.get( elem );

      if ( !elemData || !(events = elemData.events) ) {
        return;
      }

      // Once for each type.namespace in types; type may be omitted
      types = ( types || "" ).match( core_rnotwhite ) || [""];
      t = types.length;
      while ( t-- ) {
        tmp = rtypenamespace.exec( types[t] ) || [];
        type = origType = tmp[1];
        namespaces = ( tmp[2] || "" ).split( "." ).sort();

        // Unbind all events (on this namespace, if provided) for the element
        if ( !type ) {
          for ( type in events ) {
            jQuery.event.remove( elem, type + types[ t ], handler, selector, true );
          }
          continue;
        }

        special = jQuery.event.special[ type ] || {};
        type = ( selector ? special.delegateType : special.bindType ) || type;
        handlers = events[ type ] || [];
        tmp = tmp[2] && new RegExp( "(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)" );

        // Remove matching events
        origCount = j = handlers.length;
        while ( j-- ) {
          handleObj = handlers[ j ];

          if ( ( mappedTypes || origType === handleObj.origType ) &&
            ( !handler || handler.guid === handleObj.guid ) &&
            ( !tmp || tmp.test( handleObj.namespace ) ) &&
            ( !selector || selector === handleObj.selector || selector === "**" && handleObj.selector ) ) {
            handlers.splice( j, 1 );

            if ( handleObj.selector ) {
              handlers.delegateCount--;
            }
            if ( special.remove ) {
              special.remove.call( elem, handleObj );
            }
          }
        }

        // Remove generic event handler if we removed something and no more handlers exist
        // (avoids potential for endless recursion during removal of special event handlers)
        if ( origCount && !handlers.length ) {
          if ( !special.teardown || special.teardown.call( elem, namespaces, elemData.handle ) === false ) {
            jQuery.removeEvent( elem, type, elemData.handle );
          }

          delete events[ type ];
        }
      }

      // Remove the expando if it's no longer used
      if ( jQuery.isEmptyObject( events ) ) {
        delete elemData.handle;
        data_priv.remove( elem, "events" );
      }
    },

    trigger: function( event, data, elem, onlyHandlers ) {

      var i, cur, tmp, bubbleType, ontype, handle, special,
        eventPath = [ elem || document ],
        type = core_hasOwn.call( event, "type" ) ? event.type : event,
        namespaces = core_hasOwn.call( event, "namespace" ) ? event.namespace.split(".") : [];

      cur = tmp = elem = elem || document;

      // Don't do events on text and comment nodes
      if ( elem.nodeType === 3 || elem.nodeType === 8 ) {
        return;
      }

      // focus/blur morphs to focusin/out; ensure we're not firing them right now
      if ( rfocusMorph.test( type + jQuery.event.triggered ) ) {
        return;
      }

      if ( type.indexOf(".") >= 0 ) {
        // Namespaced trigger; create a regexp to match event type in handle()
        namespaces = type.split(".");
        type = namespaces.shift();
        namespaces.sort();
      }
      ontype = type.indexOf(":") < 0 && "on" + type;

      // Caller can pass in a jQuery.Event object, Object, or just an event type string
      event = event[ jQuery.expando ] ?
        event :
        new jQuery.Event( type, typeof event === "object" && event );

      // Trigger bitmask: & 1 for native handlers; & 2 for jQuery (always true)
      event.isTrigger = onlyHandlers ? 2 : 3;
      event.namespace = namespaces.join(".");
      event.namespace_re = event.namespace ?
        new RegExp( "(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)" ) :
        null;

      // Clean up the event in case it is being reused
      event.result = undefined;
      if ( !event.target ) {
        event.target = elem;
      }

      // Clone any incoming data and prepend the event, creating the handler arg list
      data = data == null ?
        [ event ] :
        jQuery.makeArray( data, [ event ] );

      // Allow special events to draw outside the lines
      special = jQuery.event.special[ type ] || {};
      if ( !onlyHandlers && special.trigger && special.trigger.apply( elem, data ) === false ) {
        return;
      }

      // Determine event propagation path in advance, per W3C events spec (#9951)
      // Bubble up to document, then to window; watch for a global ownerDocument var (#9724)
      if ( !onlyHandlers && !special.noBubble && !jQuery.isWindow( elem ) ) {

        bubbleType = special.delegateType || type;
        if ( !rfocusMorph.test( bubbleType + type ) ) {
          cur = cur.parentNode;
        }
        for ( ; cur; cur = cur.parentNode ) {
          eventPath.push( cur );
          tmp = cur;
        }

        // Only add window if we got to document (e.g., not plain obj or detached DOM)
        if ( tmp === (elem.ownerDocument || document) ) {
          eventPath.push( tmp.defaultView || tmp.parentWindow || window );
        }
      }

      // Fire handlers on the event path
      i = 0;
      while ( (cur = eventPath[i++]) && !event.isPropagationStopped() ) {

        event.type = i > 1 ?
          bubbleType :
          special.bindType || type;

        // jQuery handler
        handle = ( data_priv.get( cur, "events" ) || {} )[ event.type ] && data_priv.get( cur, "handle" );
        if ( handle ) {
          handle.apply( cur, data );
        }

        // Native handler
        handle = ontype && cur[ ontype ];
        if ( handle && jQuery.acceptData( cur ) && handle.apply && handle.apply( cur, data ) === false ) {
          event.preventDefault();
        }
      }
      event.type = type;

      // If nobody prevented the default action, do it now
      if ( !onlyHandlers && !event.isDefaultPrevented() ) {

        if ( (!special._default || special._default.apply( eventPath.pop(), data ) === false) &&
          jQuery.acceptData( elem ) ) {

          // Call a native DOM method on the target with the same name name as the event.
          // Don't do default actions on window, that's where global variables be (#6170)
          if ( ontype && jQuery.isFunction( elem[ type ] ) && !jQuery.isWindow( elem ) ) {

            // Don't re-trigger an onFOO event when we call its FOO() method
            tmp = elem[ ontype ];

            if ( tmp ) {
              elem[ ontype ] = null;
            }

            // Prevent re-triggering of the same event, since we already bubbled it above
            jQuery.event.triggered = type;
            elem[ type ]();
            jQuery.event.triggered = undefined;

            if ( tmp ) {
              elem[ ontype ] = tmp;
            }
          }
        }
      }

      return event.result;
    },

    dispatch: function( event ) {

      // Make a writable jQuery.Event from the native event object
      event = jQuery.event.fix( event );

      var i, j, ret, matched, handleObj,
        handlerQueue = [],
        args = core_slice.call( arguments ),
        handlers = ( data_priv.get( this, "events" ) || {} )[ event.type ] || [],
        special = jQuery.event.special[ event.type ] || {};

      // Use the fix-ed jQuery.Event rather than the (read-only) native event
      args[0] = event;
      event.delegateTarget = this;

      // Call the preDispatch hook for the mapped type, and let it bail if desired
      if ( special.preDispatch && special.preDispatch.call( this, event ) === false ) {
        return;
      }

      // Determine handlers
      handlerQueue = jQuery.event.handlers.call( this, event, handlers );

      // Run delegates first; they may want to stop propagation beneath us
      i = 0;
      while ( (matched = handlerQueue[ i++ ]) && !event.isPropagationStopped() ) {
        event.currentTarget = matched.elem;

        j = 0;
        while ( (handleObj = matched.handlers[ j++ ]) && !event.isImmediatePropagationStopped() ) {

          // Triggered event must either 1) have no namespace, or
          // 2) have namespace(s) a subset or equal to those in the bound event (both can have no namespace).
          if ( !event.namespace_re || event.namespace_re.test( handleObj.namespace ) ) {

            event.handleObj = handleObj;
            event.data = handleObj.data;

            ret = ( (jQuery.event.special[ handleObj.origType ] || {}).handle || handleObj.handler )
              .apply( matched.elem, args );

            if ( ret !== undefined ) {
              if ( (event.result = ret) === false ) {
                event.preventDefault();
                event.stopPropagation();
              }
            }
          }
        }
      }

      // Call the postDispatch hook for the mapped type
      if ( special.postDispatch ) {
        special.postDispatch.call( this, event );
      }

      return event.result;
    },

    handlers: function( event, handlers ) {
      var i, matches, sel, handleObj,
        handlerQueue = [],
        delegateCount = handlers.delegateCount,
        cur = event.target;

      // Find delegate handlers
      // Black-hole SVG <use> instance trees (#13180)
      // Avoid non-left-click bubbling in Firefox (#3861)
      if ( delegateCount && cur.nodeType && (!event.button || event.type !== "click") ) {

        for ( ; cur !== this; cur = cur.parentNode || this ) {

          // Don't process clicks on disabled elements (#6911, #8165, #11382, #11764)
          if ( cur.disabled !== true || event.type !== "click" ) {
            matches = [];
            for ( i = 0; i < delegateCount; i++ ) {
              handleObj = handlers[ i ];

              // Don't conflict with Object.prototype properties (#13203)
              sel = handleObj.selector + " ";

              if ( matches[ sel ] === undefined ) {
                matches[ sel ] = handleObj.needsContext ?
                  jQuery( sel, this ).index( cur ) >= 0 :
                  jQuery.find( sel, this, null, [ cur ] ).length;
              }
              if ( matches[ sel ] ) {
                matches.push( handleObj );
              }
            }
            if ( matches.length ) {
              handlerQueue.push({ elem: cur, handlers: matches });
            }
          }
        }
      }

      // Add the remaining (directly-bound) handlers
      if ( delegateCount < handlers.length ) {
        handlerQueue.push({ elem: this, handlers: handlers.slice( delegateCount ) });
      }

      return handlerQueue;
    },

    // Includes some event props shared by KeyEvent and MouseEvent
    props: "altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),

    fixHooks: {},

    keyHooks: {
      props: "char charCode key keyCode".split(" "),
      filter: function( event, original ) {

        // Add which for key events
        if ( event.which == null ) {
          event.which = original.charCode != null ? original.charCode : original.keyCode;
        }

        return event;
      }
    },

    mouseHooks: {
      props: "button buttons clientX clientY offsetX offsetY pageX pageY screenX screenY toElement".split(" "),
      filter: function( event, original ) {
        var eventDoc, doc, body,
          button = original.button;

        // Calculate pageX/Y if missing and clientX/Y available
        if ( event.pageX == null && original.clientX != null ) {
          eventDoc = event.target.ownerDocument || document;
          doc = eventDoc.documentElement;
          body = eventDoc.body;

          event.pageX = original.clientX + ( doc && doc.scrollLeft || body && body.scrollLeft || 0 ) - ( doc && doc.clientLeft || body && body.clientLeft || 0 );
          event.pageY = original.clientY + ( doc && doc.scrollTop  || body && body.scrollTop  || 0 ) - ( doc && doc.clientTop  || body && body.clientTop  || 0 );
        }

        // Add which for click: 1 === left; 2 === middle; 3 === right
        // Note: button is not normalized, so don't use it
        if ( !event.which && button !== undefined ) {
          event.which = ( button & 1 ? 1 : ( button & 2 ? 3 : ( button & 4 ? 2 : 0 ) ) );
        }

        return event;
      }
    },

    fix: function( event ) {
      if ( event[ jQuery.expando ] ) {
        return event;
      }

      // Create a writable copy of the event object and normalize some properties
      var i, prop, copy,
        type = event.type,
        originalEvent = event,
        fixHook = this.fixHooks[ type ];

      if ( !fixHook ) {
        this.fixHooks[ type ] = fixHook =
          rmouseEvent.test( type ) ? this.mouseHooks :
            rkeyEvent.test( type ) ? this.keyHooks :
            {};
      }
      copy = fixHook.props ? this.props.concat( fixHook.props ) : this.props;

      event = new jQuery.Event( originalEvent );

      i = copy.length;
      while ( i-- ) {
        prop = copy[ i ];
        event[ prop ] = originalEvent[ prop ];
      }

      // Support: Cordova 2.5 (WebKit) (#13255)
      // All events should have a target; Cordova deviceready doesn't
      if ( !event.target ) {
        event.target = document;
      }

      // Support: Safari 6.0+, Chrome < 28
      // Target should not be a text node (#504, #13143)
      if ( event.target.nodeType === 3 ) {
        event.target = event.target.parentNode;
      }

      return fixHook.filter? fixHook.filter( event, originalEvent ) : event;
    },

    special: {
      load: {
        // Prevent triggered image.load events from bubbling to window.load
        noBubble: true
      },
      focus: {
        // Fire native event if possible so blur/focus sequence is correct
        trigger: function() {
          if ( this !== safeActiveElement() && this.focus ) {
            this.focus();
            return false;
          }
        },
        delegateType: "focusin"
      },
      blur: {
        trigger: function() {
          if ( this === safeActiveElement() && this.blur ) {
            this.blur();
            return false;
          }
        },
        delegateType: "focusout"
      },
      click: {
        // For checkbox, fire native event so checked state will be right
        trigger: function() {
          if ( this.type === "checkbox" && this.click && jQuery.nodeName( this, "input" ) ) {
            this.click();
            return false;
          }
        },

        // For cross-browser consistency, don't fire native .click() on links
        _default: function( event ) {
          return jQuery.nodeName( event.target, "a" );
        }
      },

      beforeunload: {
        postDispatch: function( event ) {

          // Support: Firefox 20+
          // Firefox doesn't alert if the returnValue field is not set.
          if ( event.result !== undefined ) {
            event.originalEvent.returnValue = event.result;
          }
        }
      }
    },

    simulate: function( type, elem, event, bubble ) {
      // Piggyback on a donor event to simulate a different one.
      // Fake originalEvent to avoid donor's stopPropagation, but if the
      // simulated event prevents default then we do the same on the donor.
      var e = jQuery.extend(
        new jQuery.Event(),
        event,
        {
          type: type,
          isSimulated: true,
          originalEvent: {}
        }
      );
      if ( bubble ) {
        jQuery.event.trigger( e, null, elem );
      } else {
        jQuery.event.dispatch.call( elem, e );
      }
      if ( e.isDefaultPrevented() ) {
        event.preventDefault();
      }
    }
  };

  jQuery.removeEvent = function( elem, type, handle ) {
    if ( elem.removeEventListener ) {
      elem.removeEventListener( type, handle, false );
    }
  };

  jQuery.Event = function( src, props ) {
    // Allow instantiation without the 'new' keyword
    if ( !(this instanceof jQuery.Event) ) {
      return new jQuery.Event( src, props );
    }

    // Event object
    if ( src && src.type ) {
      this.originalEvent = src;
      this.type = src.type;

      // Events bubbling up the document may have been marked as prevented
      // by a handler lower down the tree; reflect the correct value.
      this.isDefaultPrevented = ( src.defaultPrevented ||
        src.getPreventDefault && src.getPreventDefault() ) ? returnTrue : returnFalse;

      // Event type
    } else {
      this.type = src;
    }

    // Put explicitly provided properties onto the event object
    if ( props ) {
      jQuery.extend( this, props );
    }

    // Create a timestamp if incoming event doesn't have one
    this.timeStamp = src && src.timeStamp || jQuery.now();

    // Mark it as fixed
    this[ jQuery.expando ] = true;
  };

// jQuery.Event is based on DOM3 Events as specified by the ECMAScript Language Binding
// http://www.w3.org/TR/2003/WD-DOM-Level-3-Events-20030331/ecma-script-binding.html
  jQuery.Event.prototype = {
    isDefaultPrevented: returnFalse,
    isPropagationStopped: returnFalse,
    isImmediatePropagationStopped: returnFalse,

    preventDefault: function() {
      var e = this.originalEvent;

      this.isDefaultPrevented = returnTrue;

      if ( e && e.preventDefault ) {
        e.preventDefault();
      }
    },
    stopPropagation: function() {
      var e = this.originalEvent;

      this.isPropagationStopped = returnTrue;

      if ( e && e.stopPropagation ) {
        e.stopPropagation();
      }
    },
    stopImmediatePropagation: function() {
      this.isImmediatePropagationStopped = returnTrue;
      this.stopPropagation();
    }
  };

// Create mouseenter/leave events using mouseover/out and event-time checks
// Support: Chrome 15+
  jQuery.each({
    mouseenter: "mouseover",
    mouseleave: "mouseout"
  }, function( orig, fix ) {
    jQuery.event.special[ orig ] = {
      delegateType: fix,
      bindType: fix,

      handle: function( event ) {
        var ret,
          target = this,
          related = event.relatedTarget,
          handleObj = event.handleObj;

        // For mousenter/leave call the handler if related is outside the target.
        // NB: No relatedTarget if the mouse left/entered the browser window
        if ( !related || (related !== target && !jQuery.contains( target, related )) ) {
          event.type = handleObj.origType;
          ret = handleObj.handler.apply( this, arguments );
          event.type = fix;
        }
        return ret;
      }
    };
  });

// Create "bubbling" focus and blur events
// Support: Firefox, Chrome, Safari
  if ( !jQuery.support.focusinBubbles ) {
    jQuery.each({ focus: "focusin", blur: "focusout" }, function( orig, fix ) {

      // Attach a single capturing handler while someone wants focusin/focusout
      var attaches = 0,
        handler = function( event ) {
          jQuery.event.simulate( fix, event.target, jQuery.event.fix( event ), true );
        };

      jQuery.event.special[ fix ] = {
        setup: function() {
          if ( attaches++ === 0 ) {
            document.addEventListener( orig, handler, true );
          }
        },
        teardown: function() {
          if ( --attaches === 0 ) {
            document.removeEventListener( orig, handler, true );
          }
        }
      };
    });
  }

  jQuery.fn.extend({

    on: function( types, selector, data, fn, /*INTERNAL*/ one ) {
      var origFn, type;

      // Types can be a map of types/handlers
      if ( typeof types === "object" ) {
        // ( types-Object, selector, data )
        if ( typeof selector !== "string" ) {
          // ( types-Object, data )
          data = data || selector;
          selector = undefined;
        }
        for ( type in types ) {
          this.on( type, selector, data, types[ type ], one );
        }
        return this;
      }

      if ( data == null && fn == null ) {
        // ( types, fn )
        fn = selector;
        data = selector = undefined;
      } else if ( fn == null ) {
        if ( typeof selector === "string" ) {
          // ( types, selector, fn )
          fn = data;
          data = undefined;
        } else {
          // ( types, data, fn )
          fn = data;
          data = selector;
          selector = undefined;
        }
      }
      if ( fn === false ) {
        fn = returnFalse;
      } else if ( !fn ) {
        return this;
      }

      if ( one === 1 ) {
        origFn = fn;
        fn = function( event ) {
          // Can use an empty set, since event contains the info
          jQuery().off( event );
          return origFn.apply( this, arguments );
        };
        // Use same guid so caller can remove using origFn
        fn.guid = origFn.guid || ( origFn.guid = jQuery.guid++ );
      }
      return this.each( function() {
        jQuery.event.add( this, types, fn, data, selector );
      });
    },
    one: function( types, selector, data, fn ) {
      return this.on( types, selector, data, fn, 1 );
    },
    off: function( types, selector, fn ) {
      var handleObj, type;
      if ( types && types.preventDefault && types.handleObj ) {
        // ( event )  dispatched jQuery.Event
        handleObj = types.handleObj;
        jQuery( types.delegateTarget ).off(
          handleObj.namespace ? handleObj.origType + "." + handleObj.namespace : handleObj.origType,
          handleObj.selector,
          handleObj.handler
        );
        return this;
      }
      if ( typeof types === "object" ) {
        // ( types-object [, selector] )
        for ( type in types ) {
          this.off( type, selector, types[ type ] );
        }
        return this;
      }
      if ( selector === false || typeof selector === "function" ) {
        // ( types [, fn] )
        fn = selector;
        selector = undefined;
      }
      if ( fn === false ) {
        fn = returnFalse;
      }
      return this.each(function() {
        jQuery.event.remove( this, types, fn, selector );
      });
    },

    trigger: function( type, data ) {
      return this.each(function() {
        jQuery.event.trigger( type, data, this );
      });
    },
    triggerHandler: function( type, data ) {
      var elem = this[0];
      if ( elem ) {
        return jQuery.event.trigger( type, data, elem, true );
      }
    }
  });
  var isSimple = /^.[^:#\[\.,]*$/,
    rparentsprev = /^(?:parents|prev(?:Until|All))/,
    rneedsContext = jQuery.expr.match.needsContext,
  // methods guaranteed to produce a unique set when starting from a unique set
    guaranteedUnique = {
      children: true,
      contents: true,
      next: true,
      prev: true
    };

  jQuery.fn.extend({
    find: function( selector ) {
      var i,
        ret = [],
        self = this,
        len = self.length;

      if ( typeof selector !== "string" ) {
        return this.pushStack( jQuery( selector ).filter(function() {
          for ( i = 0; i < len; i++ ) {
            if ( jQuery.contains( self[ i ], this ) ) {
              return true;
            }
          }
        }) );
      }

      for ( i = 0; i < len; i++ ) {
        jQuery.find( selector, self[ i ], ret );
      }

      // Needed because $( selector, context ) becomes $( context ).find( selector )
      ret = this.pushStack( len > 1 ? jQuery.unique( ret ) : ret );
      ret.selector = this.selector ? this.selector + " " + selector : selector;
      return ret;
    },

    has: function( target ) {
      var targets = jQuery( target, this ),
        l = targets.length;

      return this.filter(function() {
        var i = 0;
        for ( ; i < l; i++ ) {
          if ( jQuery.contains( this, targets[i] ) ) {
            return true;
          }
        }
      });
    },

    not: function( selector ) {
      return this.pushStack( winnow(this, selector || [], true) );
    },

    filter: function( selector ) {
      return this.pushStack( winnow(this, selector || [], false) );
    },

    is: function( selector ) {
      return !!winnow(
        this,

        // If this is a positional/relative selector, check membership in the returned set
        // so $("p:first").is("p:last") won't return true for a doc with two "p".
        typeof selector === "string" && rneedsContext.test( selector ) ?
          jQuery( selector ) :
          selector || [],
        false
      ).length;
    },

    closest: function( selectors, context ) {
      var cur,
        i = 0,
        l = this.length,
        matched = [],
        pos = ( rneedsContext.test( selectors ) || typeof selectors !== "string" ) ?
          jQuery( selectors, context || this.context ) :
          0;

      for ( ; i < l; i++ ) {
        for ( cur = this[i]; cur && cur !== context; cur = cur.parentNode ) {
          // Always skip document fragments
          if ( cur.nodeType < 11 && (pos ?
            pos.index(cur) > -1 :

            // Don't pass non-elements to Sizzle
            cur.nodeType === 1 &&
              jQuery.find.matchesSelector(cur, selectors)) ) {

            cur = matched.push( cur );
            break;
          }
        }
      }

      return this.pushStack( matched.length > 1 ? jQuery.unique( matched ) : matched );
    },

    // Determine the position of an element within
    // the matched set of elements
    index: function( elem ) {

      // No argument, return index in parent
      if ( !elem ) {
        return ( this[ 0 ] && this[ 0 ].parentNode ) ? this.first().prevAll().length : -1;
      }

      // index in selector
      if ( typeof elem === "string" ) {
        return core_indexOf.call( jQuery( elem ), this[ 0 ] );
      }

      // Locate the position of the desired element
      return core_indexOf.call( this,

        // If it receives a jQuery object, the first element is used
        elem.jquery ? elem[ 0 ] : elem
      );
    },

    add: function( selector, context ) {
      var set = typeof selector === "string" ?
          jQuery( selector, context ) :
          jQuery.makeArray( selector && selector.nodeType ? [ selector ] : selector ),
        all = jQuery.merge( this.get(), set );

      return this.pushStack( jQuery.unique(all) );
    },

    addBack: function( selector ) {
      return this.add( selector == null ?
        this.prevObject : this.prevObject.filter(selector)
      );
    }
  });

  function sibling( cur, dir ) {
    while ( (cur = cur[dir]) && cur.nodeType !== 1 ) {}

    return cur;
  }

  jQuery.each({
    parent: function( elem ) {
      var parent = elem.parentNode;
      return parent && parent.nodeType !== 11 ? parent : null;
    },
    parents: function( elem ) {
      return jQuery.dir( elem, "parentNode" );
    },
    parentsUntil: function( elem, i, until ) {
      return jQuery.dir( elem, "parentNode", until );
    },
    next: function( elem ) {
      return sibling( elem, "nextSibling" );
    },
    prev: function( elem ) {
      return sibling( elem, "previousSibling" );
    },
    nextAll: function( elem ) {
      return jQuery.dir( elem, "nextSibling" );
    },
    prevAll: function( elem ) {
      return jQuery.dir( elem, "previousSibling" );
    },
    nextUntil: function( elem, i, until ) {
      return jQuery.dir( elem, "nextSibling", until );
    },
    prevUntil: function( elem, i, until ) {
      return jQuery.dir( elem, "previousSibling", until );
    },
    siblings: function( elem ) {
      return jQuery.sibling( ( elem.parentNode || {} ).firstChild, elem );
    },
    children: function( elem ) {
      return jQuery.sibling( elem.firstChild );
    },
    contents: function( elem ) {
      return elem.contentDocument || jQuery.merge( [], elem.childNodes );
    }
  }, function( name, fn ) {
    jQuery.fn[ name ] = function( until, selector ) {
      var matched = jQuery.map( this, fn, until );

      if ( name.slice( -5 ) !== "Until" ) {
        selector = until;
      }

      if ( selector && typeof selector === "string" ) {
        matched = jQuery.filter( selector, matched );
      }

      if ( this.length > 1 ) {
        // Remove duplicates
        if ( !guaranteedUnique[ name ] ) {
          jQuery.unique( matched );
        }

        // Reverse order for parents* and prev-derivatives
        if ( rparentsprev.test( name ) ) {
          matched.reverse();
        }
      }

      return this.pushStack( matched );
    };
  });

  jQuery.extend({
    filter: function( expr, elems, not ) {
      var elem = elems[ 0 ];

      if ( not ) {
        expr = ":not(" + expr + ")";
      }

      return elems.length === 1 && elem.nodeType === 1 ?
        jQuery.find.matchesSelector( elem, expr ) ? [ elem ] : [] :
        jQuery.find.matches( expr, jQuery.grep( elems, function( elem ) {
          return elem.nodeType === 1;
        }));
    },

    dir: function( elem, dir, until ) {
      var matched = [],
        truncate = until !== undefined;

      while ( (elem = elem[ dir ]) && elem.nodeType !== 9 ) {
        if ( elem.nodeType === 1 ) {
          if ( truncate && jQuery( elem ).is( until ) ) {
            break;
          }
          matched.push( elem );
        }
      }
      return matched;
    },

    sibling: function( n, elem ) {
      var matched = [];

      for ( ; n; n = n.nextSibling ) {
        if ( n.nodeType === 1 && n !== elem ) {
          matched.push( n );
        }
      }

      return matched;
    }
  });

// Implement the identical functionality for filter and not
  function winnow( elements, qualifier, not ) {
    if ( jQuery.isFunction( qualifier ) ) {
      return jQuery.grep( elements, function( elem, i ) {
        /* jshint -W018 */
        return !!qualifier.call( elem, i, elem ) !== not;
      });

    }

    if ( qualifier.nodeType ) {
      return jQuery.grep( elements, function( elem ) {
        return ( elem === qualifier ) !== not;
      });

    }

    if ( typeof qualifier === "string" ) {
      if ( isSimple.test( qualifier ) ) {
        return jQuery.filter( qualifier, elements, not );
      }

      qualifier = jQuery.filter( qualifier, elements );
    }

    return jQuery.grep( elements, function( elem ) {
      return ( core_indexOf.call( qualifier, elem ) >= 0 ) !== not;
    });
  }
  var rxhtmlTag = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,
    rtagName = /<([\w:]+)/,
    rhtml = /<|&#?\w+;/,
    rnoInnerhtml = /<(?:script|style|link)/i,
    manipulation_rcheckableType = /^(?:checkbox|radio)$/i,
  // checked="checked" or checked
    rchecked = /checked\s*(?:[^=]|=\s*.checked.)/i,
    rscriptType = /^$|\/(?:java|ecma)script/i,
    rscriptTypeMasked = /^true\/(.*)/,
    rcleanScript = /^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g,

  // We have to close these tags to support XHTML (#13200)
    wrapMap = {

      // Support: IE 9
      option: [ 1, "<select multiple='multiple'>", "</select>" ],

      thead: [ 1, "<table>", "</table>" ],
      col: [ 2, "<table><colgroup>", "</colgroup></table>" ],
      tr: [ 2, "<table><tbody>", "</tbody></table>" ],
      td: [ 3, "<table><tbody><tr>", "</tr></tbody></table>" ],

      _default: [ 0, "", "" ]
    };

// Support: IE 9
  wrapMap.optgroup = wrapMap.option;

  wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
  wrapMap.th = wrapMap.td;

  jQuery.fn.extend({
    text: function( value ) {
      return jQuery.access( this, function( value ) {
        return value === undefined ?
          jQuery.text( this ) :
          this.empty().append( ( this[ 0 ] && this[ 0 ].ownerDocument || document ).createTextNode( value ) );
      }, null, value, arguments.length );
    },

    append: function() {
      return this.domManip( arguments, function( elem ) {
        if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
          var target = manipulationTarget( this, elem );
          target.appendChild( elem );
        }
      });
    },

    prepend: function() {
      return this.domManip( arguments, function( elem ) {
        if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
          var target = manipulationTarget( this, elem );
          target.insertBefore( elem, target.firstChild );
        }
      });
    },

    before: function() {
      return this.domManip( arguments, function( elem ) {
        if ( this.parentNode ) {
          this.parentNode.insertBefore( elem, this );
        }
      });
    },

    after: function() {
      return this.domManip( arguments, function( elem ) {
        if ( this.parentNode ) {
          this.parentNode.insertBefore( elem, this.nextSibling );
        }
      });
    },

    // keepData is for internal use only--do not document
    remove: function( selector, keepData ) {
      var elem,
        elems = selector ? jQuery.filter( selector, this ) : this,
        i = 0;

      for ( ; (elem = elems[i]) != null; i++ ) {
        if ( !keepData && elem.nodeType === 1 ) {
          jQuery.cleanData( getAll( elem ) );
        }

        if ( elem.parentNode ) {
          if ( keepData && jQuery.contains( elem.ownerDocument, elem ) ) {
            setGlobalEval( getAll( elem, "script" ) );
          }
          elem.parentNode.removeChild( elem );
        }
      }

      return this;
    },

    empty: function() {
      var elem,
        i = 0;

      for ( ; (elem = this[i]) != null; i++ ) {
        if ( elem.nodeType === 1 ) {

          // Prevent memory leaks
          jQuery.cleanData( getAll( elem, false ) );

          // Remove any remaining nodes
          elem.textContent = "";
        }
      }

      return this;
    },

    clone: function( dataAndEvents, deepDataAndEvents ) {
      dataAndEvents = dataAndEvents == null ? false : dataAndEvents;
      deepDataAndEvents = deepDataAndEvents == null ? dataAndEvents : deepDataAndEvents;

      return this.map( function () {
        return jQuery.clone( this, dataAndEvents, deepDataAndEvents );
      });
    },

    html: function( value ) {
      return jQuery.access( this, function( value ) {
        var elem = this[ 0 ] || {},
          i = 0,
          l = this.length;

        if ( value === undefined && elem.nodeType === 1 ) {
          return elem.innerHTML;
        }

        // See if we can take a shortcut and just use innerHTML
        if ( typeof value === "string" && !rnoInnerhtml.test( value ) &&
          !wrapMap[ ( rtagName.exec( value ) || [ "", "" ] )[ 1 ].toLowerCase() ] ) {

          value = value.replace( rxhtmlTag, "<$1></$2>" );

          try {
            for ( ; i < l; i++ ) {
              elem = this[ i ] || {};

              // Remove element nodes and prevent memory leaks
              if ( elem.nodeType === 1 ) {
                jQuery.cleanData( getAll( elem, false ) );
                elem.innerHTML = value;
              }
            }

            elem = 0;

            // If using innerHTML throws an exception, use the fallback method
          } catch( e ) {}
        }

        if ( elem ) {
          this.empty().append( value );
        }
      }, null, value, arguments.length );
    },

    replaceWith: function() {
      var
      // Snapshot the DOM in case .domManip sweeps something relevant into its fragment
        args = jQuery.map( this, function( elem ) {
          return [ elem.nextSibling, elem.parentNode ];
        }),
        i = 0;

      // Make the changes, replacing each context element with the new content
      this.domManip( arguments, function( elem ) {
        var next = args[ i++ ],
          parent = args[ i++ ];

        if ( parent ) {
          // Don't use the snapshot next if it has moved (#13810)
          if ( next && next.parentNode !== parent ) {
            next = this.nextSibling;
          }
          jQuery( this ).remove();
          parent.insertBefore( elem, next );
        }
        // Allow new content to include elements from the context set
      }, true );

      // Force removal if there was no new content (e.g., from empty arguments)
      return i ? this : this.remove();
    },

    detach: function( selector ) {
      return this.remove( selector, true );
    },

    domManip: function( args, callback, allowIntersection ) {

      // Flatten any nested arrays
      args = core_concat.apply( [], args );

      var fragment, first, scripts, hasScripts, node, doc,
        i = 0,
        l = this.length,
        set = this,
        iNoClone = l - 1,
        value = args[ 0 ],
        isFunction = jQuery.isFunction( value );

      // We can't cloneNode fragments that contain checked, in WebKit
      if ( isFunction || !( l <= 1 || typeof value !== "string" || jQuery.support.checkClone || !rchecked.test( value ) ) ) {
        return this.each(function( index ) {
          var self = set.eq( index );
          if ( isFunction ) {
            args[ 0 ] = value.call( this, index, self.html() );
          }
          self.domManip( args, callback, allowIntersection );
        });
      }

      if ( l ) {
        fragment = jQuery.buildFragment( args, this[ 0 ].ownerDocument, false, !allowIntersection && this );
        first = fragment.firstChild;

        if ( fragment.childNodes.length === 1 ) {
          fragment = first;
        }

        if ( first ) {
          scripts = jQuery.map( getAll( fragment, "script" ), disableScript );
          hasScripts = scripts.length;

          // Use the original fragment for the last item instead of the first because it can end up
          // being emptied incorrectly in certain situations (#8070).
          for ( ; i < l; i++ ) {
            node = fragment;

            if ( i !== iNoClone ) {
              node = jQuery.clone( node, true, true );

              // Keep references to cloned scripts for later restoration
              if ( hasScripts ) {
                // Support: QtWebKit
                // jQuery.merge because core_push.apply(_, arraylike) throws
                jQuery.merge( scripts, getAll( node, "script" ) );
              }
            }

            callback.call( this[ i ], node, i );
          }

          if ( hasScripts ) {
            doc = scripts[ scripts.length - 1 ].ownerDocument;

            // Reenable scripts
            jQuery.map( scripts, restoreScript );

            // Evaluate executable scripts on first document insertion
            for ( i = 0; i < hasScripts; i++ ) {
              node = scripts[ i ];
              if ( rscriptType.test( node.type || "" ) &&
                !data_priv.access( node, "globalEval" ) && jQuery.contains( doc, node ) ) {

                if ( node.src ) {
                  // Hope ajax is available...
                  jQuery._evalUrl( node.src );
                } else {
                  jQuery.globalEval( node.textContent.replace( rcleanScript, "" ) );
                }
              }
            }
          }
        }
      }

      return this;
    }
  });

  jQuery.each({
    appendTo: "append",
    prependTo: "prepend",
    insertBefore: "before",
    insertAfter: "after",
    replaceAll: "replaceWith"
  }, function( name, original ) {
    jQuery.fn[ name ] = function( selector ) {
      var elems,
        ret = [],
        insert = jQuery( selector ),
        last = insert.length - 1,
        i = 0;

      for ( ; i <= last; i++ ) {
        elems = i === last ? this : this.clone( true );
        jQuery( insert[ i ] )[ original ]( elems );

        // Support: QtWebKit
        // .get() because core_push.apply(_, arraylike) throws
        core_push.apply( ret, elems.get() );
      }

      return this.pushStack( ret );
    };
  });

  jQuery.extend({
    clone: function( elem, dataAndEvents, deepDataAndEvents ) {
      var i, l, srcElements, destElements,
        clone = elem.cloneNode( true ),
        inPage = jQuery.contains( elem.ownerDocument, elem );

      // Support: IE >= 9
      // Fix Cloning issues
      if ( !jQuery.support.noCloneChecked && ( elem.nodeType === 1 || elem.nodeType === 11 ) && !jQuery.isXMLDoc( elem ) ) {

        // We eschew Sizzle here for performance reasons: http://jsperf.com/getall-vs-sizzle/2
        destElements = getAll( clone );
        srcElements = getAll( elem );

        for ( i = 0, l = srcElements.length; i < l; i++ ) {
          fixInput( srcElements[ i ], destElements[ i ] );
        }
      }

      // Copy the events from the original to the clone
      if ( dataAndEvents ) {
        if ( deepDataAndEvents ) {
          srcElements = srcElements || getAll( elem );
          destElements = destElements || getAll( clone );

          for ( i = 0, l = srcElements.length; i < l; i++ ) {
            cloneCopyEvent( srcElements[ i ], destElements[ i ] );
          }
        } else {
          cloneCopyEvent( elem, clone );
        }
      }

      // Preserve script evaluation history
      destElements = getAll( clone, "script" );
      if ( destElements.length > 0 ) {
        setGlobalEval( destElements, !inPage && getAll( elem, "script" ) );
      }

      // Return the cloned set
      return clone;
    },

    buildFragment: function( elems, context, scripts, selection ) {
      var elem, tmp, tag, wrap, contains, j,
        i = 0,
        l = elems.length,
        fragment = context.createDocumentFragment(),
        nodes = [];

      for ( ; i < l; i++ ) {
        elem = elems[ i ];

        if ( elem || elem === 0 ) {

          // Add nodes directly
          if ( jQuery.type( elem ) === "object" ) {
            // Support: QtWebKit
            // jQuery.merge because core_push.apply(_, arraylike) throws
            jQuery.merge( nodes, elem.nodeType ? [ elem ] : elem );

            // Convert non-html into a text node
          } else if ( !rhtml.test( elem ) ) {
            nodes.push( context.createTextNode( elem ) );

            // Convert html into DOM nodes
          } else {
            tmp = tmp || fragment.appendChild( context.createElement("div") );

            // Deserialize a standard representation
            tag = ( rtagName.exec( elem ) || ["", ""] )[ 1 ].toLowerCase();
            wrap = wrapMap[ tag ] || wrapMap._default;
            tmp.innerHTML = wrap[ 1 ] + elem.replace( rxhtmlTag, "<$1></$2>" ) + wrap[ 2 ];

            // Descend through wrappers to the right content
            j = wrap[ 0 ];
            while ( j-- ) {
              tmp = tmp.lastChild;
            }

            // Support: QtWebKit
            // jQuery.merge because core_push.apply(_, arraylike) throws
            jQuery.merge( nodes, tmp.childNodes );

            // Remember the top-level container
            tmp = fragment.firstChild;

            // Fixes #12346
            // Support: Webkit, IE
            tmp.textContent = "";
          }
        }
      }

      // Remove wrapper from fragment
      fragment.textContent = "";

      i = 0;
      while ( (elem = nodes[ i++ ]) ) {

        // #4087 - If origin and destination elements are the same, and this is
        // that element, do not do anything
        if ( selection && jQuery.inArray( elem, selection ) !== -1 ) {
          continue;
        }

        contains = jQuery.contains( elem.ownerDocument, elem );

        // Append to fragment
        tmp = getAll( fragment.appendChild( elem ), "script" );

        // Preserve script evaluation history
        if ( contains ) {
          setGlobalEval( tmp );
        }

        // Capture executables
        if ( scripts ) {
          j = 0;
          while ( (elem = tmp[ j++ ]) ) {
            if ( rscriptType.test( elem.type || "" ) ) {
              scripts.push( elem );
            }
          }
        }
      }

      return fragment;
    },

    cleanData: function( elems ) {
      var data, elem, events, type, key, j,
        special = jQuery.event.special,
        i = 0;

      for ( ; (elem = elems[ i ]) !== undefined; i++ ) {
        if ( Data.accepts( elem ) ) {
          key = elem[ data_priv.expando ];

          if ( key && (data = data_priv.cache[ key ]) ) {
            events = Object.keys( data.events || {} );
            if ( events.length ) {
              for ( j = 0; (type = events[j]) !== undefined; j++ ) {
                if ( special[ type ] ) {
                  jQuery.event.remove( elem, type );

                  // This is a shortcut to avoid jQuery.event.remove's overhead
                } else {
                  jQuery.removeEvent( elem, type, data.handle );
                }
              }
            }
            if ( data_priv.cache[ key ] ) {
              // Discard any remaining `private` data
              delete data_priv.cache[ key ];
            }
          }
        }
        // Discard any remaining `user` data
        delete data_user.cache[ elem[ data_user.expando ] ];
      }
    },

    _evalUrl: function( url ) {
      return jQuery.ajax({
        url: url,
        type: "GET",
        dataType: "script",
        async: false,
        global: false,
        "throws": true
      });
    }
  });

// Support: 1.x compatibility
// Manipulating tables requires a tbody
  function manipulationTarget( elem, content ) {
    return jQuery.nodeName( elem, "table" ) &&
      jQuery.nodeName( content.nodeType === 1 ? content : content.firstChild, "tr" ) ?

      elem.getElementsByTagName("tbody")[0] ||
        elem.appendChild( elem.ownerDocument.createElement("tbody") ) :
      elem;
  }

// Replace/restore the type attribute of script elements for safe DOM manipulation
  function disableScript( elem ) {
    elem.type = (elem.getAttribute("type") !== null) + "/" + elem.type;
    return elem;
  }
  function restoreScript( elem ) {
    var match = rscriptTypeMasked.exec( elem.type );

    if ( match ) {
      elem.type = match[ 1 ];
    } else {
      elem.removeAttribute("type");
    }

    return elem;
  }

// Mark scripts as having already been evaluated
  function setGlobalEval( elems, refElements ) {
    var l = elems.length,
      i = 0;

    for ( ; i < l; i++ ) {
      data_priv.set(
        elems[ i ], "globalEval", !refElements || data_priv.get( refElements[ i ], "globalEval" )
      );
    }
  }

  function cloneCopyEvent( src, dest ) {
    var i, l, type, pdataOld, pdataCur, udataOld, udataCur, events;

    if ( dest.nodeType !== 1 ) {
      return;
    }

    // 1. Copy private data: events, handlers, etc.
    if ( data_priv.hasData( src ) ) {
      pdataOld = data_priv.access( src );
      pdataCur = data_priv.set( dest, pdataOld );
      events = pdataOld.events;

      if ( events ) {
        delete pdataCur.handle;
        pdataCur.events = {};

        for ( type in events ) {
          for ( i = 0, l = events[ type ].length; i < l; i++ ) {
            jQuery.event.add( dest, type, events[ type ][ i ] );
          }
        }
      }
    }

    // 2. Copy user data
    if ( data_user.hasData( src ) ) {
      udataOld = data_user.access( src );
      udataCur = jQuery.extend( {}, udataOld );

      data_user.set( dest, udataCur );
    }
  }


  function getAll( context, tag ) {
    var ret = context.getElementsByTagName ? context.getElementsByTagName( tag || "*" ) :
      context.querySelectorAll ? context.querySelectorAll( tag || "*" ) :
        [];

    return tag === undefined || tag && jQuery.nodeName( context, tag ) ?
      jQuery.merge( [ context ], ret ) :
      ret;
  }

// Support: IE >= 9
  function fixInput( src, dest ) {
    var nodeName = dest.nodeName.toLowerCase();

    // Fails to persist the checked state of a cloned checkbox or radio button.
    if ( nodeName === "input" && manipulation_rcheckableType.test( src.type ) ) {
      dest.checked = src.checked;

      // Fails to return the selected option to the default selected state when cloning options
    } else if ( nodeName === "input" || nodeName === "textarea" ) {
      dest.defaultValue = src.defaultValue;
    }
  }
  jQuery.fn.extend({
    wrapAll: function( html ) {
      var wrap;

      if ( jQuery.isFunction( html ) ) {
        return this.each(function( i ) {
          jQuery( this ).wrapAll( html.call(this, i) );
        });
      }

      if ( this[ 0 ] ) {

        // The elements to wrap the target around
        wrap = jQuery( html, this[ 0 ].ownerDocument ).eq( 0 ).clone( true );

        if ( this[ 0 ].parentNode ) {
          wrap.insertBefore( this[ 0 ] );
        }

        wrap.map(function() {
          var elem = this;

          while ( elem.firstElementChild ) {
            elem = elem.firstElementChild;
          }

          return elem;
        }).append( this );
      }

      return this;
    },

    wrapInner: function( html ) {
      if ( jQuery.isFunction( html ) ) {
        return this.each(function( i ) {
          jQuery( this ).wrapInner( html.call(this, i) );
        });
      }

      return this.each(function() {
        var self = jQuery( this ),
          contents = self.contents();

        if ( contents.length ) {
          contents.wrapAll( html );

        } else {
          self.append( html );
        }
      });
    },

    wrap: function( html ) {
      var isFunction = jQuery.isFunction( html );

      return this.each(function( i ) {
        jQuery( this ).wrapAll( isFunction ? html.call(this, i) : html );
      });
    },

    unwrap: function() {
      return this.parent().each(function() {
        if ( !jQuery.nodeName( this, "body" ) ) {
          jQuery( this ).replaceWith( this.childNodes );
        }
      }).end();
    }
  });
  var curCSS, iframe,
  // swappable if display is none or starts with table except "table", "table-cell", or "table-caption"
  // see here for display values: https://developer.mozilla.org/en-US/docs/CSS/display
    rdisplayswap = /^(none|table(?!-c[ea]).+)/,
    rmargin = /^margin/,
    rnumsplit = new RegExp( "^(" + core_pnum + ")(.*)$", "i" ),
    rnumnonpx = new RegExp( "^(" + core_pnum + ")(?!px)[a-z%]+$", "i" ),
    rrelNum = new RegExp( "^([+-])=(" + core_pnum + ")", "i" ),
    elemdisplay = { BODY: "block" },

    cssShow = { position: "absolute", visibility: "hidden", display: "block" },
    cssNormalTransform = {
      letterSpacing: 0,
      fontWeight: 400
    },

    cssExpand = [ "Top", "Right", "Bottom", "Left" ],
    cssPrefixes = [ "Webkit", "O", "Moz", "ms" ];

// return a css property mapped to a potentially vendor prefixed property
  function vendorPropName( style, name ) {

    // shortcut for names that are not vendor prefixed
    if ( name in style ) {
      return name;
    }

    // check for vendor prefixed names
    var capName = name.charAt(0).toUpperCase() + name.slice(1),
      origName = name,
      i = cssPrefixes.length;

    while ( i-- ) {
      name = cssPrefixes[ i ] + capName;
      if ( name in style ) {
        return name;
      }
    }

    return origName;
  }

  function isHidden( elem, el ) {
    // isHidden might be called from jQuery#filter function;
    // in that case, element will be second argument
    elem = el || elem;
    return jQuery.css( elem, "display" ) === "none" || !jQuery.contains( elem.ownerDocument, elem );
  }

// NOTE: we've included the "window" in window.getComputedStyle
// because jsdom on node.js will break without it.
  function getStyles( elem ) {
    return window.getComputedStyle( elem, null );
  }

  function showHide( elements, show ) {
    var display, elem, hidden,
      values = [],
      index = 0,
      length = elements.length;

    for ( ; index < length; index++ ) {
      elem = elements[ index ];
      if ( !elem.style ) {
        continue;
      }

      values[ index ] = data_priv.get( elem, "olddisplay" );
      display = elem.style.display;
      if ( show ) {
        // Reset the inline display of this element to learn if it is
        // being hidden by cascaded rules or not
        if ( !values[ index ] && display === "none" ) {
          elem.style.display = "";
        }

        // Set elements which have been overridden with display: none
        // in a stylesheet to whatever the default browser style is
        // for such an element
        if ( elem.style.display === "" && isHidden( elem ) ) {
          values[ index ] = data_priv.access( elem, "olddisplay", css_defaultDisplay(elem.nodeName) );
        }
      } else {

        if ( !values[ index ] ) {
          hidden = isHidden( elem );

          if ( display && display !== "none" || !hidden ) {
            data_priv.set( elem, "olddisplay", hidden ? display : jQuery.css(elem, "display") );
          }
        }
      }
    }

    // Set the display of most of the elements in a second loop
    // to avoid the constant reflow
    for ( index = 0; index < length; index++ ) {
      elem = elements[ index ];
      if ( !elem.style ) {
        continue;
      }
      if ( !show || elem.style.display === "none" || elem.style.display === "" ) {
        elem.style.display = show ? values[ index ] || "" : "none";
      }
    }

    return elements;
  }

  jQuery.fn.extend({
    css: function( name, value ) {
      return jQuery.access( this, function( elem, name, value ) {
        var styles, len,
          map = {},
          i = 0;

        if ( jQuery.isArray( name ) ) {
          styles = getStyles( elem );
          len = name.length;

          for ( ; i < len; i++ ) {
            map[ name[ i ] ] = jQuery.css( elem, name[ i ], false, styles );
          }

          return map;
        }

        return value !== undefined ?
          jQuery.style( elem, name, value ) :
          jQuery.css( elem, name );
      }, name, value, arguments.length > 1 );
    },
    show: function() {
      return showHide( this, true );
    },
    hide: function() {
      return showHide( this );
    },
    toggle: function( state ) {
      if ( typeof state === "boolean" ) {
        return state ? this.show() : this.hide();
      }

      return this.each(function() {
        if ( isHidden( this ) ) {
          jQuery( this ).show();
        } else {
          jQuery( this ).hide();
        }
      });
    }
  });

  jQuery.extend({
    // Add in style property hooks for overriding the default
    // behavior of getting and setting a style property
    cssHooks: {
      opacity: {
        get: function( elem, computed ) {
          if ( computed ) {
            // We should always get a number back from opacity
            var ret = curCSS( elem, "opacity" );
            return ret === "" ? "1" : ret;
          }
        }
      }
    },

    // Don't automatically add "px" to these possibly-unitless properties
    cssNumber: {
      "columnCount": true,
      "fillOpacity": true,
      "fontWeight": true,
      "lineHeight": true,
      "opacity": true,
      "order": true,
      "orphans": true,
      "widows": true,
      "zIndex": true,
      "zoom": true
    },

    // Add in properties whose names you wish to fix before
    // setting or getting the value
    cssProps: {
      // normalize float css property
      "float": "cssFloat"
    },

    // Get and set the style property on a DOM Node
    style: function( elem, name, value, extra ) {
      // Don't set styles on text and comment nodes
      if ( !elem || elem.nodeType === 3 || elem.nodeType === 8 || !elem.style ) {
        return;
      }

      // Make sure that we're working with the right name
      var ret, type, hooks,
        origName = jQuery.camelCase( name ),
        style = elem.style;

      name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( style, origName ) );

      // gets hook for the prefixed version
      // followed by the unprefixed version
      hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

      // Check if we're setting a value
      if ( value !== undefined ) {
        type = typeof value;

        // convert relative number strings (+= or -=) to relative numbers. #7345
        if ( type === "string" && (ret = rrelNum.exec( value )) ) {
          value = ( ret[1] + 1 ) * ret[2] + parseFloat( jQuery.css( elem, name ) );
          // Fixes bug #9237
          type = "number";
        }

        // Make sure that NaN and null values aren't set. See: #7116
        if ( value == null || type === "number" && isNaN( value ) ) {
          return;
        }

        // If a number was passed in, add 'px' to the (except for certain CSS properties)
        if ( type === "number" && !jQuery.cssNumber[ origName ] ) {
          value += "px";
        }

        // Fixes #8908, it can be done more correctly by specifying setters in cssHooks,
        // but it would mean to define eight (for every problematic property) identical functions
        if ( !jQuery.support.clearCloneStyle && value === "" && name.indexOf("background") === 0 ) {
          style[ name ] = "inherit";
        }

        // If a hook was provided, use that value, otherwise just set the specified value
        if ( !hooks || !("set" in hooks) || (value = hooks.set( elem, value, extra )) !== undefined ) {
          style[ name ] = value;
        }

      } else {
        // If a hook was provided get the non-computed value from there
        if ( hooks && "get" in hooks && (ret = hooks.get( elem, false, extra )) !== undefined ) {
          return ret;
        }

        // Otherwise just get the value from the style object
        return style[ name ];
      }
    },

    css: function( elem, name, extra, styles ) {
      var val, num, hooks,
        origName = jQuery.camelCase( name );

      // Make sure that we're working with the right name
      name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( elem.style, origName ) );

      // gets hook for the prefixed version
      // followed by the unprefixed version
      hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

      // If a hook was provided get the computed value from there
      if ( hooks && "get" in hooks ) {
        val = hooks.get( elem, true, extra );
      }

      // Otherwise, if a way to get the computed value exists, use that
      if ( val === undefined ) {
        val = curCSS( elem, name, styles );
      }

      //convert "normal" to computed value
      if ( val === "normal" && name in cssNormalTransform ) {
        val = cssNormalTransform[ name ];
      }

      // Return, converting to number if forced or a qualifier was provided and val looks numeric
      if ( extra === "" || extra ) {
        num = parseFloat( val );
        return extra === true || jQuery.isNumeric( num ) ? num || 0 : val;
      }
      return val;
    }
  });

  curCSS = function( elem, name, _computed ) {
    var width, minWidth, maxWidth,
      computed = _computed || getStyles( elem ),

    // Support: IE9
    // getPropertyValue is only needed for .css('filter') in IE9, see #12537
      ret = computed ? computed.getPropertyValue( name ) || computed[ name ] : undefined,
      style = elem.style;

    if ( computed ) {

      if ( ret === "" && !jQuery.contains( elem.ownerDocument, elem ) ) {
        ret = jQuery.style( elem, name );
      }

      // Support: Safari 5.1
      // A tribute to the "awesome hack by Dean Edwards"
      // Safari 5.1.7 (at least) returns percentage for a larger set of values, but width seems to be reliably pixels
      // this is against the CSSOM draft spec: http://dev.w3.org/csswg/cssom/#resolved-values
      if ( rnumnonpx.test( ret ) && rmargin.test( name ) ) {

        // Remember the original values
        width = style.width;
        minWidth = style.minWidth;
        maxWidth = style.maxWidth;

        // Put in the new values to get a computed value out
        style.minWidth = style.maxWidth = style.width = ret;
        ret = computed.width;

        // Revert the changed values
        style.width = width;
        style.minWidth = minWidth;
        style.maxWidth = maxWidth;
      }
    }

    return ret;
  };


  function setPositiveNumber( elem, value, subtract ) {
    var matches = rnumsplit.exec( value );
    return matches ?
      // Guard against undefined "subtract", e.g., when used as in cssHooks
      Math.max( 0, matches[ 1 ] - ( subtract || 0 ) ) + ( matches[ 2 ] || "px" ) :
      value;
  }

  function augmentWidthOrHeight( elem, name, extra, isBorderBox, styles ) {
    var i = extra === ( isBorderBox ? "border" : "content" ) ?
        // If we already have the right measurement, avoid augmentation
        4 :
        // Otherwise initialize for horizontal or vertical properties
        name === "width" ? 1 : 0,

      val = 0;

    for ( ; i < 4; i += 2 ) {
      // both box models exclude margin, so add it if we want it
      if ( extra === "margin" ) {
        val += jQuery.css( elem, extra + cssExpand[ i ], true, styles );
      }

      if ( isBorderBox ) {
        // border-box includes padding, so remove it if we want content
        if ( extra === "content" ) {
          val -= jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );
        }

        // at this point, extra isn't border nor margin, so remove border
        if ( extra !== "margin" ) {
          val -= jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
        }
      } else {
        // at this point, extra isn't content, so add padding
        val += jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );

        // at this point, extra isn't content nor padding, so add border
        if ( extra !== "padding" ) {
          val += jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
        }
      }
    }

    return val;
  }

  function getWidthOrHeight( elem, name, extra ) {

    // Start with offset property, which is equivalent to the border-box value
    var valueIsBorderBox = true,
      val = name === "width" ? elem.offsetWidth : elem.offsetHeight,
      styles = getStyles( elem ),
      isBorderBox = jQuery.support.boxSizing && jQuery.css( elem, "boxSizing", false, styles ) === "border-box";

    // some non-html elements return undefined for offsetWidth, so check for null/undefined
    // svg - https://bugzilla.mozilla.org/show_bug.cgi?id=649285
    // MathML - https://bugzilla.mozilla.org/show_bug.cgi?id=491668
    if ( val <= 0 || val == null ) {
      // Fall back to computed then uncomputed css if necessary
      val = curCSS( elem, name, styles );
      if ( val < 0 || val == null ) {
        val = elem.style[ name ];
      }

      // Computed unit is not pixels. Stop here and return.
      if ( rnumnonpx.test(val) ) {
        return val;
      }

      // we need the check for style in case a browser which returns unreliable values
      // for getComputedStyle silently falls back to the reliable elem.style
      valueIsBorderBox = isBorderBox && ( jQuery.support.boxSizingReliable || val === elem.style[ name ] );

      // Normalize "", auto, and prepare for extra
      val = parseFloat( val ) || 0;
    }

    // use the active box-sizing model to add/subtract irrelevant styles
    return ( val +
      augmentWidthOrHeight(
        elem,
        name,
        extra || ( isBorderBox ? "border" : "content" ),
        valueIsBorderBox,
        styles
      )
      ) + "px";
  }

// Try to determine the default display value of an element
  function css_defaultDisplay( nodeName ) {
    var doc = document,
      display = elemdisplay[ nodeName ];

    if ( !display ) {
      display = actualDisplay( nodeName, doc );

      // If the simple way fails, read from inside an iframe
      if ( display === "none" || !display ) {
        // Use the already-created iframe if possible
        iframe = ( iframe ||
          jQuery("<iframe frameborder='0' width='0' height='0'/>")
            .css( "cssText", "display:block !important" )
          ).appendTo( doc.documentElement );

        // Always write a new HTML skeleton so Webkit and Firefox don't choke on reuse
        doc = ( iframe[0].contentWindow || iframe[0].contentDocument ).document;
        doc.write("<!doctype html><html><body>");
        doc.close();

        display = actualDisplay( nodeName, doc );
        iframe.detach();
      }

      // Store the correct default display
      elemdisplay[ nodeName ] = display;
    }

    return display;
  }

// Called ONLY from within css_defaultDisplay
  function actualDisplay( name, doc ) {
    var elem = jQuery( doc.createElement( name ) ).appendTo( doc.body ),
      display = jQuery.css( elem[0], "display" );
    elem.remove();
    return display;
  }

  jQuery.each([ "height", "width" ], function( i, name ) {
    jQuery.cssHooks[ name ] = {
      get: function( elem, computed, extra ) {
        if ( computed ) {
          // certain elements can have dimension info if we invisibly show them
          // however, it must have a current display style that would benefit from this
          return elem.offsetWidth === 0 && rdisplayswap.test( jQuery.css( elem, "display" ) ) ?
            jQuery.swap( elem, cssShow, function() {
              return getWidthOrHeight( elem, name, extra );
            }) :
            getWidthOrHeight( elem, name, extra );
        }
      },

      set: function( elem, value, extra ) {
        var styles = extra && getStyles( elem );
        return setPositiveNumber( elem, value, extra ?
          augmentWidthOrHeight(
            elem,
            name,
            extra,
            jQuery.support.boxSizing && jQuery.css( elem, "boxSizing", false, styles ) === "border-box",
            styles
          ) : 0
        );
      }
    };
  });

// These hooks cannot be added until DOM ready because the support test
// for it is not run until after DOM ready
  jQuery(function() {
    // Support: Android 2.3
    if ( !jQuery.support.reliableMarginRight ) {
      jQuery.cssHooks.marginRight = {
        get: function( elem, computed ) {
          if ( computed ) {
            // Support: Android 2.3
            // WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
            // Work around by temporarily setting element display to inline-block
            return jQuery.swap( elem, { "display": "inline-block" },
              curCSS, [ elem, "marginRight" ] );
          }
        }
      };
    }

    // Webkit bug: https://bugs.webkit.org/show_bug.cgi?id=29084
    // getComputedStyle returns percent when specified for top/left/bottom/right
    // rather than make the css module depend on the offset module, we just check for it here
    if ( !jQuery.support.pixelPosition && jQuery.fn.position ) {
      jQuery.each( [ "top", "left" ], function( i, prop ) {
        jQuery.cssHooks[ prop ] = {
          get: function( elem, computed ) {
            if ( computed ) {
              computed = curCSS( elem, prop );
              // if curCSS returns percentage, fallback to offset
              return rnumnonpx.test( computed ) ?
                jQuery( elem ).position()[ prop ] + "px" :
                computed;
            }
          }
        };
      });
    }

  });

  if ( jQuery.expr && jQuery.expr.filters ) {
    jQuery.expr.filters.hidden = function( elem ) {
      // Support: Opera <= 12.12
      // Opera reports offsetWidths and offsetHeights less than zero on some elements
      return elem.offsetWidth <= 0 && elem.offsetHeight <= 0;
    };

    jQuery.expr.filters.visible = function( elem ) {
      return !jQuery.expr.filters.hidden( elem );
    };
  }

// These hooks are used by animate to expand properties
  jQuery.each({
    margin: "",
    padding: "",
    border: "Width"
  }, function( prefix, suffix ) {
    jQuery.cssHooks[ prefix + suffix ] = {
      expand: function( value ) {
        var i = 0,
          expanded = {},

        // assumes a single number if not a string
          parts = typeof value === "string" ? value.split(" ") : [ value ];

        for ( ; i < 4; i++ ) {
          expanded[ prefix + cssExpand[ i ] + suffix ] =
            parts[ i ] || parts[ i - 2 ] || parts[ 0 ];
        }

        return expanded;
      }
    };

    if ( !rmargin.test( prefix ) ) {
      jQuery.cssHooks[ prefix + suffix ].set = setPositiveNumber;
    }
  });
  var r20 = /%20/g,
    rbracket = /\[\]$/,
    rCRLF = /\r?\n/g,
    rsubmitterTypes = /^(?:submit|button|image|reset|file)$/i,
    rsubmittable = /^(?:input|select|textarea|keygen)/i;

  jQuery.fn.extend({
    serialize: function() {
      return jQuery.param( this.serializeArray() );
    },
    serializeArray: function() {
      return this.map(function(){
        // Can add propHook for "elements" to filter or add form elements
        var elements = jQuery.prop( this, "elements" );
        return elements ? jQuery.makeArray( elements ) : this;
      })
        .filter(function(){
          var type = this.type;
          // Use .is(":disabled") so that fieldset[disabled] works
          return this.name && !jQuery( this ).is( ":disabled" ) &&
            rsubmittable.test( this.nodeName ) && !rsubmitterTypes.test( type ) &&
            ( this.checked || !manipulation_rcheckableType.test( type ) );
        })
        .map(function( i, elem ){
          var val = jQuery( this ).val();

          return val == null ?
            null :
            jQuery.isArray( val ) ?
              jQuery.map( val, function( val ){
                return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
              }) :
            { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
        }).get();
    }
  });

//Serialize an array of form elements or a set of
//key/values into a query string
  jQuery.param = function( a, traditional ) {
    var prefix,
      s = [],
      add = function( key, value ) {
        // If value is a function, invoke it and return its value
        value = jQuery.isFunction( value ) ? value() : ( value == null ? "" : value );
        s[ s.length ] = encodeURIComponent( key ) + "=" + encodeURIComponent( value );
      };

    // Set traditional to true for jQuery <= 1.3.2 behavior.
    if ( traditional === undefined ) {
      traditional = jQuery.ajaxSettings && jQuery.ajaxSettings.traditional;
    }

    // If an array was passed in, assume that it is an array of form elements.
    if ( jQuery.isArray( a ) || ( a.jquery && !jQuery.isPlainObject( a ) ) ) {
      // Serialize the form elements
      jQuery.each( a, function() {
        add( this.name, this.value );
      });

    } else {
      // If traditional, encode the "old" way (the way 1.3.2 or older
      // did it), otherwise encode params recursively.
      for ( prefix in a ) {
        buildParams( prefix, a[ prefix ], traditional, add );
      }
    }

    // Return the resulting serialization
    return s.join( "&" ).replace( r20, "+" );
  };

  function buildParams( prefix, obj, traditional, add ) {
    var name;

    if ( jQuery.isArray( obj ) ) {
      // Serialize array item.
      jQuery.each( obj, function( i, v ) {
        if ( traditional || rbracket.test( prefix ) ) {
          // Treat each array item as a scalar.
          add( prefix, v );

        } else {
          // Item is non-scalar (array or object), encode its numeric index.
          buildParams( prefix + "[" + ( typeof v === "object" ? i : "" ) + "]", v, traditional, add );
        }
      });

    } else if ( !traditional && jQuery.type( obj ) === "object" ) {
      // Serialize object item.
      for ( name in obj ) {
        buildParams( prefix + "[" + name + "]", obj[ name ], traditional, add );
      }

    } else {
      // Serialize scalar item.
      add( prefix, obj );
    }
  }
  jQuery.each( ("blur focus focusin focusout load resize scroll unload click dblclick " +
    "mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave " +
    "change select submit keydown keypress keyup error contextmenu").split(" "), function( i, name ) {

    // Handle event binding
    jQuery.fn[ name ] = function( data, fn ) {
      return arguments.length > 0 ?
        this.on( name, null, data, fn ) :
        this.trigger( name );
    };
  });

  jQuery.fn.extend({
    hover: function( fnOver, fnOut ) {
      return this.mouseenter( fnOver ).mouseleave( fnOut || fnOver );
    },

    bind: function( types, data, fn ) {
      return this.on( types, null, data, fn );
    },
    unbind: function( types, fn ) {
      return this.off( types, null, fn );
    },

    delegate: function( selector, types, data, fn ) {
      return this.on( types, selector, data, fn );
    },
    undelegate: function( selector, types, fn ) {
      // ( namespace ) or ( selector, types [, fn] )
      return arguments.length === 1 ? this.off( selector, "**" ) : this.off( types, selector || "**", fn );
    }
  });
  var
  // Document location
    ajaxLocParts,
    ajaxLocation,

    ajax_nonce = jQuery.now(),

    ajax_rquery = /\?/,
    rhash = /#.*$/,
    rts = /([?&])_=[^&]*/,
    rheaders = /^(.*?):[ \t]*([^\r\n]*)$/mg,
  // #7653, #8125, #8152: local protocol detection
    rlocalProtocol = /^(?:about|app|app-storage|.+-extension|file|res|widget):$/,
    rnoContent = /^(?:GET|HEAD)$/,
    rprotocol = /^\/\//,
    rurl = /^([\w.+-]+:)(?:\/\/([^\/?#:]*)(?::(\d+)|)|)/,

  // Keep a copy of the old load method
    _load = jQuery.fn.load,

  /* Prefilters
   * 1) They are useful to introduce custom dataTypes (see ajax/jsonp.js for an example)
   * 2) These are called:
   *    - BEFORE asking for a transport
   *    - AFTER param serialization (s.data is a string if s.processData is true)
   * 3) key is the dataType
   * 4) the catchall symbol "*" can be used
   * 5) execution will start with transport dataType and THEN continue down to "*" if needed
   */
    prefilters = {},

  /* Transports bindings
   * 1) key is the dataType
   * 2) the catchall symbol "*" can be used
   * 3) selection will start with transport dataType and THEN go to "*" if needed
   */
    transports = {},

  // Avoid comment-prolog char sequence (#10098); must appease lint and evade compression
    allTypes = "*/".concat("*");

// #8138, IE may throw an exception when accessing
// a field from window.location if document.domain has been set
  try {
    ajaxLocation = location.href;
  } catch( e ) {
    // Use the href attribute of an A element
    // since IE will modify it given document.location
    ajaxLocation = document.createElement( "a" );
    ajaxLocation.href = "";
    ajaxLocation = ajaxLocation.href;
  }

// Segment location into parts
  ajaxLocParts = rurl.exec( ajaxLocation.toLowerCase() ) || [];

// Base "constructor" for jQuery.ajaxPrefilter and jQuery.ajaxTransport
  function addToPrefiltersOrTransports( structure ) {

    // dataTypeExpression is optional and defaults to "*"
    return function( dataTypeExpression, func ) {

      if ( typeof dataTypeExpression !== "string" ) {
        func = dataTypeExpression;
        dataTypeExpression = "*";
      }

      var dataType,
        i = 0,
        dataTypes = dataTypeExpression.toLowerCase().match( core_rnotwhite ) || [];

      if ( jQuery.isFunction( func ) ) {
        // For each dataType in the dataTypeExpression
        while ( (dataType = dataTypes[i++]) ) {
          // Prepend if requested
          if ( dataType[0] === "+" ) {
            dataType = dataType.slice( 1 ) || "*";
            (structure[ dataType ] = structure[ dataType ] || []).unshift( func );

            // Otherwise append
          } else {
            (structure[ dataType ] = structure[ dataType ] || []).push( func );
          }
        }
      }
    };
  }

// Base inspection function for prefilters and transports
  function inspectPrefiltersOrTransports( structure, options, originalOptions, jqXHR ) {

    var inspected = {},
      seekingTransport = ( structure === transports );

    function inspect( dataType ) {
      var selected;
      inspected[ dataType ] = true;
      jQuery.each( structure[ dataType ] || [], function( _, prefilterOrFactory ) {
        var dataTypeOrTransport = prefilterOrFactory( options, originalOptions, jqXHR );
        if( typeof dataTypeOrTransport === "string" && !seekingTransport && !inspected[ dataTypeOrTransport ] ) {
          options.dataTypes.unshift( dataTypeOrTransport );
          inspect( dataTypeOrTransport );
          return false;
        } else if ( seekingTransport ) {
          return !( selected = dataTypeOrTransport );
        }
      });
      return selected;
    }

    return inspect( options.dataTypes[ 0 ] ) || !inspected[ "*" ] && inspect( "*" );
  }

// A special extend for ajax options
// that takes "flat" options (not to be deep extended)
// Fixes #9887
  function ajaxExtend( target, src ) {
    var key, deep,
      flatOptions = jQuery.ajaxSettings.flatOptions || {};

    for ( key in src ) {
      if ( src[ key ] !== undefined ) {
        ( flatOptions[ key ] ? target : ( deep || (deep = {}) ) )[ key ] = src[ key ];
      }
    }
    if ( deep ) {
      jQuery.extend( true, target, deep );
    }

    return target;
  }

  jQuery.fn.load = function( url, params, callback ) {
    if ( typeof url !== "string" && _load ) {
      return _load.apply( this, arguments );
    }

    var selector, type, response,
      self = this,
      off = url.indexOf(" ");

    if ( off >= 0 ) {
      selector = url.slice( off );
      url = url.slice( 0, off );
    }

    // If it's a function
    if ( jQuery.isFunction( params ) ) {

      // We assume that it's the callback
      callback = params;
      params = undefined;

      // Otherwise, build a param string
    } else if ( params && typeof params === "object" ) {
      type = "POST";
    }

    // If we have elements to modify, make the request
    if ( self.length > 0 ) {
      jQuery.ajax({
        url: url,

        // if "type" variable is undefined, then "GET" method will be used
        type: type,
        dataType: "html",
        data: params
      }).done(function( responseText ) {

          // Save response for use in complete callback
          response = arguments;

          self.html( selector ?

            // If a selector was specified, locate the right elements in a dummy div
            // Exclude scripts to avoid IE 'Permission Denied' errors
            jQuery("<div>").append( jQuery.parseHTML( responseText ) ).find( selector ) :

            // Otherwise use the full result
            responseText );

        }).complete( callback && function( jqXHR, status ) {
          self.each( callback, response || [ jqXHR.responseText, status, jqXHR ] );
        });
    }

    return this;
  };

// Attach a bunch of functions for handling common AJAX events
  jQuery.each( [ "ajaxStart", "ajaxStop", "ajaxComplete", "ajaxError", "ajaxSuccess", "ajaxSend" ], function( i, type ){
    jQuery.fn[ type ] = function( fn ){
      return this.on( type, fn );
    };
  });

  jQuery.extend({

    // Counter for holding the number of active queries
    active: 0,

    // Last-Modified header cache for next request
    lastModified: {},
    etag: {},

    ajaxSettings: {
      url: ajaxLocation,
      type: "GET",
      isLocal: rlocalProtocol.test( ajaxLocParts[ 1 ] ),
      global: true,
      processData: true,
      async: true,
      contentType: "application/x-www-form-urlencoded; charset=UTF-8",
      /*
       timeout: 0,
       data: null,
       dataType: null,
       username: null,
       password: null,
       cache: null,
       throws: false,
       traditional: false,
       headers: {},
       */

      accepts: {
        "*": allTypes,
        text: "text/plain",
        html: "text/html",
        xml: "application/xml, text/xml",
        json: "application/json, text/javascript"
      },

      contents: {
        xml: /xml/,
        html: /html/,
        json: /json/
      },

      responseFields: {
        xml: "responseXML",
        text: "responseText",
        json: "responseJSON"
      },

      // Data converters
      // Keys separate source (or catchall "*") and destination types with a single space
      converters: {

        // Convert anything to text
        "* text": String,

        // Text to html (true = no transformation)
        "text html": true,

        // Evaluate text as a json expression
        "text json": jQuery.parseJSON,

        // Parse text as xml
        "text xml": jQuery.parseXML
      },

      // For options that shouldn't be deep extended:
      // you can add your own custom options here if
      // and when you create one that shouldn't be
      // deep extended (see ajaxExtend)
      flatOptions: {
        url: true,
        context: true
      }
    },

    // Creates a full fledged settings object into target
    // with both ajaxSettings and settings fields.
    // If target is omitted, writes into ajaxSettings.
    ajaxSetup: function( target, settings ) {
      return settings ?

        // Building a settings object
        ajaxExtend( ajaxExtend( target, jQuery.ajaxSettings ), settings ) :

        // Extending ajaxSettings
        ajaxExtend( jQuery.ajaxSettings, target );
    },

    ajaxPrefilter: addToPrefiltersOrTransports( prefilters ),
    ajaxTransport: addToPrefiltersOrTransports( transports ),

    // Main method
    ajax: function( url, options ) {

      // If url is an object, simulate pre-1.5 signature
      if ( typeof url === "object" ) {
        options = url;
        url = undefined;
      }

      // Force options to be an object
      options = options || {};

      var transport,
      // URL without anti-cache param
        cacheURL,
      // Response headers
        responseHeadersString,
        responseHeaders,
      // timeout handle
        timeoutTimer,
      // Cross-domain detection vars
        parts,
      // To know if global events are to be dispatched
        fireGlobals,
      // Loop variable
        i,
      // Create the final options object
        s = jQuery.ajaxSetup( {}, options ),
      // Callbacks context
        callbackContext = s.context || s,
      // Context for global events is callbackContext if it is a DOM node or jQuery collection
        globalEventContext = s.context && ( callbackContext.nodeType || callbackContext.jquery ) ?
          jQuery( callbackContext ) :
          jQuery.event,
      // Deferreds
        deferred = jQuery.Deferred(),
        completeDeferred = jQuery.Callbacks("once memory"),
      // Status-dependent callbacks
        statusCode = s.statusCode || {},
      // Headers (they are sent all at once)
        requestHeaders = {},
        requestHeadersNames = {},
      // The jqXHR state
        state = 0,
      // Default abort message
        strAbort = "canceled",
      // Fake xhr
        jqXHR = {
          readyState: 0,

          // Builds headers hashtable if needed
          getResponseHeader: function( key ) {
            var match;
            if ( state === 2 ) {
              if ( !responseHeaders ) {
                responseHeaders = {};
                while ( (match = rheaders.exec( responseHeadersString )) ) {
                  responseHeaders[ match[1].toLowerCase() ] = match[ 2 ];
                }
              }
              match = responseHeaders[ key.toLowerCase() ];
            }
            return match == null ? null : match;
          },

          // Raw string
          getAllResponseHeaders: function() {
            return state === 2 ? responseHeadersString : null;
          },

          // Caches the header
          setRequestHeader: function( name, value ) {
            var lname = name.toLowerCase();
            if ( !state ) {
              name = requestHeadersNames[ lname ] = requestHeadersNames[ lname ] || name;
              requestHeaders[ name ] = value;
            }
            return this;
          },

          // Overrides response content-type header
          overrideMimeType: function( type ) {
            if ( !state ) {
              s.mimeType = type;
            }
            return this;
          },

          // Status-dependent callbacks
          statusCode: function( map ) {
            var code;
            if ( map ) {
              if ( state < 2 ) {
                for ( code in map ) {
                  // Lazy-add the new callback in a way that preserves old ones
                  statusCode[ code ] = [ statusCode[ code ], map[ code ] ];
                }
              } else {
                // Execute the appropriate callbacks
                jqXHR.always( map[ jqXHR.status ] );
              }
            }
            return this;
          },

          // Cancel the request
          abort: function( statusText ) {
            var finalText = statusText || strAbort;
            if ( transport ) {
              transport.abort( finalText );
            }
            done( 0, finalText );
            return this;
          }
        };

      // Attach deferreds
      deferred.promise( jqXHR ).complete = completeDeferred.add;
      jqXHR.success = jqXHR.done;
      jqXHR.error = jqXHR.fail;

      // Remove hash character (#7531: and string promotion)
      // Add protocol if not provided (prefilters might expect it)
      // Handle falsy url in the settings object (#10093: consistency with old signature)
      // We also use the url parameter if available
      s.url = ( ( url || s.url || ajaxLocation ) + "" ).replace( rhash, "" )
        .replace( rprotocol, ajaxLocParts[ 1 ] + "//" );

      // Alias method option to type as per ticket #12004
      s.type = options.method || options.type || s.method || s.type;

      // Extract dataTypes list
      s.dataTypes = jQuery.trim( s.dataType || "*" ).toLowerCase().match( core_rnotwhite ) || [""];

      // A cross-domain request is in order when we have a protocol:host:port mismatch
      if ( s.crossDomain == null ) {
        parts = rurl.exec( s.url.toLowerCase() );
        s.crossDomain = !!( parts &&
          ( parts[ 1 ] !== ajaxLocParts[ 1 ] || parts[ 2 ] !== ajaxLocParts[ 2 ] ||
            ( parts[ 3 ] || ( parts[ 1 ] === "http:" ? "80" : "443" ) ) !==
              ( ajaxLocParts[ 3 ] || ( ajaxLocParts[ 1 ] === "http:" ? "80" : "443" ) ) )
          );
      }

      // Convert data if not already a string
      if ( s.data && s.processData && typeof s.data !== "string" ) {
        s.data = jQuery.param( s.data, s.traditional );
      }

      // Apply prefilters
      inspectPrefiltersOrTransports( prefilters, s, options, jqXHR );

      // If request was aborted inside a prefilter, stop there
      if ( state === 2 ) {
        return jqXHR;
      }

      // We can fire global events as of now if asked to
      fireGlobals = s.global;

      // Watch for a new set of requests
      if ( fireGlobals && jQuery.active++ === 0 ) {
        jQuery.event.trigger("ajaxStart");
      }

      // Uppercase the type
      s.type = s.type.toUpperCase();

      // Determine if request has content
      s.hasContent = !rnoContent.test( s.type );

      // Save the URL in case we're toying with the If-Modified-Since
      // and/or If-None-Match header later on
      cacheURL = s.url;

      // More options handling for requests with no content
      if ( !s.hasContent ) {

        // If data is available, append data to url
        if ( s.data ) {
          cacheURL = ( s.url += ( ajax_rquery.test( cacheURL ) ? "&" : "?" ) + s.data );
          // #9682: remove data so that it's not used in an eventual retry
          delete s.data;
        }

        // Add anti-cache in url if needed
        if ( s.cache === false ) {
          s.url = rts.test( cacheURL ) ?

            // If there is already a '_' parameter, set its value
            cacheURL.replace( rts, "$1_=" + ajax_nonce++ ) :

            // Otherwise add one to the end
            cacheURL + ( ajax_rquery.test( cacheURL ) ? "&" : "?" ) + "_=" + ajax_nonce++;
        }
      }

      // Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
      if ( s.ifModified ) {
        if ( jQuery.lastModified[ cacheURL ] ) {
          jqXHR.setRequestHeader( "If-Modified-Since", jQuery.lastModified[ cacheURL ] );
        }
        if ( jQuery.etag[ cacheURL ] ) {
          jqXHR.setRequestHeader( "If-None-Match", jQuery.etag[ cacheURL ] );
        }
      }

      // Set the correct header, if data is being sent
      if ( s.data && s.hasContent && s.contentType !== false || options.contentType ) {
        jqXHR.setRequestHeader( "Content-Type", s.contentType );
      }

      // Set the Accepts header for the server, depending on the dataType
      jqXHR.setRequestHeader(
        "Accept",
        s.dataTypes[ 0 ] && s.accepts[ s.dataTypes[0] ] ?
          s.accepts[ s.dataTypes[0] ] + ( s.dataTypes[ 0 ] !== "*" ? ", " + allTypes + "; q=0.01" : "" ) :
          s.accepts[ "*" ]
      );

      // Check for headers option
      for ( i in s.headers ) {
        jqXHR.setRequestHeader( i, s.headers[ i ] );
      }

      // Allow custom headers/mimetypes and early abort
      if ( s.beforeSend && ( s.beforeSend.call( callbackContext, jqXHR, s ) === false || state === 2 ) ) {
        // Abort if not done already and return
        return jqXHR.abort();
      }

      // aborting is no longer a cancellation
      strAbort = "abort";

      // Install callbacks on deferreds
      for ( i in { success: 1, error: 1, complete: 1 } ) {
        jqXHR[ i ]( s[ i ] );
      }

      // Get transport
      transport = inspectPrefiltersOrTransports( transports, s, options, jqXHR );

      // If no transport, we auto-abort
      if ( !transport ) {
        done( -1, "No Transport" );
      } else {
        jqXHR.readyState = 1;

        // Send global event
        if ( fireGlobals ) {
          globalEventContext.trigger( "ajaxSend", [ jqXHR, s ] );
        }
        // Timeout
        if ( s.async && s.timeout > 0 ) {
          timeoutTimer = setTimeout(function() {
            jqXHR.abort("timeout");
          }, s.timeout );
        }

        try {
          state = 1;
          transport.send( requestHeaders, done );
        } catch ( e ) {
          // Propagate exception as error if not done
          if ( state < 2 ) {
            done( -1, e );
            // Simply rethrow otherwise
          } else {
            throw e;
          }
        }
      }

      // Callback for when everything is done
      function done( status, nativeStatusText, responses, headers ) {
        var isSuccess, success, error, response, modified,
          statusText = nativeStatusText;

        // Called once
        if ( state === 2 ) {
          return;
        }

        // State is "done" now
        state = 2;

        // Clear timeout if it exists
        if ( timeoutTimer ) {
          clearTimeout( timeoutTimer );
        }

        // Dereference transport for early garbage collection
        // (no matter how long the jqXHR object will be used)
        transport = undefined;

        // Cache response headers
        responseHeadersString = headers || "";

        // Set readyState
        jqXHR.readyState = status > 0 ? 4 : 0;

        // Determine if successful
        isSuccess = status >= 200 && status < 300 || status === 304;

        // Get response data
        if ( responses ) {
          response = ajaxHandleResponses( s, jqXHR, responses );
        }

        // Convert no matter what (that way responseXXX fields are always set)
        response = ajaxConvert( s, response, jqXHR, isSuccess );

        // If successful, handle type chaining
        if ( isSuccess ) {

          // Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
          if ( s.ifModified ) {
            modified = jqXHR.getResponseHeader("Last-Modified");
            if ( modified ) {
              jQuery.lastModified[ cacheURL ] = modified;
            }
            modified = jqXHR.getResponseHeader("etag");
            if ( modified ) {
              jQuery.etag[ cacheURL ] = modified;
            }
          }

          // if no content
          if ( status === 204 || s.type === "HEAD" ) {
            statusText = "nocontent";

            // if not modified
          } else if ( status === 304 ) {
            statusText = "notmodified";

            // If we have data, let's convert it
          } else {
            statusText = response.state;
            success = response.data;
            error = response.error;
            isSuccess = !error;
          }
        } else {
          // We extract error from statusText
          // then normalize statusText and status for non-aborts
          error = statusText;
          if ( status || !statusText ) {
            statusText = "error";
            if ( status < 0 ) {
              status = 0;
            }
          }
        }

        // Set data for the fake xhr object
        jqXHR.status = status;
        jqXHR.statusText = ( nativeStatusText || statusText ) + "";

        // Success/Error
        if ( isSuccess ) {
          deferred.resolveWith( callbackContext, [ success, statusText, jqXHR ] );
        } else {
          deferred.rejectWith( callbackContext, [ jqXHR, statusText, error ] );
        }

        // Status-dependent callbacks
        jqXHR.statusCode( statusCode );
        statusCode = undefined;

        if ( fireGlobals ) {
          globalEventContext.trigger( isSuccess ? "ajaxSuccess" : "ajaxError",
            [ jqXHR, s, isSuccess ? success : error ] );
        }

        // Complete
        completeDeferred.fireWith( callbackContext, [ jqXHR, statusText ] );

        if ( fireGlobals ) {
          globalEventContext.trigger( "ajaxComplete", [ jqXHR, s ] );
          // Handle the global AJAX counter
          if ( !( --jQuery.active ) ) {
            jQuery.event.trigger("ajaxStop");
          }
        }
      }

      return jqXHR;
    },

    getJSON: function( url, data, callback ) {
      return jQuery.get( url, data, callback, "json" );
    },

    getScript: function( url, callback ) {
      return jQuery.get( url, undefined, callback, "script" );
    }
  });

  jQuery.each( [ "get", "post" ], function( i, method ) {
    jQuery[ method ] = function( url, data, callback, type ) {
      // shift arguments if data argument was omitted
      if ( jQuery.isFunction( data ) ) {
        type = type || callback;
        callback = data;
        data = undefined;
      }

      return jQuery.ajax({
        url: url,
        type: method,
        dataType: type,
        data: data,
        success: callback
      });
    };
  });

  /* Handles responses to an ajax request:
   * - finds the right dataType (mediates between content-type and expected dataType)
   * - returns the corresponding response
   */
  function ajaxHandleResponses( s, jqXHR, responses ) {

    var ct, type, finalDataType, firstDataType,
      contents = s.contents,
      dataTypes = s.dataTypes;

    // Remove auto dataType and get content-type in the process
    while( dataTypes[ 0 ] === "*" ) {
      dataTypes.shift();
      if ( ct === undefined ) {
        ct = s.mimeType || jqXHR.getResponseHeader("Content-Type");
      }
    }

    // Check if we're dealing with a known content-type
    if ( ct ) {
      for ( type in contents ) {
        if ( contents[ type ] && contents[ type ].test( ct ) ) {
          dataTypes.unshift( type );
          break;
        }
      }
    }

    // Check to see if we have a response for the expected dataType
    if ( dataTypes[ 0 ] in responses ) {
      finalDataType = dataTypes[ 0 ];
    } else {
      // Try convertible dataTypes
      for ( type in responses ) {
        if ( !dataTypes[ 0 ] || s.converters[ type + " " + dataTypes[0] ] ) {
          finalDataType = type;
          break;
        }
        if ( !firstDataType ) {
          firstDataType = type;
        }
      }
      // Or just use first one
      finalDataType = finalDataType || firstDataType;
    }

    // If we found a dataType
    // We add the dataType to the list if needed
    // and return the corresponding response
    if ( finalDataType ) {
      if ( finalDataType !== dataTypes[ 0 ] ) {
        dataTypes.unshift( finalDataType );
      }
      return responses[ finalDataType ];
    }
  }

  /* Chain conversions given the request and the original response
   * Also sets the responseXXX fields on the jqXHR instance
   */
  function ajaxConvert( s, response, jqXHR, isSuccess ) {
    var conv2, current, conv, tmp, prev,
      converters = {},
    // Work with a copy of dataTypes in case we need to modify it for conversion
      dataTypes = s.dataTypes.slice();

    // Create converters map with lowercased keys
    if ( dataTypes[ 1 ] ) {
      for ( conv in s.converters ) {
        converters[ conv.toLowerCase() ] = s.converters[ conv ];
      }
    }

    current = dataTypes.shift();

    // Convert to each sequential dataType
    while ( current ) {

      if ( s.responseFields[ current ] ) {
        jqXHR[ s.responseFields[ current ] ] = response;
      }

      // Apply the dataFilter if provided
      if ( !prev && isSuccess && s.dataFilter ) {
        response = s.dataFilter( response, s.dataType );
      }

      prev = current;
      current = dataTypes.shift();

      if ( current ) {

        // There's only work to do if current dataType is non-auto
        if ( current === "*" ) {

          current = prev;

          // Convert response if prev dataType is non-auto and differs from current
        } else if ( prev !== "*" && prev !== current ) {

          // Seek a direct converter
          conv = converters[ prev + " " + current ] || converters[ "* " + current ];

          // If none found, seek a pair
          if ( !conv ) {
            for ( conv2 in converters ) {

              // If conv2 outputs current
              tmp = conv2.split( " " );
              if ( tmp[ 1 ] === current ) {

                // If prev can be converted to accepted input
                conv = converters[ prev + " " + tmp[ 0 ] ] ||
                  converters[ "* " + tmp[ 0 ] ];
                if ( conv ) {
                  // Condense equivalence converters
                  if ( conv === true ) {
                    conv = converters[ conv2 ];

                    // Otherwise, insert the intermediate dataType
                  } else if ( converters[ conv2 ] !== true ) {
                    current = tmp[ 0 ];
                    dataTypes.unshift( tmp[ 1 ] );
                  }
                  break;
                }
              }
            }
          }

          // Apply converter (if not an equivalence)
          if ( conv !== true ) {

            // Unless errors are allowed to bubble, catch and return them
            if ( conv && s[ "throws" ] ) {
              response = conv( response );
            } else {
              try {
                response = conv( response );
              } catch ( e ) {
                return { state: "parsererror", error: conv ? e : "No conversion from " + prev + " to " + current };
              }
            }
          }
        }
      }
    }

    return { state: "success", data: response };
  }
// Install script dataType
  jQuery.ajaxSetup({
    accepts: {
      script: "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"
    },
    contents: {
      script: /(?:java|ecma)script/
    },
    converters: {
      "text script": function( text ) {
        jQuery.globalEval( text );
        return text;
      }
    }
  });

// Handle cache's special case and crossDomain
  jQuery.ajaxPrefilter( "script", function( s ) {
    if ( s.cache === undefined ) {
      s.cache = false;
    }
    if ( s.crossDomain ) {
      s.type = "GET";
    }
  });

// Bind script tag hack transport
  jQuery.ajaxTransport( "script", function( s ) {
    // This transport only deals with cross domain requests
    if ( s.crossDomain ) {
      var script, callback;
      return {
        send: function( _, complete ) {
          script = jQuery("<script>").prop({
            async: true,
            charset: s.scriptCharset,
            src: s.url
          }).on(
              "load error",
              callback = function( evt ) {
                script.remove();
                callback = null;
                if ( evt ) {
                  complete( evt.type === "error" ? 404 : 200, evt.type );
                }
              }
            );
          document.head.appendChild( script[ 0 ] );
        },
        abort: function() {
          if ( callback ) {
            callback();
          }
        }
      };
    }
  });
  var oldCallbacks = [],
    rjsonp = /(=)\?(?=&|$)|\?\?/;

// Default jsonp settings
  jQuery.ajaxSetup({
    jsonp: "callback",
    jsonpCallback: function() {
      var callback = oldCallbacks.pop() || ( jQuery.expando + "_" + ( ajax_nonce++ ) );
      this[ callback ] = true;
      return callback;
    }
  });

// Detect, normalize options and install callbacks for jsonp requests
  jQuery.ajaxPrefilter( "json jsonp", function( s, originalSettings, jqXHR ) {

    var callbackName, overwritten, responseContainer,
      jsonProp = s.jsonp !== false && ( rjsonp.test( s.url ) ?
        "url" :
        typeof s.data === "string" && !( s.contentType || "" ).indexOf("application/x-www-form-urlencoded") && rjsonp.test( s.data ) && "data"
        );

    // Handle iff the expected data type is "jsonp" or we have a parameter to set
    if ( jsonProp || s.dataTypes[ 0 ] === "jsonp" ) {

      // Get callback name, remembering preexisting value associated with it
      callbackName = s.jsonpCallback = jQuery.isFunction( s.jsonpCallback ) ?
        s.jsonpCallback() :
        s.jsonpCallback;

      // Insert callback into url or form data
      if ( jsonProp ) {
        s[ jsonProp ] = s[ jsonProp ].replace( rjsonp, "$1" + callbackName );
      } else if ( s.jsonp !== false ) {
        s.url += ( ajax_rquery.test( s.url ) ? "&" : "?" ) + s.jsonp + "=" + callbackName;
      }

      // Use data converter to retrieve json after script execution
      s.converters["script json"] = function() {
        if ( !responseContainer ) {
          jQuery.error( callbackName + " was not called" );
        }
        return responseContainer[ 0 ];
      };

      // force json dataType
      s.dataTypes[ 0 ] = "json";

      // Install callback
      overwritten = window[ callbackName ];
      window[ callbackName ] = function() {
        responseContainer = arguments;
      };

      // Clean-up function (fires after converters)
      jqXHR.always(function() {
        // Restore preexisting value
        window[ callbackName ] = overwritten;

        // Save back as free
        if ( s[ callbackName ] ) {
          // make sure that re-using the options doesn't screw things around
          s.jsonpCallback = originalSettings.jsonpCallback;

          // save the callback name for future use
          oldCallbacks.push( callbackName );
        }

        // Call if it was a function and we have a response
        if ( responseContainer && jQuery.isFunction( overwritten ) ) {
          overwritten( responseContainer[ 0 ] );
        }

        responseContainer = overwritten = undefined;
      });

      // Delegate to script
      return "script";
    }
  });
  jQuery.ajaxSettings.xhr = function() {
    try {
      return new XMLHttpRequest();
    } catch( e ) {}
  };

  var xhrSupported = jQuery.ajaxSettings.xhr(),
    xhrSuccessStatus = {
      // file protocol always yields status code 0, assume 200
      0: 200,
      // Support: IE9
      // #1450: sometimes IE returns 1223 when it should be 204
      1223: 204
    },
  // Support: IE9
  // We need to keep track of outbound xhr and abort them manually
  // because IE is not smart enough to do it all by itself
    xhrId = 0,
    xhrCallbacks = {};

  if ( window.ActiveXObject ) {
    jQuery( window ).on( "unload", function() {
      for( var key in xhrCallbacks ) {
        xhrCallbacks[ key ]();
      }
      xhrCallbacks = undefined;
    });
  }

  jQuery.support.cors = !!xhrSupported && ( "withCredentials" in xhrSupported );
  jQuery.support.ajax = xhrSupported = !!xhrSupported;

  jQuery.ajaxTransport(function( options ) {
    var callback;
    // Cross domain only allowed if supported through XMLHttpRequest
    if ( jQuery.support.cors || xhrSupported && !options.crossDomain ) {
      return {
        send: function( headers, complete ) {
          var i, id,
            xhr = options.xhr();
          xhr.open( options.type, options.url, options.async, options.username, options.password );
          // Apply custom fields if provided
          if ( options.xhrFields ) {
            for ( i in options.xhrFields ) {
              xhr[ i ] = options.xhrFields[ i ];
            }
          }
          // Override mime type if needed
          if ( options.mimeType && xhr.overrideMimeType ) {
            xhr.overrideMimeType( options.mimeType );
          }
          // X-Requested-With header
          // For cross-domain requests, seeing as conditions for a preflight are
          // akin to a jigsaw puzzle, we simply never set it to be sure.
          // (it can always be set on a per-request basis or even using ajaxSetup)
          // For same-domain requests, won't change header if already provided.
          if ( !options.crossDomain && !headers["X-Requested-With"] ) {
            headers["X-Requested-With"] = "XMLHttpRequest";
          }
          // Set headers
          for ( i in headers ) {
            xhr.setRequestHeader( i, headers[ i ] );
          }
          // Callback
          callback = function( type ) {
            return function() {
              if ( callback ) {
                delete xhrCallbacks[ id ];
                callback = xhr.onload = xhr.onerror = null;
                if ( type === "abort" ) {
                  xhr.abort();
                } else if ( type === "error" ) {
                  complete(
                    // file protocol always yields status 0, assume 404
                    xhr.status || 404,
                    xhr.statusText
                  );
                } else {
                  complete(
                    xhrSuccessStatus[ xhr.status ] || xhr.status,
                    xhr.statusText,
                    // Support: IE9
                    // #11426: When requesting binary data, IE9 will throw an exception
                    // on any attempt to access responseText
                    typeof xhr.responseText === "string" ? {
                      text: xhr.responseText
                    } : undefined,
                    xhr.getAllResponseHeaders()
                  );
                }
              }
            };
          };
          // Listen to events
          xhr.onload = callback();
          xhr.onerror = callback("error");
          // Create the abort callback
          callback = xhrCallbacks[( id = xhrId++ )] = callback("abort");
          // Do send the request
          // This may raise an exception which is actually
          // handled in jQuery.ajax (so no try/catch here)
          xhr.send( options.hasContent && options.data || null );
        },
        abort: function() {
          if ( callback ) {
            callback();
          }
        }
      };
    }
  });
  var fxNow, timerId,
    rfxtypes = /^(?:toggle|show|hide)$/,
    rfxnum = new RegExp( "^(?:([+-])=|)(" + core_pnum + ")([a-z%]*)$", "i" ),
    rrun = /queueHooks$/,
    animationPrefilters = [ defaultPrefilter ],
    tweeners = {
      "*": [function( prop, value ) {
        var tween = this.createTween( prop, value ),
          target = tween.cur(),
          parts = rfxnum.exec( value ),
          unit = parts && parts[ 3 ] || ( jQuery.cssNumber[ prop ] ? "" : "px" ),

        // Starting value computation is required for potential unit mismatches
          start = ( jQuery.cssNumber[ prop ] || unit !== "px" && +target ) &&
            rfxnum.exec( jQuery.css( tween.elem, prop ) ),
          scale = 1,
          maxIterations = 20;

        if ( start && start[ 3 ] !== unit ) {
          // Trust units reported by jQuery.css
          unit = unit || start[ 3 ];

          // Make sure we update the tween properties later on
          parts = parts || [];

          // Iteratively approximate from a nonzero starting point
          start = +target || 1;

          do {
            // If previous iteration zeroed out, double until we get *something*
            // Use a string for doubling factor so we don't accidentally see scale as unchanged below
            scale = scale || ".5";

            // Adjust and apply
            start = start / scale;
            jQuery.style( tween.elem, prop, start + unit );

            // Update scale, tolerating zero or NaN from tween.cur()
            // And breaking the loop if scale is unchanged or perfect, or if we've just had enough
          } while ( scale !== (scale = tween.cur() / target) && scale !== 1 && --maxIterations );
        }

        // Update tween properties
        if ( parts ) {
          start = tween.start = +start || +target || 0;
          tween.unit = unit;
          // If a +=/-= token was provided, we're doing a relative animation
          tween.end = parts[ 1 ] ?
            start + ( parts[ 1 ] + 1 ) * parts[ 2 ] :
            +parts[ 2 ];
        }

        return tween;
      }]
    };

// Animations created synchronously will run synchronously
  function createFxNow() {
    setTimeout(function() {
      fxNow = undefined;
    });
    return ( fxNow = jQuery.now() );
  }

  function createTween( value, prop, animation ) {
    var tween,
      collection = ( tweeners[ prop ] || [] ).concat( tweeners[ "*" ] ),
      index = 0,
      length = collection.length;
    for ( ; index < length; index++ ) {
      if ( (tween = collection[ index ].call( animation, prop, value )) ) {

        // we're done with this property
        return tween;
      }
    }
  }

  function Animation( elem, properties, options ) {
    var result,
      stopped,
      index = 0,
      length = animationPrefilters.length,
      deferred = jQuery.Deferred().always( function() {
        // don't match elem in the :animated selector
        delete tick.elem;
      }),
      tick = function() {
        if ( stopped ) {
          return false;
        }
        var currentTime = fxNow || createFxNow(),
          remaining = Math.max( 0, animation.startTime + animation.duration - currentTime ),
        // archaic crash bug won't allow us to use 1 - ( 0.5 || 0 ) (#12497)
          temp = remaining / animation.duration || 0,
          percent = 1 - temp,
          index = 0,
          length = animation.tweens.length;

        for ( ; index < length ; index++ ) {
          animation.tweens[ index ].run( percent );
        }

        deferred.notifyWith( elem, [ animation, percent, remaining ]);

        if ( percent < 1 && length ) {
          return remaining;
        } else {
          deferred.resolveWith( elem, [ animation ] );
          return false;
        }
      },
      animation = deferred.promise({
        elem: elem,
        props: jQuery.extend( {}, properties ),
        opts: jQuery.extend( true, { specialEasing: {} }, options ),
        originalProperties: properties,
        originalOptions: options,
        startTime: fxNow || createFxNow(),
        duration: options.duration,
        tweens: [],
        createTween: function( prop, end ) {
          var tween = jQuery.Tween( elem, animation.opts, prop, end,
            animation.opts.specialEasing[ prop ] || animation.opts.easing );
          animation.tweens.push( tween );
          return tween;
        },
        stop: function( gotoEnd ) {
          var index = 0,
          // if we are going to the end, we want to run all the tweens
          // otherwise we skip this part
            length = gotoEnd ? animation.tweens.length : 0;
          if ( stopped ) {
            return this;
          }
          stopped = true;
          for ( ; index < length ; index++ ) {
            animation.tweens[ index ].run( 1 );
          }

          // resolve when we played the last frame
          // otherwise, reject
          if ( gotoEnd ) {
            deferred.resolveWith( elem, [ animation, gotoEnd ] );
          } else {
            deferred.rejectWith( elem, [ animation, gotoEnd ] );
          }
          return this;
        }
      }),
      props = animation.props;

    propFilter( props, animation.opts.specialEasing );

    for ( ; index < length ; index++ ) {
      result = animationPrefilters[ index ].call( animation, elem, props, animation.opts );
      if ( result ) {
        return result;
      }
    }

    jQuery.map( props, createTween, animation );

    if ( jQuery.isFunction( animation.opts.start ) ) {
      animation.opts.start.call( elem, animation );
    }

    jQuery.fx.timer(
      jQuery.extend( tick, {
        elem: elem,
        anim: animation,
        queue: animation.opts.queue
      })
    );

    // attach callbacks from options
    return animation.progress( animation.opts.progress )
      .done( animation.opts.done, animation.opts.complete )
      .fail( animation.opts.fail )
      .always( animation.opts.always );
  }

  function propFilter( props, specialEasing ) {
    var index, name, easing, value, hooks;

    // camelCase, specialEasing and expand cssHook pass
    for ( index in props ) {
      name = jQuery.camelCase( index );
      easing = specialEasing[ name ];
      value = props[ index ];
      if ( jQuery.isArray( value ) ) {
        easing = value[ 1 ];
        value = props[ index ] = value[ 0 ];
      }

      if ( index !== name ) {
        props[ name ] = value;
        delete props[ index ];
      }

      hooks = jQuery.cssHooks[ name ];
      if ( hooks && "expand" in hooks ) {
        value = hooks.expand( value );
        delete props[ name ];

        // not quite $.extend, this wont overwrite keys already present.
        // also - reusing 'index' from above because we have the correct "name"
        for ( index in value ) {
          if ( !( index in props ) ) {
            props[ index ] = value[ index ];
            specialEasing[ index ] = easing;
          }
        }
      } else {
        specialEasing[ name ] = easing;
      }
    }
  }

  jQuery.Animation = jQuery.extend( Animation, {

    tweener: function( props, callback ) {
      if ( jQuery.isFunction( props ) ) {
        callback = props;
        props = [ "*" ];
      } else {
        props = props.split(" ");
      }

      var prop,
        index = 0,
        length = props.length;

      for ( ; index < length ; index++ ) {
        prop = props[ index ];
        tweeners[ prop ] = tweeners[ prop ] || [];
        tweeners[ prop ].unshift( callback );
      }
    },

    prefilter: function( callback, prepend ) {
      if ( prepend ) {
        animationPrefilters.unshift( callback );
      } else {
        animationPrefilters.push( callback );
      }
    }
  });

  function defaultPrefilter( elem, props, opts ) {
    /* jshint validthis: true */
    var prop, value, toggle, tween, hooks, oldfire,
      anim = this,
      orig = {},
      style = elem.style,
      hidden = elem.nodeType && isHidden( elem ),
      dataShow = data_priv.get( elem, "fxshow" );

    // handle queue: false promises
    if ( !opts.queue ) {
      hooks = jQuery._queueHooks( elem, "fx" );
      if ( hooks.unqueued == null ) {
        hooks.unqueued = 0;
        oldfire = hooks.empty.fire;
        hooks.empty.fire = function() {
          if ( !hooks.unqueued ) {
            oldfire();
          }
        };
      }
      hooks.unqueued++;

      anim.always(function() {
        // doing this makes sure that the complete handler will be called
        // before this completes
        anim.always(function() {
          hooks.unqueued--;
          if ( !jQuery.queue( elem, "fx" ).length ) {
            hooks.empty.fire();
          }
        });
      });
    }

    // height/width overflow pass
    if ( elem.nodeType === 1 && ( "height" in props || "width" in props ) ) {
      // Make sure that nothing sneaks out
      // Record all 3 overflow attributes because IE9-10 do not
      // change the overflow attribute when overflowX and
      // overflowY are set to the same value
      opts.overflow = [ style.overflow, style.overflowX, style.overflowY ];

      // Set display property to inline-block for height/width
      // animations on inline elements that are having width/height animated
      if ( jQuery.css( elem, "display" ) === "inline" &&
        jQuery.css( elem, "float" ) === "none" ) {

        style.display = "inline-block";
      }
    }

    if ( opts.overflow ) {
      style.overflow = "hidden";
      anim.always(function() {
        style.overflow = opts.overflow[ 0 ];
        style.overflowX = opts.overflow[ 1 ];
        style.overflowY = opts.overflow[ 2 ];
      });
    }


    // show/hide pass
    for ( prop in props ) {
      value = props[ prop ];
      if ( rfxtypes.exec( value ) ) {
        delete props[ prop ];
        toggle = toggle || value === "toggle";
        if ( value === ( hidden ? "hide" : "show" ) ) {

          // If there is dataShow left over from a stopped hide or show and we are going to proceed with show, we should pretend to be hidden
          if ( value === "show" && dataShow && dataShow[ prop ] !== undefined ) {
            hidden = true;
          } else {
            continue;
          }
        }
        orig[ prop ] = dataShow && dataShow[ prop ] || jQuery.style( elem, prop );
      }
    }

    if ( !jQuery.isEmptyObject( orig ) ) {
      if ( dataShow ) {
        if ( "hidden" in dataShow ) {
          hidden = dataShow.hidden;
        }
      } else {
        dataShow = data_priv.access( elem, "fxshow", {} );
      }

      // store state if its toggle - enables .stop().toggle() to "reverse"
      if ( toggle ) {
        dataShow.hidden = !hidden;
      }
      if ( hidden ) {
        jQuery( elem ).show();
      } else {
        anim.done(function() {
          jQuery( elem ).hide();
        });
      }
      anim.done(function() {
        var prop;

        data_priv.remove( elem, "fxshow" );
        for ( prop in orig ) {
          jQuery.style( elem, prop, orig[ prop ] );
        }
      });
      for ( prop in orig ) {
        tween = createTween( hidden ? dataShow[ prop ] : 0, prop, anim );

        if ( !( prop in dataShow ) ) {
          dataShow[ prop ] = tween.start;
          if ( hidden ) {
            tween.end = tween.start;
            tween.start = prop === "width" || prop === "height" ? 1 : 0;
          }
        }
      }
    }
  }

  function Tween( elem, options, prop, end, easing ) {
    return new Tween.prototype.init( elem, options, prop, end, easing );
  }
  jQuery.Tween = Tween;

  Tween.prototype = {
    constructor: Tween,
    init: function( elem, options, prop, end, easing, unit ) {
      this.elem = elem;
      this.prop = prop;
      this.easing = easing || "swing";
      this.options = options;
      this.start = this.now = this.cur();
      this.end = end;
      this.unit = unit || ( jQuery.cssNumber[ prop ] ? "" : "px" );
    },
    cur: function() {
      var hooks = Tween.propHooks[ this.prop ];

      return hooks && hooks.get ?
        hooks.get( this ) :
        Tween.propHooks._default.get( this );
    },
    run: function( percent ) {
      var eased,
        hooks = Tween.propHooks[ this.prop ];

      if ( this.options.duration ) {
        this.pos = eased = jQuery.easing[ this.easing ](
          percent, this.options.duration * percent, 0, 1, this.options.duration
        );
      } else {
        this.pos = eased = percent;
      }
      this.now = ( this.end - this.start ) * eased + this.start;

      if ( this.options.step ) {
        this.options.step.call( this.elem, this.now, this );
      }

      if ( hooks && hooks.set ) {
        hooks.set( this );
      } else {
        Tween.propHooks._default.set( this );
      }
      return this;
    }
  };

  Tween.prototype.init.prototype = Tween.prototype;

  Tween.propHooks = {
    _default: {
      get: function( tween ) {
        var result;

        if ( tween.elem[ tween.prop ] != null &&
          (!tween.elem.style || tween.elem.style[ tween.prop ] == null) ) {
          return tween.elem[ tween.prop ];
        }

        // passing an empty string as a 3rd parameter to .css will automatically
        // attempt a parseFloat and fallback to a string if the parse fails
        // so, simple values such as "10px" are parsed to Float.
        // complex values such as "rotate(1rad)" are returned as is.
        result = jQuery.css( tween.elem, tween.prop, "" );
        // Empty strings, null, undefined and "auto" are converted to 0.
        return !result || result === "auto" ? 0 : result;
      },
      set: function( tween ) {
        // use step hook for back compat - use cssHook if its there - use .style if its
        // available and use plain properties where available
        if ( jQuery.fx.step[ tween.prop ] ) {
          jQuery.fx.step[ tween.prop ]( tween );
        } else if ( tween.elem.style && ( tween.elem.style[ jQuery.cssProps[ tween.prop ] ] != null || jQuery.cssHooks[ tween.prop ] ) ) {
          jQuery.style( tween.elem, tween.prop, tween.now + tween.unit );
        } else {
          tween.elem[ tween.prop ] = tween.now;
        }
      }
    }
  };

// Support: IE9
// Panic based approach to setting things on disconnected nodes

  Tween.propHooks.scrollTop = Tween.propHooks.scrollLeft = {
    set: function( tween ) {
      if ( tween.elem.nodeType && tween.elem.parentNode ) {
        tween.elem[ tween.prop ] = tween.now;
      }
    }
  };

  jQuery.each([ "toggle", "show", "hide" ], function( i, name ) {
    var cssFn = jQuery.fn[ name ];
    jQuery.fn[ name ] = function( speed, easing, callback ) {
      return speed == null || typeof speed === "boolean" ?
        cssFn.apply( this, arguments ) :
        this.animate( genFx( name, true ), speed, easing, callback );
    };
  });

  jQuery.fn.extend({
    fadeTo: function( speed, to, easing, callback ) {

      // show any hidden elements after setting opacity to 0
      return this.filter( isHidden ).css( "opacity", 0 ).show()

        // animate to the value specified
        .end().animate({ opacity: to }, speed, easing, callback );
    },
    animate: function( prop, speed, easing, callback ) {
      var empty = jQuery.isEmptyObject( prop ),
        optall = jQuery.speed( speed, easing, callback ),
        doAnimation = function() {
          // Operate on a copy of prop so per-property easing won't be lost
          var anim = Animation( this, jQuery.extend( {}, prop ), optall );

          // Empty animations, or finishing resolves immediately
          if ( empty || data_priv.get( this, "finish" ) ) {
            anim.stop( true );
          }
        };
      doAnimation.finish = doAnimation;

      return empty || optall.queue === false ?
        this.each( doAnimation ) :
        this.queue( optall.queue, doAnimation );
    },
    stop: function( type, clearQueue, gotoEnd ) {
      var stopQueue = function( hooks ) {
        var stop = hooks.stop;
        delete hooks.stop;
        stop( gotoEnd );
      };

      if ( typeof type !== "string" ) {
        gotoEnd = clearQueue;
        clearQueue = type;
        type = undefined;
      }
      if ( clearQueue && type !== false ) {
        this.queue( type || "fx", [] );
      }

      return this.each(function() {
        var dequeue = true,
          index = type != null && type + "queueHooks",
          timers = jQuery.timers,
          data = data_priv.get( this );

        if ( index ) {
          if ( data[ index ] && data[ index ].stop ) {
            stopQueue( data[ index ] );
          }
        } else {
          for ( index in data ) {
            if ( data[ index ] && data[ index ].stop && rrun.test( index ) ) {
              stopQueue( data[ index ] );
            }
          }
        }

        for ( index = timers.length; index--; ) {
          if ( timers[ index ].elem === this && (type == null || timers[ index ].queue === type) ) {
            timers[ index ].anim.stop( gotoEnd );
            dequeue = false;
            timers.splice( index, 1 );
          }
        }

        // start the next in the queue if the last step wasn't forced
        // timers currently will call their complete callbacks, which will dequeue
        // but only if they were gotoEnd
        if ( dequeue || !gotoEnd ) {
          jQuery.dequeue( this, type );
        }
      });
    },
    finish: function( type ) {
      if ( type !== false ) {
        type = type || "fx";
      }
      return this.each(function() {
        var index,
          data = data_priv.get( this ),
          queue = data[ type + "queue" ],
          hooks = data[ type + "queueHooks" ],
          timers = jQuery.timers,
          length = queue ? queue.length : 0;

        // enable finishing flag on private data
        data.finish = true;

        // empty the queue first
        jQuery.queue( this, type, [] );

        if ( hooks && hooks.stop ) {
          hooks.stop.call( this, true );
        }

        // look for any active animations, and finish them
        for ( index = timers.length; index--; ) {
          if ( timers[ index ].elem === this && timers[ index ].queue === type ) {
            timers[ index ].anim.stop( true );
            timers.splice( index, 1 );
          }
        }

        // look for any animations in the old queue and finish them
        for ( index = 0; index < length; index++ ) {
          if ( queue[ index ] && queue[ index ].finish ) {
            queue[ index ].finish.call( this );
          }
        }

        // turn off finishing flag
        delete data.finish;
      });
    }
  });

// Generate parameters to create a standard animation
  function genFx( type, includeWidth ) {
    var which,
      attrs = { height: type },
      i = 0;

    // if we include width, step value is 1 to do all cssExpand values,
    // if we don't include width, step value is 2 to skip over Left and Right
    includeWidth = includeWidth? 1 : 0;
    for( ; i < 4 ; i += 2 - includeWidth ) {
      which = cssExpand[ i ];
      attrs[ "margin" + which ] = attrs[ "padding" + which ] = type;
    }

    if ( includeWidth ) {
      attrs.opacity = attrs.width = type;
    }

    return attrs;
  }

// Generate shortcuts for custom animations
  jQuery.each({
    slideDown: genFx("show"),
    slideUp: genFx("hide"),
    slideToggle: genFx("toggle"),
    fadeIn: { opacity: "show" },
    fadeOut: { opacity: "hide" },
    fadeToggle: { opacity: "toggle" }
  }, function( name, props ) {
    jQuery.fn[ name ] = function( speed, easing, callback ) {
      return this.animate( props, speed, easing, callback );
    };
  });

  jQuery.speed = function( speed, easing, fn ) {
    var opt = speed && typeof speed === "object" ? jQuery.extend( {}, speed ) : {
      complete: fn || !fn && easing ||
        jQuery.isFunction( speed ) && speed,
      duration: speed,
      easing: fn && easing || easing && !jQuery.isFunction( easing ) && easing
    };

    opt.duration = jQuery.fx.off ? 0 : typeof opt.duration === "number" ? opt.duration :
      opt.duration in jQuery.fx.speeds ? jQuery.fx.speeds[ opt.duration ] : jQuery.fx.speeds._default;

    // normalize opt.queue - true/undefined/null -> "fx"
    if ( opt.queue == null || opt.queue === true ) {
      opt.queue = "fx";
    }

    // Queueing
    opt.old = opt.complete;

    opt.complete = function() {
      if ( jQuery.isFunction( opt.old ) ) {
        opt.old.call( this );
      }

      if ( opt.queue ) {
        jQuery.dequeue( this, opt.queue );
      }
    };

    return opt;
  };

  jQuery.easing = {
    linear: function( p ) {
      return p;
    },
    swing: function( p ) {
      return 0.5 - Math.cos( p*Math.PI ) / 2;
    }
  };

  jQuery.timers = [];
  jQuery.fx = Tween.prototype.init;
  jQuery.fx.tick = function() {
    var timer,
      timers = jQuery.timers,
      i = 0;

    fxNow = jQuery.now();

    for ( ; i < timers.length; i++ ) {
      timer = timers[ i ];
      // Checks the timer has not already been removed
      if ( !timer() && timers[ i ] === timer ) {
        timers.splice( i--, 1 );
      }
    }

    if ( !timers.length ) {
      jQuery.fx.stop();
    }
    fxNow = undefined;
  };

  jQuery.fx.timer = function( timer ) {
    if ( timer() && jQuery.timers.push( timer ) ) {
      jQuery.fx.start();
    }
  };

  jQuery.fx.interval = 13;

  jQuery.fx.start = function() {
    if ( !timerId ) {
      timerId = setInterval( jQuery.fx.tick, jQuery.fx.interval );
    }
  };

  jQuery.fx.stop = function() {
    clearInterval( timerId );
    timerId = null;
  };

  jQuery.fx.speeds = {
    slow: 600,
    fast: 200,
    // Default speed
    _default: 400
  };

// Back Compat <1.8 extension point
  jQuery.fx.step = {};

  if ( jQuery.expr && jQuery.expr.filters ) {
    jQuery.expr.filters.animated = function( elem ) {
      return jQuery.grep(jQuery.timers, function( fn ) {
        return elem === fn.elem;
      }).length;
    };
  }
  jQuery.fn.offset = function( options ) {
    if ( arguments.length ) {
      return options === undefined ?
        this :
        this.each(function( i ) {
          jQuery.offset.setOffset( this, options, i );
        });
    }

    var docElem, win,
      elem = this[ 0 ],
      box = { top: 0, left: 0 },
      doc = elem && elem.ownerDocument;

    if ( !doc ) {
      return;
    }

    docElem = doc.documentElement;

    // Make sure it's not a disconnected DOM node
    if ( !jQuery.contains( docElem, elem ) ) {
      return box;
    }

    // If we don't have gBCR, just use 0,0 rather than error
    // BlackBerry 5, iOS 3 (original iPhone)
    if ( typeof elem.getBoundingClientRect !== core_strundefined ) {
      box = elem.getBoundingClientRect();
    }
    win = getWindow( doc );
    return {
      top: box.top + win.pageYOffset - docElem.clientTop,
      left: box.left + win.pageXOffset - docElem.clientLeft
    };
  };

  jQuery.offset = {

    setOffset: function( elem, options, i ) {
      var curPosition, curLeft, curCSSTop, curTop, curOffset, curCSSLeft, calculatePosition,
        position = jQuery.css( elem, "position" ),
        curElem = jQuery( elem ),
        props = {};

      // Set position first, in-case top/left are set even on static elem
      if ( position === "static" ) {
        elem.style.position = "relative";
      }

      curOffset = curElem.offset();
      curCSSTop = jQuery.css( elem, "top" );
      curCSSLeft = jQuery.css( elem, "left" );
      calculatePosition = ( position === "absolute" || position === "fixed" ) && ( curCSSTop + curCSSLeft ).indexOf("auto") > -1;

      // Need to be able to calculate position if either top or left is auto and position is either absolute or fixed
      if ( calculatePosition ) {
        curPosition = curElem.position();
        curTop = curPosition.top;
        curLeft = curPosition.left;

      } else {
        curTop = parseFloat( curCSSTop ) || 0;
        curLeft = parseFloat( curCSSLeft ) || 0;
      }

      if ( jQuery.isFunction( options ) ) {
        options = options.call( elem, i, curOffset );
      }

      if ( options.top != null ) {
        props.top = ( options.top - curOffset.top ) + curTop;
      }
      if ( options.left != null ) {
        props.left = ( options.left - curOffset.left ) + curLeft;
      }

      if ( "using" in options ) {
        options.using.call( elem, props );

      } else {
        curElem.css( props );
      }
    }
  };


  jQuery.fn.extend({

    position: function() {
      if ( !this[ 0 ] ) {
        return;
      }

      var offsetParent, offset,
        elem = this[ 0 ],
        parentOffset = { top: 0, left: 0 };

      // Fixed elements are offset from window (parentOffset = {top:0, left: 0}, because it is it's only offset parent
      if ( jQuery.css( elem, "position" ) === "fixed" ) {
        // We assume that getBoundingClientRect is available when computed position is fixed
        offset = elem.getBoundingClientRect();

      } else {
        // Get *real* offsetParent
        offsetParent = this.offsetParent();

        // Get correct offsets
        offset = this.offset();
        if ( !jQuery.nodeName( offsetParent[ 0 ], "html" ) ) {
          parentOffset = offsetParent.offset();
        }

        // Add offsetParent borders
        parentOffset.top += jQuery.css( offsetParent[ 0 ], "borderTopWidth", true );
        parentOffset.left += jQuery.css( offsetParent[ 0 ], "borderLeftWidth", true );
      }

      // Subtract parent offsets and element margins
      return {
        top: offset.top - parentOffset.top - jQuery.css( elem, "marginTop", true ),
        left: offset.left - parentOffset.left - jQuery.css( elem, "marginLeft", true )
      };
    },

    offsetParent: function() {
      return this.map(function() {
        var offsetParent = this.offsetParent || docElem;

        while ( offsetParent && ( !jQuery.nodeName( offsetParent, "html" ) && jQuery.css( offsetParent, "position") === "static" ) ) {
          offsetParent = offsetParent.offsetParent;
        }

        return offsetParent || docElem;
      });
    }
  });


// Create scrollLeft and scrollTop methods
  jQuery.each( {scrollLeft: "pageXOffset", scrollTop: "pageYOffset"}, function( method, prop ) {
    var top = "pageYOffset" === prop;

    jQuery.fn[ method ] = function( val ) {
      return jQuery.access( this, function( elem, method, val ) {
        var win = getWindow( elem );

        if ( val === undefined ) {
          return win ? win[ prop ] : elem[ method ];
        }

        if ( win ) {
          win.scrollTo(
            !top ? val : window.pageXOffset,
            top ? val : window.pageYOffset
          );

        } else {
          elem[ method ] = val;
        }
      }, method, val, arguments.length, null );
    };
  });

  function getWindow( elem ) {
    return jQuery.isWindow( elem ) ? elem : elem.nodeType === 9 && elem.defaultView;
  }
// Create innerHeight, innerWidth, height, width, outerHeight and outerWidth methods
  jQuery.each( { Height: "height", Width: "width" }, function( name, type ) {
    jQuery.each( { padding: "inner" + name, content: type, "": "outer" + name }, function( defaultExtra, funcName ) {
      // margin is only for outerHeight, outerWidth
      jQuery.fn[ funcName ] = function( margin, value ) {
        var chainable = arguments.length && ( defaultExtra || typeof margin !== "boolean" ),
          extra = defaultExtra || ( margin === true || value === true ? "margin" : "border" );

        return jQuery.access( this, function( elem, type, value ) {
          var doc;

          if ( jQuery.isWindow( elem ) ) {
            // As of 5/8/2012 this will yield incorrect results for Mobile Safari, but there
            // isn't a whole lot we can do. See pull request at this URL for discussion:
            // https://github.com/jquery/jquery/pull/764
            return elem.document.documentElement[ "client" + name ];
          }

          // Get document width or height
          if ( elem.nodeType === 9 ) {
            doc = elem.documentElement;

            // Either scroll[Width/Height] or offset[Width/Height] or client[Width/Height],
            // whichever is greatest
            return Math.max(
              elem.body[ "scroll" + name ], doc[ "scroll" + name ],
              elem.body[ "offset" + name ], doc[ "offset" + name ],
              doc[ "client" + name ]
            );
          }

          return value === undefined ?
            // Get width or height on the element, requesting but not forcing parseFloat
            jQuery.css( elem, type, extra ) :

            // Set width or height on the element
            jQuery.style( elem, type, value, extra );
        }, type, chainable ? margin : undefined, chainable, null );
      };
    });
  });
// Limit scope pollution from any deprecated API
// (function() {

// The number of elements contained in the matched element set
  jQuery.fn.size = function() {
    return this.length;
  };

  jQuery.fn.andSelf = jQuery.fn.addBack;

// })();
  if ( typeof module === "object" && module && typeof module.exports === "object" ) {
    // Expose jQuery as module.exports in loaders that implement the Node
    // module pattern (including browserify). Do not create the global, since
    // the user will be storing it themselves locally, and globals are frowned
    // upon in the Node module world.
    module.exports = jQuery;
  } else {
    // Register as a named AMD module, since jQuery can be concatenated with other
    // files that may use define, but not via a proper concatenation script that
    // understands anonymous AMD modules. A named AMD is safest and most robust
    // way to register. Lowercase jquery is used because AMD module names are
    // derived from file names, and jQuery is normally delivered in a lowercase
    // file name. Do this after creating the global so that if an AMD module wants
    // to call noConflict to hide this version of jQuery, it will work.
    if ( typeof define === "function" && define.amd ) {
      define( "vendor/jquery", [], function () { return jQuery; } );
    }
  }

// If there is a window object, that at least has a document property,
// define jQuery and $ identifiers
  if ( typeof window === "object" && typeof window.document === "object" ) {
    window.jQuery = window.$ = jQuery;
  }

})( window );


/*!
 * Bootstrap v3.0.3 (http://getbootstrap.com)
 * Copyright 2013 Twitter, Inc.
 * Licensed under http://www.apache.org/licenses/LICENSE-2.0
 */

if (typeof jQuery === "undefined") { throw new Error("Bootstrap requires jQuery") }

/* ========================================================================
 * Bootstrap: transition.js v3.0.3
 * http://getbootstrap.com/javascript/#transitions
 * ========================================================================
 * Copyright 2013 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ======================================================================== */


+function ($) { "use strict";

  // CSS TRANSITION SUPPORT (Shoutout: http://www.modernizr.com/)
  // ============================================================

  function transitionEnd() {
    var el = document.createElement('bootstrap')

    var transEndEventNames = {
      'WebkitTransition' : 'webkitTransitionEnd'
      , 'MozTransition'    : 'transitionend'
      , 'OTransition'      : 'oTransitionEnd otransitionend'
      , 'transition'       : 'transitionend'
    }

    for (var name in transEndEventNames) {
      if (el.style[name] !== undefined) {
        return { end: transEndEventNames[name] }
      }
    }
  }

  // http://blog.alexmaccaw.com/css-transitions
  $.fn.emulateTransitionEnd = function (duration) {
    var called = false, $el = this
    $(this).one($.support.transition.end, function () { called = true })
    var callback = function () { if (!called) $($el).trigger($.support.transition.end) }
    setTimeout(callback, duration)
    return this
  }

  $(function () {
    $.support.transition = transitionEnd()
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: alert.js v3.0.3
 * http://getbootstrap.com/javascript/#alerts
 * ========================================================================
 * Copyright 2013 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ======================================================================== */


+function ($) { "use strict";

  // ALERT CLASS DEFINITION
  // ======================

  var dismiss = '[data-dismiss="alert"]'
  var Alert   = function (el) {
    $(el).on('click', dismiss, this.close)
  }

  Alert.prototype.close = function (e) {
    var $this    = $(this)
    var selector = $this.attr('data-target')

    if (!selector) {
      selector = $this.attr('href')
      selector = selector && selector.replace(/.*(?=#[^\s]*$)/, '') // strip for ie7
    }

    var $parent = $(selector)

    if (e) e.preventDefault()

    if (!$parent.length) {
      $parent = $this.hasClass('alert') ? $this : $this.parent()
    }

    $parent.trigger(e = $.Event('close.bs.alert'))

    if (e.isDefaultPrevented()) return

    $parent.removeClass('in')

    function removeElement() {
      $parent.trigger('closed.bs.alert').remove()
    }

    $.support.transition && $parent.hasClass('fade') ?
      $parent
        .one($.support.transition.end, removeElement)
        .emulateTransitionEnd(150) :
      removeElement()
  }


  // ALERT PLUGIN DEFINITION
  // =======================

  var old = $.fn.alert

  $.fn.alert = function (option) {
    return this.each(function () {
      var $this = $(this)
      var data  = $this.data('bs.alert')

      if (!data) $this.data('bs.alert', (data = new Alert(this)))
      if (typeof option == 'string') data[option].call($this)
    })
  }

  $.fn.alert.Constructor = Alert


  // ALERT NO CONFLICT
  // =================

  $.fn.alert.noConflict = function () {
    $.fn.alert = old
    return this
  }


  // ALERT DATA-API
  // ==============

  $(document).on('click.bs.alert.data-api', dismiss, Alert.prototype.close)

}(jQuery);

/* ========================================================================
 * Bootstrap: button.js v3.0.3
 * http://getbootstrap.com/javascript/#buttons
 * ========================================================================
 * Copyright 2013 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ======================================================================== */


+function ($) { "use strict";

  // BUTTON PUBLIC CLASS DEFINITION
  // ==============================

  var Button = function (element, options) {
    this.$element = $(element)
    this.options  = $.extend({}, Button.DEFAULTS, options)
  }

  Button.DEFAULTS = {
    loadingText: 'loading...'
  }

  Button.prototype.setState = function (state) {
    var d    = 'disabled'
    var $el  = this.$element
    var val  = $el.is('input') ? 'val' : 'html'
    var data = $el.data()

    state = state + 'Text'

    if (!data.resetText) $el.data('resetText', $el[val]())

    $el[val](data[state] || this.options[state])

    // push to event loop to allow forms to submit
    setTimeout(function () {
      state == 'loadingText' ?
        $el.addClass(d).attr(d, d) :
        $el.removeClass(d).removeAttr(d);
    }, 0)
  }

  Button.prototype.toggle = function () {
    var $parent = this.$element.closest('[data-toggle="buttons"]')
    var changed = true

    if ($parent.length) {
      var $input = this.$element.find('input')
      if ($input.prop('type') === 'radio') {
        // see if clicking on current one
        if ($input.prop('checked') && this.$element.hasClass('active'))
          changed = false
        else
          $parent.find('.active').removeClass('active')
      }
      if (changed) $input.prop('checked', !this.$element.hasClass('active')).trigger('change')
    }

    if (changed) this.$element.toggleClass('active')
  }


  // BUTTON PLUGIN DEFINITION
  // ========================

  var old = $.fn.button

  $.fn.button = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.button')
      var options = typeof option == 'object' && option

      if (!data) $this.data('bs.button', (data = new Button(this, options)))

      if (option == 'toggle') data.toggle()
      else if (option) data.setState(option)
    })
  }

  $.fn.button.Constructor = Button


  // BUTTON NO CONFLICT
  // ==================

  $.fn.button.noConflict = function () {
    $.fn.button = old
    return this
  }


  // BUTTON DATA-API
  // ===============

  $(document).on('click.bs.button.data-api', '[data-toggle^=button]', function (e) {
    var $btn = $(e.target)
    if (!$btn.hasClass('btn')) $btn = $btn.closest('.btn')
    $btn.button('toggle')
    e.preventDefault()
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: carousel.js v3.0.3
 * http://getbootstrap.com/javascript/#carousel
 * ========================================================================
 * Copyright 2013 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ======================================================================== */


+function ($) { "use strict";

  // CAROUSEL CLASS DEFINITION
  // =========================

  var Carousel = function (element, options) {
    this.$element    = $(element)
    this.$indicators = this.$element.find('.carousel-indicators')
    this.options     = options
    this.paused      =
      this.sliding     =
        this.interval    =
          this.$active     =
            this.$items      = null

    this.options.pause == 'hover' && this.$element
      .on('mouseenter', $.proxy(this.pause, this))
      .on('mouseleave', $.proxy(this.cycle, this))
  }

  Carousel.DEFAULTS = {
    interval: 5000
    , pause: 'hover'
    , wrap: true
  }

  Carousel.prototype.cycle =  function (e) {
    e || (this.paused = false)

    this.interval && clearInterval(this.interval)

    this.options.interval
      && !this.paused
    && (this.interval = setInterval($.proxy(this.next, this), this.options.interval))

    return this
  }

  Carousel.prototype.getActiveIndex = function () {
    this.$active = this.$element.find('.item.active')
    this.$items  = this.$active.parent().children()

    return this.$items.index(this.$active)
  }

  Carousel.prototype.to = function (pos) {
    var that        = this
    var activeIndex = this.getActiveIndex()

    if (pos > (this.$items.length - 1) || pos < 0) return

    if (this.sliding)       return this.$element.one('slid.bs.carousel', function () { that.to(pos) })
    if (activeIndex == pos) return this.pause().cycle()

    return this.slide(pos > activeIndex ? 'next' : 'prev', $(this.$items[pos]))
  }

  Carousel.prototype.pause = function (e) {
    e || (this.paused = true)

    if (this.$element.find('.next, .prev').length && $.support.transition.end) {
      this.$element.trigger($.support.transition.end)
      this.cycle(true)
    }

    this.interval = clearInterval(this.interval)

    return this
  }

  Carousel.prototype.next = function () {
    if (this.sliding) return
    return this.slide('next')
  }

  Carousel.prototype.prev = function () {
    if (this.sliding) return
    return this.slide('prev')
  }

  Carousel.prototype.slide = function (type, next) {
    var $active   = this.$element.find('.item.active')
    var $next     = next || $active[type]()
    var isCycling = this.interval
    var direction = type == 'next' ? 'left' : 'right'
    var fallback  = type == 'next' ? 'first' : 'last'
    var that      = this

    if (!$next.length) {
      if (!this.options.wrap) return
      $next = this.$element.find('.item')[fallback]()
    }

    this.sliding = true

    isCycling && this.pause()

    var e = $.Event('slide.bs.carousel', { relatedTarget: $next[0], direction: direction })

    if ($next.hasClass('active')) return

    if (this.$indicators.length) {
      this.$indicators.find('.active').removeClass('active')
      this.$element.one('slid.bs.carousel', function () {
        var $nextIndicator = $(that.$indicators.children()[that.getActiveIndex()])
        $nextIndicator && $nextIndicator.addClass('active')
      })
    }

    if ($.support.transition && this.$element.hasClass('slide')) {
      this.$element.trigger(e)
      if (e.isDefaultPrevented()) return
      $next.addClass(type)
      $next[0].offsetWidth // force reflow
      $active.addClass(direction)
      $next.addClass(direction)
      $active
        .one($.support.transition.end, function () {
          $next.removeClass([type, direction].join(' ')).addClass('active')
          $active.removeClass(['active', direction].join(' '))
          that.sliding = false
          setTimeout(function () { that.$element.trigger('slid.bs.carousel') }, 0)
        })
        .emulateTransitionEnd(600)
    } else {
      this.$element.trigger(e)
      if (e.isDefaultPrevented()) return
      $active.removeClass('active')
      $next.addClass('active')
      this.sliding = false
      this.$element.trigger('slid.bs.carousel')
    }

    isCycling && this.cycle()

    return this
  }


  // CAROUSEL PLUGIN DEFINITION
  // ==========================

  var old = $.fn.carousel

  $.fn.carousel = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.carousel')
      var options = $.extend({}, Carousel.DEFAULTS, $this.data(), typeof option == 'object' && option)
      var action  = typeof option == 'string' ? option : options.slide

      if (!data) $this.data('bs.carousel', (data = new Carousel(this, options)))
      if (typeof option == 'number') data.to(option)
      else if (action) data[action]()
      else if (options.interval) data.pause().cycle()
    })
  }

  $.fn.carousel.Constructor = Carousel


  // CAROUSEL NO CONFLICT
  // ====================

  $.fn.carousel.noConflict = function () {
    $.fn.carousel = old
    return this
  }


  // CAROUSEL DATA-API
  // =================

  $(document).on('click.bs.carousel.data-api', '[data-slide], [data-slide-to]', function (e) {
    var $this   = $(this), href
    var $target = $($this.attr('data-target') || (href = $this.attr('href')) && href.replace(/.*(?=#[^\s]+$)/, '')) //strip for ie7
    var options = $.extend({}, $target.data(), $this.data())
    var slideIndex = $this.attr('data-slide-to')
    if (slideIndex) options.interval = false

    $target.carousel(options)

    if (slideIndex = $this.attr('data-slide-to')) {
      $target.data('bs.carousel').to(slideIndex)
    }

    e.preventDefault()
  })

  $(window).on('load', function () {
    $('[data-ride="carousel"]').each(function () {
      var $carousel = $(this)
      $carousel.carousel($carousel.data())
    })
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: collapse.js v3.0.3
 * http://getbootstrap.com/javascript/#collapse
 * ========================================================================
 * Copyright 2013 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ======================================================================== */


+function ($) { "use strict";

  // COLLAPSE PUBLIC CLASS DEFINITION
  // ================================

  var Collapse = function (element, options) {
    this.$element      = $(element)
    this.options       = $.extend({}, Collapse.DEFAULTS, options)
    this.transitioning = null

    if (this.options.parent) this.$parent = $(this.options.parent)
    if (this.options.toggle) this.toggle()
  }

  Collapse.DEFAULTS = {
    toggle: true
  }

  Collapse.prototype.dimension = function () {
    var hasWidth = this.$element.hasClass('width')
    return hasWidth ? 'width' : 'height'
  }

  Collapse.prototype.show = function () {
    if (this.transitioning || this.$element.hasClass('in')) return

    var startEvent = $.Event('show.bs.collapse')
    this.$element.trigger(startEvent)
    if (startEvent.isDefaultPrevented()) return

    var actives = this.$parent && this.$parent.find('> .panel > .in')

    if (actives && actives.length) {
      var hasData = actives.data('bs.collapse')
      if (hasData && hasData.transitioning) return
      actives.collapse('hide')
      hasData || actives.data('bs.collapse', null)
    }

    var dimension = this.dimension()

    this.$element
      .removeClass('collapse')
      .addClass('collapsing')
      [dimension](0)

    this.transitioning = 1

    var complete = function () {
      this.$element
        .removeClass('collapsing')
        .addClass('in')
        [dimension]('auto')
      this.transitioning = 0
      this.$element.trigger('shown.bs.collapse')
    }

    if (!$.support.transition) return complete.call(this)

    var scrollSize = $.camelCase(['scroll', dimension].join('-'))

    this.$element
      .one($.support.transition.end, $.proxy(complete, this))
      .emulateTransitionEnd(350)
      [dimension](this.$element[0][scrollSize])
  }

  Collapse.prototype.hide = function () {
    if (this.transitioning || !this.$element.hasClass('in')) return

    var startEvent = $.Event('hide.bs.collapse')
    this.$element.trigger(startEvent)
    if (startEvent.isDefaultPrevented()) return

    var dimension = this.dimension()

    this.$element
      [dimension](this.$element[dimension]())
      [0].offsetHeight

    this.$element
      .addClass('collapsing')
      .removeClass('collapse')
      .removeClass('in')

    this.transitioning = 1

    var complete = function () {
      this.transitioning = 0
      this.$element
        .trigger('hidden.bs.collapse')
        .removeClass('collapsing')
        .addClass('collapse')
    }

    if (!$.support.transition) return complete.call(this)

    this.$element
      [dimension](0)
      .one($.support.transition.end, $.proxy(complete, this))
      .emulateTransitionEnd(350)
  }

  Collapse.prototype.toggle = function () {
    this[this.$element.hasClass('in') ? 'hide' : 'show']()
  }


  // COLLAPSE PLUGIN DEFINITION
  // ==========================

  var old = $.fn.collapse

  $.fn.collapse = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.collapse')
      var options = $.extend({}, Collapse.DEFAULTS, $this.data(), typeof option == 'object' && option)

      if (!data) $this.data('bs.collapse', (data = new Collapse(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.collapse.Constructor = Collapse


  // COLLAPSE NO CONFLICT
  // ====================

  $.fn.collapse.noConflict = function () {
    $.fn.collapse = old
    return this
  }


  // COLLAPSE DATA-API
  // =================

  $(document).on('click.bs.collapse.data-api', '[data-toggle=collapse]', function (e) {
    var $this   = $(this), href
    var target  = $this.attr('data-target')
      || e.preventDefault()
      || (href = $this.attr('href')) && href.replace(/.*(?=#[^\s]+$)/, '') //strip for ie7
    var $target = $(target)
    var data    = $target.data('bs.collapse')
    var option  = data ? 'toggle' : $this.data()
    var parent  = $this.attr('data-parent')
    var $parent = parent && $(parent)

    if (!data || !data.transitioning) {
      if ($parent) $parent.find('[data-toggle=collapse][data-parent="' + parent + '"]').not($this).addClass('collapsed')
      $this[$target.hasClass('in') ? 'addClass' : 'removeClass']('collapsed')
    }

    $target.collapse(option)
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: dropdown.js v3.0.3
 * http://getbootstrap.com/javascript/#dropdowns
 * ========================================================================
 * Copyright 2013 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ======================================================================== */


+function ($) { "use strict";

  // DROPDOWN CLASS DEFINITION
  // =========================

  var backdrop = '.dropdown-backdrop'
  var toggle   = '[data-toggle=dropdown]'
  var Dropdown = function (element) {
    $(element).on('click.bs.dropdown', this.toggle)
  }

  Dropdown.prototype.toggle = function (e) {
    var $this = $(this)

    if ($this.is('.disabled, :disabled')) return

    var $parent  = getParent($this)
    var isActive = $parent.hasClass('open')

    clearMenus()

    if (!isActive) {
      if ('ontouchstart' in document.documentElement && !$parent.closest('.navbar-nav').length) {
        // if mobile we use a backdrop because click events don't delegate
        $('<div class="dropdown-backdrop"/>').insertAfter($(this)).on('click', clearMenus)
      }

      $parent.trigger(e = $.Event('show.bs.dropdown'))

      if (e.isDefaultPrevented()) return

      $parent
        .toggleClass('open')
        .trigger('shown.bs.dropdown')

      $this.focus()
    }

    return false
  }

  Dropdown.prototype.keydown = function (e) {
    if (!/(38|40|27)/.test(e.keyCode)) return

    var $this = $(this)

    e.preventDefault()
    e.stopPropagation()

    if ($this.is('.disabled, :disabled')) return

    var $parent  = getParent($this)
    var isActive = $parent.hasClass('open')

    if (!isActive || (isActive && e.keyCode == 27)) {
      if (e.which == 27) $parent.find(toggle).focus()
      return $this.click()
    }

    var $items = $('[role=menu] li:not(.divider):visible a', $parent)

    if (!$items.length) return

    var index = $items.index($items.filter(':focus'))

    if (e.keyCode == 38 && index > 0)                 index--                        // up
    if (e.keyCode == 40 && index < $items.length - 1) index++                        // down
    if (!~index)                                      index=0

    $items.eq(index).focus()
  }

  function clearMenus() {
    $(backdrop).remove()
    $(toggle).each(function (e) {
      var $parent = getParent($(this))
      if (!$parent.hasClass('open')) return
      $parent.trigger(e = $.Event('hide.bs.dropdown'))
      if (e.isDefaultPrevented()) return
      $parent.removeClass('open').trigger('hidden.bs.dropdown')
    })
  }

  function getParent($this) {
    var selector = $this.attr('data-target')

    if (!selector) {
      selector = $this.attr('href')
      selector = selector && /#/.test(selector) && selector.replace(/.*(?=#[^\s]*$)/, '') //strip for ie7
    }

    var $parent = selector && $(selector)

    return $parent && $parent.length ? $parent : $this.parent()
  }


  // DROPDOWN PLUGIN DEFINITION
  // ==========================

  var old = $.fn.dropdown

  $.fn.dropdown = function (option) {
    return this.each(function () {
      var $this = $(this)
      var data  = $this.data('bs.dropdown')

      if (!data) $this.data('bs.dropdown', (data = new Dropdown(this)))
      if (typeof option == 'string') data[option].call($this)
    })
  }

  $.fn.dropdown.Constructor = Dropdown


  // DROPDOWN NO CONFLICT
  // ====================

  $.fn.dropdown.noConflict = function () {
    $.fn.dropdown = old
    return this
  }


  // APPLY TO STANDARD DROPDOWN ELEMENTS
  // ===================================

  $(document)
    .on('click.bs.dropdown.data-api', clearMenus)
    .on('click.bs.dropdown.data-api', '.dropdown form', function (e) { e.stopPropagation() })
    .on('click.bs.dropdown.data-api'  , toggle, Dropdown.prototype.toggle)
    .on('keydown.bs.dropdown.data-api', toggle + ', [role=menu]' , Dropdown.prototype.keydown)

}(jQuery);

/* ========================================================================
 * Bootstrap: modal.js v3.0.3
 * http://getbootstrap.com/javascript/#modals
 * ========================================================================
 * Copyright 2013 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ======================================================================== */


+function ($) { "use strict";

  // MODAL CLASS DEFINITION
  // ======================

  var Modal = function (element, options) {
    this.options   = options
    this.$element  = $(element)
    this.$backdrop =
      this.isShown   = null

    if (this.options.remote) this.$element.load(this.options.remote)
  }

  Modal.DEFAULTS = {
    backdrop: true
    , keyboard: true
    , show: true
  }

  Modal.prototype.toggle = function (_relatedTarget) {
    return this[!this.isShown ? 'show' : 'hide'](_relatedTarget)
  }

  Modal.prototype.show = function (_relatedTarget) {
    var that = this
    var e    = $.Event('show.bs.modal', { relatedTarget: _relatedTarget })

    this.$element.trigger(e)

    if (this.isShown || e.isDefaultPrevented()) return

    this.isShown = true

    this.escape()

    this.$element.on('click.dismiss.modal', '[data-dismiss="modal"]', $.proxy(this.hide, this))

    this.backdrop(function () {
      var transition = $.support.transition && that.$element.hasClass('fade')

      if (!that.$element.parent().length) {
        that.$element.appendTo(document.body) // don't move modals dom position
      }

      that.$element.show()

      if (transition) {
        that.$element[0].offsetWidth // force reflow
      }

      that.$element
        .addClass('in')
        .attr('aria-hidden', false)

      that.enforceFocus()

      var e = $.Event('shown.bs.modal', { relatedTarget: _relatedTarget })

      transition ?
        that.$element.find('.modal-dialog') // wait for modal to slide in
          .one($.support.transition.end, function () {
            that.$element.focus().trigger(e)
          })
          .emulateTransitionEnd(300) :
        that.$element.focus().trigger(e)
    })
  }

  Modal.prototype.hide = function (e) {
    if (e) e.preventDefault()

    e = $.Event('hide.bs.modal')

    this.$element.trigger(e)

    if (!this.isShown || e.isDefaultPrevented()) return

    this.isShown = false

    this.escape()

    $(document).off('focusin.bs.modal')

    this.$element
      .removeClass('in')
      .attr('aria-hidden', true)
      .off('click.dismiss.modal')

    $.support.transition && this.$element.hasClass('fade') ?
      this.$element
        .one($.support.transition.end, $.proxy(this.hideModal, this))
        .emulateTransitionEnd(300) :
      this.hideModal()
  }

  Modal.prototype.enforceFocus = function () {
    $(document)
      .off('focusin.bs.modal') // guard against infinite focus loop
      .on('focusin.bs.modal', $.proxy(function (e) {
        if (this.$element[0] !== e.target && !this.$element.has(e.target).length) {
          this.$element.focus()
        }
      }, this))
  }

  Modal.prototype.escape = function () {
    if (this.isShown && this.options.keyboard) {
      this.$element.on('keyup.dismiss.bs.modal', $.proxy(function (e) {
        e.which == 27 && this.hide()
      }, this))
    } else if (!this.isShown) {
      this.$element.off('keyup.dismiss.bs.modal')
    }
  }

  Modal.prototype.hideModal = function () {
    var that = this
    this.$element.hide()
    this.backdrop(function () {
      that.removeBackdrop()
      that.$element.trigger('hidden.bs.modal')
    })
  }

  Modal.prototype.removeBackdrop = function () {
    this.$backdrop && this.$backdrop.remove()
    this.$backdrop = null
  }

  Modal.prototype.backdrop = function (callback) {
    var that    = this
    var animate = this.$element.hasClass('fade') ? 'fade' : ''

    if (this.isShown && this.options.backdrop) {
      var doAnimate = $.support.transition && animate

      this.$backdrop = $('<div class="modal-backdrop ' + animate + '" />')
        .appendTo(document.body)

      this.$element.on('click.dismiss.modal', $.proxy(function (e) {
        if (e.target !== e.currentTarget) return
        this.options.backdrop == 'static'
          ? this.$element[0].focus.call(this.$element[0])
          : this.hide.call(this)
      }, this))

      if (doAnimate) this.$backdrop[0].offsetWidth // force reflow

      this.$backdrop.addClass('in')

      if (!callback) return

      doAnimate ?
        this.$backdrop
          .one($.support.transition.end, callback)
          .emulateTransitionEnd(150) :
        callback()

    } else if (!this.isShown && this.$backdrop) {
      this.$backdrop.removeClass('in')

      $.support.transition && this.$element.hasClass('fade')?
        this.$backdrop
          .one($.support.transition.end, callback)
          .emulateTransitionEnd(150) :
        callback()

    } else if (callback) {
      callback()
    }
  }


  // MODAL PLUGIN DEFINITION
  // =======================

  var old = $.fn.modal

  $.fn.modal = function (option, _relatedTarget) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.modal')
      var options = $.extend({}, Modal.DEFAULTS, $this.data(), typeof option == 'object' && option)

      if (!data) $this.data('bs.modal', (data = new Modal(this, options)))
      if (typeof option == 'string') data[option](_relatedTarget)
      else if (options.show) data.show(_relatedTarget)
    })
  }

  $.fn.modal.Constructor = Modal


  // MODAL NO CONFLICT
  // =================

  $.fn.modal.noConflict = function () {
    $.fn.modal = old
    return this
  }


  // MODAL DATA-API
  // ==============

  $(document).on('click.bs.modal.data-api', '[data-toggle="modal"]', function (e) {
    var $this   = $(this)
    var href    = $this.attr('href')
    var $target = $($this.attr('data-target') || (href && href.replace(/.*(?=#[^\s]+$)/, ''))) //strip for ie7
    var option  = $target.data('modal') ? 'toggle' : $.extend({ remote: !/#/.test(href) && href }, $target.data(), $this.data())

    e.preventDefault()

    $target
      .modal(option, this)
      .one('hide', function () {
        $this.is(':visible') && $this.focus()
      })
  })

  $(document)
    .on('show.bs.modal',  '.modal', function () { $(document.body).addClass('modal-open') })
    .on('hidden.bs.modal', '.modal', function () { $(document.body).removeClass('modal-open') })

}(jQuery);

/* ========================================================================
 * Bootstrap: tooltip.js v3.0.3
 * http://getbootstrap.com/javascript/#tooltip
 * Inspired by the original jQuery.tipsy by Jason Frame
 * ========================================================================
 * Copyright 2013 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ======================================================================== */


+function ($) { "use strict";

  // TOOLTIP PUBLIC CLASS DEFINITION
  // ===============================

  var Tooltip = function (element, options) {
    this.type       =
      this.options    =
        this.enabled    =
          this.timeout    =
            this.hoverState =
              this.$element   = null

    this.init('tooltip', element, options)
  }

  Tooltip.DEFAULTS = {
    animation: true
    , placement: 'top'
    , selector: false
    , template: '<div class="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>'
    , trigger: 'hover focus'
    , title: ''
    , delay: 0
    , html: false
    , container: false
  }

  Tooltip.prototype.init = function (type, element, options) {
    this.enabled  = true
    this.type     = type
    this.$element = $(element)
    this.options  = this.getOptions(options)

    var triggers = this.options.trigger.split(' ')

    for (var i = triggers.length; i--;) {
      var trigger = triggers[i]

      if (trigger == 'click') {
        this.$element.on('click.' + this.type, this.options.selector, $.proxy(this.toggle, this))
      } else if (trigger != 'manual') {
        var eventIn  = trigger == 'hover' ? 'mouseenter' : 'focus'
        var eventOut = trigger == 'hover' ? 'mouseleave' : 'blur'

        this.$element.on(eventIn  + '.' + this.type, this.options.selector, $.proxy(this.enter, this))
        this.$element.on(eventOut + '.' + this.type, this.options.selector, $.proxy(this.leave, this))
      }
    }

    this.options.selector ?
      (this._options = $.extend({}, this.options, { trigger: 'manual', selector: '' })) :
      this.fixTitle()
  }

  Tooltip.prototype.getDefaults = function () {
    return Tooltip.DEFAULTS
  }

  Tooltip.prototype.getOptions = function (options) {
    options = $.extend({}, this.getDefaults(), this.$element.data(), options)

    if (options.delay && typeof options.delay == 'number') {
      options.delay = {
        show: options.delay
        , hide: options.delay
      }
    }

    return options
  }

  Tooltip.prototype.getDelegateOptions = function () {
    var options  = {}
    var defaults = this.getDefaults()

    this._options && $.each(this._options, function (key, value) {
      if (defaults[key] != value) options[key] = value
    })

    return options
  }

  Tooltip.prototype.enter = function (obj) {
    var self = obj instanceof this.constructor ?
      obj : $(obj.currentTarget)[this.type](this.getDelegateOptions()).data('bs.' + this.type)

    clearTimeout(self.timeout)

    self.hoverState = 'in'

    if (!self.options.delay || !self.options.delay.show) return self.show()

    self.timeout = setTimeout(function () {
      if (self.hoverState == 'in') self.show()
    }, self.options.delay.show)
  }

  Tooltip.prototype.leave = function (obj) {
    var self = obj instanceof this.constructor ?
      obj : $(obj.currentTarget)[this.type](this.getDelegateOptions()).data('bs.' + this.type)

    clearTimeout(self.timeout)

    self.hoverState = 'out'

    if (!self.options.delay || !self.options.delay.hide) return self.hide()

    self.timeout = setTimeout(function () {
      if (self.hoverState == 'out') self.hide()
    }, self.options.delay.hide)
  }

  Tooltip.prototype.show = function () {
    var e = $.Event('show.bs.'+ this.type)

    if (this.hasContent() && this.enabled) {
      this.$element.trigger(e)

      if (e.isDefaultPrevented()) return

      var $tip = this.tip()

      this.setContent()

      if (this.options.animation) $tip.addClass('fade')

      var placement = typeof this.options.placement == 'function' ?
        this.options.placement.call(this, $tip[0], this.$element[0]) :
        this.options.placement

      var autoToken = /\s?auto?\s?/i
      var autoPlace = autoToken.test(placement)
      if (autoPlace) placement = placement.replace(autoToken, '') || 'top'

      $tip
        .detach()
        .css({ top: 0, left: 0, display: 'block' })
        .addClass(placement)

      this.options.container ? $tip.appendTo(this.options.container) : $tip.insertAfter(this.$element)

      var pos          = this.getPosition()
      var actualWidth  = $tip[0].offsetWidth
      var actualHeight = $tip[0].offsetHeight

      if (autoPlace) {
        var $parent = this.$element.parent()

        var orgPlacement = placement
        var docScroll    = document.documentElement.scrollTop || document.body.scrollTop
        var parentWidth  = this.options.container == 'body' ? window.innerWidth  : $parent.outerWidth()
        var parentHeight = this.options.container == 'body' ? window.innerHeight : $parent.outerHeight()
        var parentLeft   = this.options.container == 'body' ? 0 : $parent.offset().left

        placement = placement == 'bottom' && pos.top   + pos.height  + actualHeight - docScroll > parentHeight  ? 'top'    :
          placement == 'top'    && pos.top   - docScroll   - actualHeight < 0                         ? 'bottom' :
            placement == 'right'  && pos.right + actualWidth > parentWidth                              ? 'left'   :
              placement == 'left'   && pos.left  - actualWidth < parentLeft                               ? 'right'  :
                placement

        $tip
          .removeClass(orgPlacement)
          .addClass(placement)
      }

      var calculatedOffset = this.getCalculatedOffset(placement, pos, actualWidth, actualHeight)

      this.applyPlacement(calculatedOffset, placement)
      this.$element.trigger('shown.bs.' + this.type)
    }
  }

  Tooltip.prototype.applyPlacement = function(offset, placement) {
    var replace
    var $tip   = this.tip()
    var width  = $tip[0].offsetWidth
    var height = $tip[0].offsetHeight

    // manually read margins because getBoundingClientRect includes difference
    var marginTop = parseInt($tip.css('margin-top'), 10)
    var marginLeft = parseInt($tip.css('margin-left'), 10)

    // we must check for NaN for ie 8/9
    if (isNaN(marginTop))  marginTop  = 0
    if (isNaN(marginLeft)) marginLeft = 0

    offset.top  = offset.top  + marginTop
    offset.left = offset.left + marginLeft

    $tip
      .offset(offset)
      .addClass('in')

    // check to see if placing tip in new offset caused the tip to resize itself
    var actualWidth  = $tip[0].offsetWidth
    var actualHeight = $tip[0].offsetHeight

    if (placement == 'top' && actualHeight != height) {
      replace = true
      offset.top = offset.top + height - actualHeight
    }

    if (/bottom|top/.test(placement)) {
      var delta = 0

      if (offset.left < 0) {
        delta       = offset.left * -2
        offset.left = 0

        $tip.offset(offset)

        actualWidth  = $tip[0].offsetWidth
        actualHeight = $tip[0].offsetHeight
      }

      this.replaceArrow(delta - width + actualWidth, actualWidth, 'left')
    } else {
      this.replaceArrow(actualHeight - height, actualHeight, 'top')
    }

    if (replace) $tip.offset(offset)
  }

  Tooltip.prototype.replaceArrow = function(delta, dimension, position) {
    this.arrow().css(position, delta ? (50 * (1 - delta / dimension) + "%") : '')
  }

  Tooltip.prototype.setContent = function () {
    var $tip  = this.tip()
    var title = this.getTitle()

    $tip.find('.tooltip-inner')[this.options.html ? 'html' : 'text'](title)
    $tip.removeClass('fade in top bottom left right')
  }

  Tooltip.prototype.hide = function () {
    var that = this
    var $tip = this.tip()
    var e    = $.Event('hide.bs.' + this.type)

    function complete() {
      if (that.hoverState != 'in') $tip.detach()
    }

    this.$element.trigger(e)

    if (e.isDefaultPrevented()) return

    $tip.removeClass('in')

    $.support.transition && this.$tip.hasClass('fade') ?
      $tip
        .one($.support.transition.end, complete)
        .emulateTransitionEnd(150) :
      complete()

    this.$element.trigger('hidden.bs.' + this.type)

    return this
  }

  Tooltip.prototype.fixTitle = function () {
    var $e = this.$element
    if ($e.attr('title') || typeof($e.attr('data-original-title')) != 'string') {
      $e.attr('data-original-title', $e.attr('title') || '').attr('title', '')
    }
  }

  Tooltip.prototype.hasContent = function () {
    return this.getTitle()
  }

  Tooltip.prototype.getPosition = function () {
    var el = this.$element[0]
    return $.extend({}, (typeof el.getBoundingClientRect == 'function') ? el.getBoundingClientRect() : {
      width: el.offsetWidth
      , height: el.offsetHeight
    }, this.$element.offset())
  }

  Tooltip.prototype.getCalculatedOffset = function (placement, pos, actualWidth, actualHeight) {
    return placement == 'bottom' ? { top: pos.top + pos.height,   left: pos.left + pos.width / 2 - actualWidth / 2  } :
      placement == 'top'    ? { top: pos.top - actualHeight, left: pos.left + pos.width / 2 - actualWidth / 2  } :
        placement == 'left'   ? { top: pos.top + pos.height / 2 - actualHeight / 2, left: pos.left - actualWidth } :
          /* placement == 'right' */ { top: pos.top + pos.height / 2 - actualHeight / 2, left: pos.left + pos.width   }
  }

  Tooltip.prototype.getTitle = function () {
    var title
    var $e = this.$element
    var o  = this.options

    title = $e.attr('data-original-title')
      || (typeof o.title == 'function' ? o.title.call($e[0]) :  o.title)

    return title
  }

  Tooltip.prototype.tip = function () {
    return this.$tip = this.$tip || $(this.options.template)
  }

  Tooltip.prototype.arrow = function () {
    return this.$arrow = this.$arrow || this.tip().find('.tooltip-arrow')
  }

  Tooltip.prototype.validate = function () {
    if (!this.$element[0].parentNode) {
      this.hide()
      this.$element = null
      this.options  = null
    }
  }

  Tooltip.prototype.enable = function () {
    this.enabled = true
  }

  Tooltip.prototype.disable = function () {
    this.enabled = false
  }

  Tooltip.prototype.toggleEnabled = function () {
    this.enabled = !this.enabled
  }

  Tooltip.prototype.toggle = function (e) {
    var self = e ? $(e.currentTarget)[this.type](this.getDelegateOptions()).data('bs.' + this.type) : this
    self.tip().hasClass('in') ? self.leave(self) : self.enter(self)
  }

  Tooltip.prototype.destroy = function () {
    this.hide().$element.off('.' + this.type).removeData('bs.' + this.type)
  }


  // TOOLTIP PLUGIN DEFINITION
  // =========================

  var old = $.fn.tooltip

  $.fn.tooltip = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.tooltip')
      var options = typeof option == 'object' && option

      if (!data) $this.data('bs.tooltip', (data = new Tooltip(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.tooltip.Constructor = Tooltip


  // TOOLTIP NO CONFLICT
  // ===================

  $.fn.tooltip.noConflict = function () {
    $.fn.tooltip = old
    return this
  }

}(jQuery);

/* ========================================================================
 * Bootstrap: popover.js v3.0.3
 * http://getbootstrap.com/javascript/#popovers
 * ========================================================================
 * Copyright 2013 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ======================================================================== */


+function ($) { "use strict";

  // POPOVER PUBLIC CLASS DEFINITION
  // ===============================

  var Popover = function (element, options) {
    this.init('popover', element, options)
  }

  if (!$.fn.tooltip) throw new Error('Popover requires tooltip.js')

  Popover.DEFAULTS = $.extend({} , $.fn.tooltip.Constructor.DEFAULTS, {
    placement: 'right'
    , trigger: 'click'
    , content: ''
    , template: '<div class="popover"><div class="arrow"></div><h3 class="popover-title"></h3><div class="popover-content"></div></div>'
  })


  // NOTE: POPOVER EXTENDS tooltip.js
  // ================================

  Popover.prototype = $.extend({}, $.fn.tooltip.Constructor.prototype)

  Popover.prototype.constructor = Popover

  Popover.prototype.getDefaults = function () {
    return Popover.DEFAULTS
  }

  Popover.prototype.setContent = function () {
    var $tip    = this.tip()
    var title   = this.getTitle()
    var content = this.getContent()

    $tip.find('.popover-title')[this.options.html ? 'html' : 'text'](title)
    $tip.find('.popover-content')[this.options.html ? 'html' : 'text'](content)

    $tip.removeClass('fade top bottom left right in')

    // IE8 doesn't accept hiding via the `:empty` pseudo selector, we have to do
    // this manually by checking the contents.
    if (!$tip.find('.popover-title').html()) $tip.find('.popover-title').hide()
  }

  Popover.prototype.hasContent = function () {
    return this.getTitle() || this.getContent()
  }

  Popover.prototype.getContent = function () {
    var $e = this.$element
    var o  = this.options

    return $e.attr('data-content')
      || (typeof o.content == 'function' ?
      o.content.call($e[0]) :
      o.content)
  }

  Popover.prototype.arrow = function () {
    return this.$arrow = this.$arrow || this.tip().find('.arrow')
  }

  Popover.prototype.tip = function () {
    if (!this.$tip) this.$tip = $(this.options.template)
    return this.$tip
  }


  // POPOVER PLUGIN DEFINITION
  // =========================

  var old = $.fn.popover

  $.fn.popover = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.popover')
      var options = typeof option == 'object' && option

      if (!data) $this.data('bs.popover', (data = new Popover(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.popover.Constructor = Popover


  // POPOVER NO CONFLICT
  // ===================

  $.fn.popover.noConflict = function () {
    $.fn.popover = old
    return this
  }

}(jQuery);

/* ========================================================================
 * Bootstrap: scrollspy.js v3.0.3
 * http://getbootstrap.com/javascript/#scrollspy
 * ========================================================================
 * Copyright 2013 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ======================================================================== */


+function ($) { "use strict";

  // SCROLLSPY CLASS DEFINITION
  // ==========================

  function ScrollSpy(element, options) {
    var href
    var process  = $.proxy(this.process, this)

    this.$element       = $(element).is('body') ? $(window) : $(element)
    this.$body          = $('body')
    this.$scrollElement = this.$element.on('scroll.bs.scroll-spy.data-api', process)
    this.options        = $.extend({}, ScrollSpy.DEFAULTS, options)
    this.selector       = (this.options.target
      || ((href = $(element).attr('href')) && href.replace(/.*(?=#[^\s]+$)/, '')) //strip for ie7
      || '') + ' .nav li > a'
    this.offsets        = $([])
    this.targets        = $([])
    this.activeTarget   = null

    this.refresh()
    this.process()
  }

  ScrollSpy.DEFAULTS = {
    offset: 10
  }

  ScrollSpy.prototype.refresh = function () {
    var offsetMethod = this.$element[0] == window ? 'offset' : 'position'

    this.offsets = $([])
    this.targets = $([])

    var self     = this
    var $targets = this.$body
      .find(this.selector)
      .map(function () {
        var $el   = $(this)
        var href  = $el.data('target') || $el.attr('href')
        var $href = /^#\w/.test(href) && $(href)

        return ($href
          && $href.length
          && [[ $href[offsetMethod]().top + (!$.isWindow(self.$scrollElement.get(0)) && self.$scrollElement.scrollTop()), href ]]) || null
      })
      .sort(function (a, b) { return a[0] - b[0] })
      .each(function () {
        self.offsets.push(this[0])
        self.targets.push(this[1])
      })
  }

  ScrollSpy.prototype.process = function () {
    var scrollTop    = this.$scrollElement.scrollTop() + this.options.offset
    var scrollHeight = this.$scrollElement[0].scrollHeight || this.$body[0].scrollHeight
    var maxScroll    = scrollHeight - this.$scrollElement.height()
    var offsets      = this.offsets
    var targets      = this.targets
    var activeTarget = this.activeTarget
    var i

    if (scrollTop >= maxScroll) {
      return activeTarget != (i = targets.last()[0]) && this.activate(i)
    }

    for (i = offsets.length; i--;) {
      activeTarget != targets[i]
        && scrollTop >= offsets[i]
        && (!offsets[i + 1] || scrollTop <= offsets[i + 1])
      && this.activate( targets[i] )
    }
  }

  ScrollSpy.prototype.activate = function (target) {
    this.activeTarget = target

    $(this.selector)
      .parents('.active')
      .removeClass('active')

    var selector = this.selector
      + '[data-target="' + target + '"],'
      + this.selector + '[href="' + target + '"]'

    var active = $(selector)
      .parents('li')
      .addClass('active')

    if (active.parent('.dropdown-menu').length)  {
      active = active
        .closest('li.dropdown')
        .addClass('active')
    }

    active.trigger('activate.bs.scrollspy')
  }


  // SCROLLSPY PLUGIN DEFINITION
  // ===========================

  var old = $.fn.scrollspy

  $.fn.scrollspy = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.scrollspy')
      var options = typeof option == 'object' && option

      if (!data) $this.data('bs.scrollspy', (data = new ScrollSpy(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.scrollspy.Constructor = ScrollSpy


  // SCROLLSPY NO CONFLICT
  // =====================

  $.fn.scrollspy.noConflict = function () {
    $.fn.scrollspy = old
    return this
  }


  // SCROLLSPY DATA-API
  // ==================

  $(window).on('load', function () {
    $('[data-spy="scroll"]').each(function () {
      var $spy = $(this)
      $spy.scrollspy($spy.data())
    })
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: tab.js v3.0.3
 * http://getbootstrap.com/javascript/#tabs
 * ========================================================================
 * Copyright 2013 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ======================================================================== */


+function ($) { "use strict";

  // TAB CLASS DEFINITION
  // ====================

  var Tab = function (element) {
    this.element = $(element)
  }

  Tab.prototype.show = function () {
    var $this    = this.element
    var $ul      = $this.closest('ul:not(.dropdown-menu)')
    var selector = $this.data('target')

    if (!selector) {
      selector = $this.attr('href')
      selector = selector && selector.replace(/.*(?=#[^\s]*$)/, '') //strip for ie7
    }

    if ($this.parent('li').hasClass('active')) return

    var previous = $ul.find('.active:last a')[0]
    var e        = $.Event('show.bs.tab', {
      relatedTarget: previous
    })

    $this.trigger(e)

    if (e.isDefaultPrevented()) return

    var $target = $(selector)

    this.activate($this.parent('li'), $ul)
    this.activate($target, $target.parent(), function () {
      $this.trigger({
        type: 'shown.bs.tab'
        , relatedTarget: previous
      })
    })
  }

  Tab.prototype.activate = function (element, container, callback) {
    var $active    = container.find('> .active')
    var transition = callback
      && $.support.transition
      && $active.hasClass('fade')

    function next() {
      $active
        .removeClass('active')
        .find('> .dropdown-menu > .active')
        .removeClass('active')

      element.addClass('active')

      if (transition) {
        element[0].offsetWidth // reflow for transition
        element.addClass('in')
      } else {
        element.removeClass('fade')
      }

      if (element.parent('.dropdown-menu')) {
        element.closest('li.dropdown').addClass('active')
      }

      callback && callback()
    }

    transition ?
      $active
        .one($.support.transition.end, next)
        .emulateTransitionEnd(150) :
      next()

    $active.removeClass('in')
  }


  // TAB PLUGIN DEFINITION
  // =====================

  var old = $.fn.tab

  $.fn.tab = function ( option ) {
    return this.each(function () {
      var $this = $(this)
      var data  = $this.data('bs.tab')

      if (!data) $this.data('bs.tab', (data = new Tab(this)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.tab.Constructor = Tab


  // TAB NO CONFLICT
  // ===============

  $.fn.tab.noConflict = function () {
    $.fn.tab = old
    return this
  }


  // TAB DATA-API
  // ============

  $(document).on('click.bs.tab.data-api', '[data-toggle="tab"], [data-toggle="pill"]', function (e) {
    e.preventDefault()
    $(this).tab('show')
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: affix.js v3.0.3
 * http://getbootstrap.com/javascript/#affix
 * ========================================================================
 * Copyright 2013 Twitter, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ======================================================================== */


+function ($) { "use strict";

  // AFFIX CLASS DEFINITION
  // ======================

  var Affix = function (element, options) {
    this.options = $.extend({}, Affix.DEFAULTS, options)
    this.$window = $(window)
      .on('scroll.bs.affix.data-api', $.proxy(this.checkPosition, this))
      .on('click.bs.affix.data-api',  $.proxy(this.checkPositionWithEventLoop, this))

    this.$element = $(element)
    this.affixed  =
      this.unpin    = null

    this.checkPosition()
  }

  Affix.RESET = 'affix affix-top affix-bottom'

  Affix.DEFAULTS = {
    offset: 0
  }

  Affix.prototype.checkPositionWithEventLoop = function () {
    setTimeout($.proxy(this.checkPosition, this), 1)
  }

  Affix.prototype.checkPosition = function () {
    if (!this.$element.is(':visible')) return

    var scrollHeight = $(document).height()
    var scrollTop    = this.$window.scrollTop()
    var position     = this.$element.offset()
    var offset       = this.options.offset
    var offsetTop    = offset.top
    var offsetBottom = offset.bottom

    if (typeof offset != 'object')         offsetBottom = offsetTop = offset
    if (typeof offsetTop == 'function')    offsetTop    = offset.top()
    if (typeof offsetBottom == 'function') offsetBottom = offset.bottom()

    var affix = this.unpin   != null && (scrollTop + this.unpin <= position.top) ? false :
      offsetBottom != null && (position.top + this.$element.height() >= scrollHeight - offsetBottom) ? 'bottom' :
        offsetTop    != null && (scrollTop <= offsetTop) ? 'top' : false

    if (this.affixed === affix) return
    if (this.unpin) this.$element.css('top', '')

    this.affixed = affix
    this.unpin   = affix == 'bottom' ? position.top - scrollTop : null

    this.$element.removeClass(Affix.RESET).addClass('affix' + (affix ? '-' + affix : ''))

    if (affix == 'bottom') {
      this.$element.offset({ top: document.body.offsetHeight - offsetBottom - this.$element.height() })
    }
  }


  // AFFIX PLUGIN DEFINITION
  // =======================

  var old = $.fn.affix

  $.fn.affix = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.affix')
      var options = typeof option == 'object' && option

      if (!data) $this.data('bs.affix', (data = new Affix(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.affix.Constructor = Affix


  // AFFIX NO CONFLICT
  // =================

  $.fn.affix.noConflict = function () {
    $.fn.affix = old
    return this
  }


  // AFFIX DATA-API
  // ==============

  $(window).on('load', function () {
    $('[data-spy="affix"]').each(function () {
      var $spy = $(this)
      var data = $spy.data()

      data.offset = data.offset || {}

      if (data.offsetBottom) data.offset.bottom = data.offsetBottom
      if (data.offsetTop)    data.offset.top    = data.offsetTop

      $spy.affix(data)
    })
  })

}(jQuery);


//     Underscore.js 1.5.2
//     http://underscorejs.org
//     (c) 2009-2013 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.

(function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `exports` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Establish the object that gets returned to break out of a loop iteration.
  var breaker = {};

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  //use the faster Date.now if available.
  var getTime = (Date.now || function() {
    return new Date().getTime();
  });

  // Create quick reference variables for speed access to core prototypes.
  var
    push             = ArrayProto.push,
    slice            = ArrayProto.slice,
    concat           = ArrayProto.concat,
    toString         = ObjProto.toString,
    hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeForEach      = ArrayProto.forEach,
    nativeMap          = ArrayProto.map,
    nativeReduce       = ArrayProto.reduce,
    nativeReduceRight  = ArrayProto.reduceRight,
    nativeFilter       = ArrayProto.filter,
    nativeEvery        = ArrayProto.every,
    nativeSome         = ArrayProto.some,
    nativeIndexOf      = ArrayProto.indexOf,
    nativeLastIndexOf  = ArrayProto.lastIndexOf,
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind;

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) {
    if (obj instanceof _) return obj;
    if (!(this instanceof _)) return new _(obj);
    this._wrapped = obj;
  };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object via a string identifier,
  // for Closure Compiler "advanced" mode.
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {
    root._ = _;
  }

  // Current version.
  _.VERSION = '1.5.2';

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles objects with the built-in `forEach`, arrays, and raw objects.
  // Delegates to **ECMAScript 5**'s native `forEach` if available.
  var each = _.each = _.forEach = function(obj, iterator, context) {
    if (obj == null) return;
    if (nativeForEach && obj.forEach === nativeForEach) {
      obj.forEach(iterator, context);
    } else if (obj.length === +obj.length) {
      for (var i = 0, length = obj.length; i < length; i++) {
        if (iterator.call(context, obj[i], i, obj) === breaker) return;
      }
    } else {
      var keys = _.keys(obj);
      for (var i = 0, length = keys.length; i < length; i++) {
        if (iterator.call(context, obj[keys[i]], keys[i], obj) === breaker) return;
      }
    }
  };

  // Return the results of applying the iterator to each element.
  // Delegates to **ECMAScript 5**'s native `map` if available.
  _.map = _.collect = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeMap && obj.map === nativeMap) return obj.map(iterator, context);
    each(obj, function(value, index, list) {
      results.push(iterator.call(context, value, index, list));
    });
    return results;
  };

  var reduceError = 'Reduce of empty array with no initial value';

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`. Delegates to **ECMAScript 5**'s native `reduce` if available.
  _.reduce = _.foldl = _.inject = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduce && obj.reduce === nativeReduce) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduce(iterator, memo) : obj.reduce(iterator);
    }
    each(obj, function(value, index, list) {
      if (!initial) {
        memo = value;
        initial = true;
      } else {
        memo = iterator.call(context, memo, value, index, list);
      }
    });
    if (!initial) throw new TypeError(reduceError);
    return memo;
  };

  // The right-associative version of reduce, also known as `foldr`.
  // Delegates to **ECMAScript 5**'s native `reduceRight` if available.
  _.reduceRight = _.foldr = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduceRight && obj.reduceRight === nativeReduceRight) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduceRight(iterator, memo) : obj.reduceRight(iterator);
    }
    var length = obj.length;
    if (length !== +length) {
      var keys = _.keys(obj);
      length = keys.length;
    }
    each(obj, function(value, index, list) {
      index = keys ? keys[--length] : --length;
      if (!initial) {
        memo = obj[index];
        initial = true;
      } else {
        memo = iterator.call(context, memo, obj[index], index, list);
      }
    });
    if (!initial) throw new TypeError(reduceError);
    return memo;
  };

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, iterator, context) {
    var result;
    any(obj, function(value, index, list) {
      if (iterator.call(context, value, index, list)) {
        result = value;
        return true;
      }
    });
    return result;
  };

  // Return all the elements that pass a truth test.
  // Delegates to **ECMAScript 5**'s native `filter` if available.
  // Aliased as `select`.
  _.filter = _.select = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeFilter && obj.filter === nativeFilter) return obj.filter(iterator, context);
    each(obj, function(value, index, list) {
      if (iterator.call(context, value, index, list)) results.push(value);
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, iterator, context) {
    return _.filter(obj, function(value, index, list) {
      return !iterator.call(context, value, index, list);
    }, context);
  };

  // Determine whether all of the elements match a truth test.
  // Delegates to **ECMAScript 5**'s native `every` if available.
  // Aliased as `all`.
  _.every = _.all = function(obj, iterator, context) {
    iterator || (iterator = _.identity);
    var result = true;
    if (obj == null) return result;
    if (nativeEvery && obj.every === nativeEvery) return obj.every(iterator, context);
    each(obj, function(value, index, list) {
      if (!(result = result && iterator.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if at least one element in the object matches a truth test.
  // Delegates to **ECMAScript 5**'s native `some` if available.
  // Aliased as `any`.
  var any = _.some = _.any = function(obj, iterator, context) {
    iterator || (iterator = _.identity);
    var result = false;
    if (obj == null) return result;
    if (nativeSome && obj.some === nativeSome) return obj.some(iterator, context);
    each(obj, function(value, index, list) {
      if (result || (result = iterator.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if the array or object contains a given value (using `===`).
  // Aliased as `include`.
  _.contains = _.include = function(obj, target) {
    if (obj == null) return false;
    if (nativeIndexOf && obj.indexOf === nativeIndexOf) return obj.indexOf(target) != -1;
    return any(obj, function(value) {
      return value === target;
    });
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    var isFunc = _.isFunction(method);
    return _.map(obj, function(value) {
      return (isFunc ? method : value[method]).apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, _.property(key));
  };

  // Convenience version of a common use case of `filter`: selecting only objects
  // containing specific `key:value` pairs.
  _.where = function(obj, attrs, first) {
    if (_.isEmpty(attrs)) return first ? void 0 : [];
    return _[first ? 'find' : 'filter'](obj, function(value) {
      for (var key in attrs) {
        if (attrs[key] !== value[key]) return false;
      }
      return true;
    });
  };

  // Convenience version of a common use case of `find`: getting the first object
  // containing specific `key:value` pairs.
  _.findWhere = function(obj, attrs) {
    return _.where(obj, attrs, true);
  };

  // Return the maximum element or (element-based computation).
  // Can't optimize arrays of integers longer than 65,535 elements.
  // See [WebKit Bug 80797](https://bugs.webkit.org/show_bug.cgi?id=80797)
  _.max = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0] && obj.length < 65535) {
      return Math.max.apply(Math, obj);
    }
    if (!iterator && _.isEmpty(obj)) return -Infinity;
    var result = {computed : -Infinity, value: -Infinity};
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      computed > result.computed && (result = {value : value, computed : computed});
    });
    return result.value;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0] && obj.length < 65535) {
      return Math.min.apply(Math, obj);
    }
    if (!iterator && _.isEmpty(obj)) return Infinity;
    var result = {computed : Infinity, value: Infinity};
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      computed < result.computed && (result = {value : value, computed : computed});
    });
    return result.value;
  };

  // Shuffle an array, using the modern version of the
  // [Fisher-Yates shuffle](http://en.wikipedia.org/wiki/Fisher–Yates_shuffle).
  _.shuffle = function(obj) {
    var rand;
    var index = 0;
    var shuffled = [];
    each(obj, function(value) {
      rand = _.random(index++);
      shuffled[index - 1] = shuffled[rand];
      shuffled[rand] = value;
    });
    return shuffled;
  };

  // Sample **n** random values from a collection.
  // If **n** is not specified, returns a single random element.
  // The internal `guard` argument allows it to work with `map`.
  _.sample = function(obj, n, guard) {
    if (n == null || guard) {
      if (obj.length !== +obj.length) obj = _.values(obj);
      return obj[_.random(obj.length - 1)];
    }
    return _.shuffle(obj).slice(0, Math.max(0, n));
  };

  // An internal function to generate lookup iterators.
  var lookupIterator = function(value) {
    if (value == null) return _.identity;
    if (_.isFunction(value)) return value;
    return _.property(value);
  };

  // Sort the object's values by a criterion produced by an iterator.
  _.sortBy = function(obj, iterator, context) {
    iterator = lookupIterator(iterator);
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value: value,
        index: index,
        criteria: iterator.call(context, value, index, list)
      };
    }).sort(function(left, right) {
        var a = left.criteria;
        var b = right.criteria;
        if (a !== b) {
          if (a > b || a === void 0) return 1;
          if (a < b || b === void 0) return -1;
        }
        return left.index - right.index;
      }), 'value');
  };

  // An internal function used for aggregate "group by" operations.
  var group = function(behavior) {
    return function(obj, iterator, context) {
      var result = {};
      iterator = lookupIterator(iterator);
      each(obj, function(value, index) {
        var key = iterator.call(context, value, index, obj);
        behavior(result, key, value);
      });
      return result;
    };
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = group(function(result, key, value) {
    (_.has(result, key) ? result[key] : (result[key] = [])).push(value);
  });

  // Indexes the object's values by a criterion, similar to `groupBy`, but for
  // when you know that your index values will be unique.
  _.indexBy = group(function(result, key, value) {
    result[key] = value;
  });

  // Counts instances of an object that group by a certain criterion. Pass
  // either a string attribute to count by, or a function that returns the
  // criterion.
  _.countBy = group(function(result, key) {
    _.has(result, key) ? result[key]++ : result[key] = 1;
  });

  // Use a comparator function to figure out the smallest index at which
  // an object should be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iterator, context) {
    iterator = lookupIterator(iterator);
    var value = iterator.call(context, obj);
    var low = 0, high = array.length;
    while (low < high) {
      var mid = (low + high) >>> 1;
      iterator.call(context, array[mid]) < value ? low = mid + 1 : high = mid;
    }
    return low;
  };

  // Safely create a real, live array from anything iterable.
  _.toArray = function(obj) {
    if (!obj) return [];
    if (_.isArray(obj)) return slice.call(obj);
    if (obj.length === +obj.length) return _.map(obj, _.identity);
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    if (obj == null) return 0;
    return (obj.length === +obj.length) ? obj.length : _.keys(obj).length;
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    if (array == null) return void 0;
    if ((n == null) || guard) return array[0];
    if (n < 0) return [];
    return slice.call(array, 0, n);
  };

  // Returns everything but the last entry of the array. Especially useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N. The **guard** check allows it to work with
  // `_.map`.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, array.length - ((n == null) || guard ? 1 : n));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array. The **guard** check allows it to work with `_.map`.
  _.last = function(array, n, guard) {
    if (array == null) return void 0;
    if ((n == null) || guard) return array[array.length - 1];
    return slice.call(array, Math.max(array.length - n, 0));
  };

  // Returns everything but the first entry of the array. Aliased as `tail` and `drop`.
  // Especially useful on the arguments object. Passing an **n** will return
  // the rest N values in the array. The **guard**
  // check allows it to work with `_.map`.
  _.rest = _.tail = _.drop = function(array, n, guard) {
    return slice.call(array, (n == null) || guard ? 1 : n);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, _.identity);
  };

  // Internal implementation of a recursive `flatten` function.
  var flatten = function(input, shallow, output) {
    if (shallow && _.every(input, _.isArray)) {
      return concat.apply(output, input);
    }
    each(input, function(value) {
      if (_.isArray(value) || _.isArguments(value)) {
        shallow ? push.apply(output, value) : flatten(value, shallow, output);
      } else {
        output.push(value);
      }
    });
    return output;
  };

  // Flatten out an array, either recursively (by default), or just one level.
  _.flatten = function(array, shallow) {
    return flatten(array, shallow, []);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iterator, context) {
    if (_.isFunction(isSorted)) {
      context = iterator;
      iterator = isSorted;
      isSorted = false;
    }
    var initial = iterator ? _.map(array, iterator, context) : array;
    var results = [];
    var seen = [];
    each(initial, function(value, index) {
      if (isSorted ? (!index || seen[seen.length - 1] !== value) : !_.contains(seen, value)) {
        seen.push(value);
        results.push(array[index]);
      }
    });
    return results;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(_.flatten(arguments, true));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays.
  _.intersection = function(array) {
    var rest = slice.call(arguments, 1);
    return _.filter(_.uniq(array), function(item) {
      return _.every(rest, function(other) {
        return _.indexOf(other, item) >= 0;
      });
    });
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = concat.apply(ArrayProto, slice.call(arguments, 1));
    return _.filter(array, function(value){ return !_.contains(rest, value); });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function() {
    var length = _.max(_.pluck(arguments, "length").concat(0));
    var results = new Array(length);
    for (var i = 0; i < length; i++) {
      results[i] = _.pluck(arguments, '' + i);
    }
    return results;
  };

  // Converts lists into objects. Pass either a single array of `[key, value]`
  // pairs, or two parallel arrays of the same length -- one of keys, and one of
  // the corresponding values.
  _.object = function(list, values) {
    if (list == null) return {};
    var result = {};
    for (var i = 0, length = list.length; i < length; i++) {
      if (values) {
        result[list[i]] = values[i];
      } else {
        result[list[i][0]] = list[i][1];
      }
    }
    return result;
  };

  // If the browser doesn't supply us with indexOf (I'm looking at you, **MSIE**),
  // we need this function. Return the position of the first occurrence of an
  // item in an array, or -1 if the item is not included in the array.
  // Delegates to **ECMAScript 5**'s native `indexOf` if available.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = function(array, item, isSorted) {
    if (array == null) return -1;
    var i = 0, length = array.length;
    if (isSorted) {
      if (typeof isSorted == 'number') {
        i = (isSorted < 0 ? Math.max(0, length + isSorted) : isSorted);
      } else {
        i = _.sortedIndex(array, item);
        return array[i] === item ? i : -1;
      }
    }
    if (nativeIndexOf && array.indexOf === nativeIndexOf) return array.indexOf(item, isSorted);
    for (; i < length; i++) if (array[i] === item) return i;
    return -1;
  };

  // Delegates to **ECMAScript 5**'s native `lastIndexOf` if available.
  _.lastIndexOf = function(array, item, from) {
    if (array == null) return -1;
    var hasIndex = from != null;
    if (nativeLastIndexOf && array.lastIndexOf === nativeLastIndexOf) {
      return hasIndex ? array.lastIndexOf(item, from) : array.lastIndexOf(item);
    }
    var i = (hasIndex ? from : array.length);
    while (i--) if (array[i] === item) return i;
    return -1;
  };

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (arguments.length <= 1) {
      stop = start || 0;
      start = 0;
    }
    step = arguments[2] || 1;

    var length = Math.max(Math.ceil((stop - start) / step), 0);
    var idx = 0;
    var range = new Array(length);

    while(idx < length) {
      range[idx++] = start;
      start += step;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Reusable constructor function for prototype setting.
  var ctor = function(){};

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Delegates to **ECMAScript 5**'s native `Function.bind` if
  // available.
  _.bind = function(func, context) {
    var args, bound;
    if (nativeBind && func.bind === nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError;
    args = slice.call(arguments, 2);
    return bound = function() {
      if (!(this instanceof bound)) return func.apply(context, args.concat(slice.call(arguments)));
      ctor.prototype = func.prototype;
      var self = new ctor;
      ctor.prototype = null;
      var result = func.apply(self, args.concat(slice.call(arguments)));
      if (Object(result) === result) return result;
      return self;
    };
  };

  // Partially apply a function by creating a version that has had some of its
  // arguments pre-filled, without changing its dynamic `this` context.
  _.partial = function(func) {
    var args = slice.call(arguments, 1);
    return function() {
      return func.apply(this, args.concat(slice.call(arguments)));
    };
  };

  // Bind a number of an object's methods to that object. Remaining arguments
  // are the method names to be bound. Useful for ensuring that all callbacks
  // defined on an object belong to it.
  _.bindAll = function(obj) {
    var funcs = slice.call(arguments, 1);
    if (funcs.length === 0) throw new Error("bindAll must be passed function names");
    each(funcs, function(f) { obj[f] = _.bind(obj[f], obj); });
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memo = {};
    hasher || (hasher = _.identity);
    return function() {
      var key = hasher.apply(this, arguments);
      return _.has(memo, key) ? memo[key] : (memo[key] = func.apply(this, arguments));
    };
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){ return func.apply(null, args); }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = function(func) {
    return _.delay.apply(_, [func, 1].concat(slice.call(arguments, 1)));
  };

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time. Normally, the throttled function will run
  // as much as it can, without ever going more than once per `wait` duration;
  // but if you'd like to disable the execution on the leading edge, pass
  // `{leading: false}`. To disable execution on the trailing edge, ditto.
  _.throttle = function(func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    options || (options = {});
    var later = function() {
      previous = options.leading === false ? 0 : getTime();
      timeout = null;
      result = func.apply(context, args);
      context = args = null;
    };
    return function() {
      var now = getTime();
      if (!previous && options.leading === false) previous = now;
      var remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0) {
        clearTimeout(timeout);
        timeout = null;
        previous = now;
        result = func.apply(context, args);
        context = args = null;
      } else if (!timeout && options.trailing !== false) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout, args, context, timestamp, result;
    return function() {
      context = this;
      args = arguments;
      timestamp = getTime();
      var later = function() {
        var last = getTime() - timestamp;
        if (last < wait) {
          timeout = setTimeout(later, wait - last);
        } else {
          timeout = null;
          if (!immediate) {
            result = func.apply(context, args);
            context = args = null;
          }
        }
      };
      var callNow = immediate && !timeout;
      if (!timeout) {
        timeout = setTimeout(later, wait);
      }
      if (callNow) {
        result = func.apply(context, args);
        context = args = null;
      }

      return result;
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = function(func) {
    var ran = false, memo;
    return function() {
      if (ran) return memo;
      ran = true;
      memo = func.apply(this, arguments);
      func = null;
      return memo;
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return _.partial(wrapper, func);
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var funcs = arguments;
    return function() {
      var args = arguments;
      for (var i = funcs.length - 1; i >= 0; i--) {
        args = [funcs[i].apply(this, args)];
      }
      return args[0];
    };
  };

  // Returns a function that will only be executed after being called N times.
  _.after = function(times, func) {
    return function() {
      if (--times < 1) {
        return func.apply(this, arguments);
      }
    };
  };

  // Object Functions
  // ----------------

  // Retrieve the names of an object's properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = nativeKeys || function(obj) {
    if (obj !== Object(obj)) throw new TypeError('Invalid object');
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys.push(key);
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var values = new Array(length);
    for (var i = 0; i < length; i++) {
      values[i] = obj[keys[i]];
    }
    return values;
  };

  // Convert an object into a list of `[key, value]` pairs.
  _.pairs = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var pairs = new Array(length);
    for (var i = 0; i < length; i++) {
      pairs[i] = [keys[i], obj[keys[i]]];
    }
    return pairs;
  };

  // Invert the keys and values of an object. The values must be serializable.
  _.invert = function(obj) {
    var result = {};
    var keys = _.keys(obj);
    for (var i = 0, length = keys.length; i < length; i++) {
      result[obj[keys[i]]] = keys[i];
    }
    return result;
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      if (source) {
        for (var prop in source) {
          obj[prop] = source[prop];
        }
      }
    });
    return obj;
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(obj) {
    var copy = {};
    var keys = concat.apply(ArrayProto, slice.call(arguments, 1));
    each(keys, function(key) {
      if (key in obj) copy[key] = obj[key];
    });
    return copy;
  };

  // Return a copy of the object without the blacklisted properties.
  _.omit = function(obj) {
    var copy = {};
    var keys = concat.apply(ArrayProto, slice.call(arguments, 1));
    for (var key in obj) {
      if (!_.contains(keys, key)) copy[key] = obj[key];
    }
    return copy;
  };

  // Fill in a given object with default properties.
  _.defaults = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      if (source) {
        for (var prop in source) {
          if (obj[prop] === void 0) obj[prop] = source[prop];
        }
      }
    });
    return obj;
  };

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Internal recursive comparison function for `isEqual`.
  var eq = function(a, b, aStack, bStack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
    if (a === b) return a !== 0 || 1 / a == 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a instanceof _) a = a._wrapped;
    if (b instanceof _) b = b._wrapped;
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className != toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, dates, and booleans are compared by value.
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return a == String(b);
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive. An `egal` comparison is performed for
        // other numeric values.
        return a != +a ? b != +b : (a == 0 ? 1 / a == 1 / b : a == +b);
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a == +b;
      // RegExps are compared by their source patterns and flags.
      case '[object RegExp]':
        return a.source == b.source &&
          a.global == b.global &&
          a.multiline == b.multiline &&
          a.ignoreCase == b.ignoreCase;
    }
    if (typeof a != 'object' || typeof b != 'object') return false;
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] == a) return bStack[length] == b;
    }
    // Objects with different constructors are not equivalent, but `Object`s
    // from different frames are.
    var aCtor = a.constructor, bCtor = b.constructor;
    if (aCtor !== bCtor && !(_.isFunction(aCtor) && (aCtor instanceof aCtor) &&
      _.isFunction(bCtor) && (bCtor instanceof bCtor))
      && ('constructor' in a && 'constructor' in b)) {
      return false;
    }
    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);
    var size = 0, result = true;
    // Recursively compare objects and arrays.
    if (className == '[object Array]') {
      // Compare array lengths to determine if a deep comparison is necessary.
      size = a.length;
      result = size == b.length;
      if (result) {
        // Deep compare the contents, ignoring non-numeric properties.
        while (size--) {
          if (!(result = eq(a[size], b[size], aStack, bStack))) break;
        }
      }
    } else {
      // Deep compare objects.
      for (var key in a) {
        if (_.has(a, key)) {
          // Count the expected number of properties.
          size++;
          // Deep compare each member.
          if (!(result = _.has(b, key) && eq(a[key], b[key], aStack, bStack))) break;
        }
      }
      // Ensure that both objects contain the same number of properties.
      if (result) {
        for (key in b) {
          if (_.has(b, key) && !(size--)) break;
        }
        result = !size;
      }
    }
    // Remove the first object from the stack of traversed objects.
    aStack.pop();
    bStack.pop();
    return result;
  };

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b, [], []);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (_.isArray(obj) || _.isString(obj)) return obj.length === 0;
    for (var key in obj) if (_.has(obj, key)) return false;
    return true;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType === 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) == '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    return obj === Object(obj);
  };

  // Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp.
  each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp'], function(name) {
    _['is' + name] = function(obj) {
      return toString.call(obj) == '[object ' + name + ']';
    };
  });

  // Define a fallback version of the method in browsers (ahem, IE), where
  // there isn't any inspectable "Arguments" type.
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return !!(obj && _.has(obj, 'callee'));
    };
  }

  // Optimize `isFunction` if appropriate.
  if (typeof (/./) !== 'function') {
    _.isFunction = function(obj) {
      return typeof obj === 'function';
    };
  }

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return isFinite(obj) && !isNaN(parseFloat(obj));
  };

  // Is the given value `NaN`? (NaN is the only number which does not equal itself).
  _.isNaN = function(obj) {
    return _.isNumber(obj) && obj != +obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) == '[object Boolean]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Shortcut function for checking if an object has a given property directly
  // on itself (in other words, not on a prototype).
  _.has = function(obj, key) {
    return hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iterators.
  _.identity = function(value) {
    return value;
  };

  _.constant = function(value) {
    return function () {
      return value;
    };
  };

  _.property = function(key) {
    return function(obj) {
      return obj[key];
    };
  };

  // Run a function **n** times.
  _.times = function(n, iterator, context) {
    var accum = Array(Math.max(0, n));
    for (var i = 0; i < n; i++) accum[i] = iterator.call(context, i);
    return accum;
  };

  // Return a random integer between min and max (inclusive).
  _.random = function(min, max) {
    if (max == null) {
      max = min;
      min = 0;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  };

  // List of HTML entities for escaping.
  var entityMap = {
    escape: {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;'
    }
  };
  entityMap.unescape = _.invert(entityMap.escape);

  // Regexes containing the keys and values listed immediately above.
  var entityRegexes = {
    escape:   new RegExp('[' + _.keys(entityMap.escape).join('') + ']', 'g'),
    unescape: new RegExp('(' + _.keys(entityMap.unescape).join('|') + ')', 'g')
  };

  // Functions for escaping and unescaping strings to/from HTML interpolation.
  _.each(['escape', 'unescape'], function(method) {
    _[method] = function(string) {
      if (string == null) return '';
      return ('' + string).replace(entityRegexes[method], function(match) {
        return entityMap[method][match];
      });
    };
  });

  // If the value of the named `property` is a function then invoke it with the
  // `object` as context; otherwise, return it.
  _.result = function(object, property) {
    if (object == null) return void 0;
    var value = object[property];
    return _.isFunction(value) ? value.call(object) : value;
  };

  // Add your own custom functions to the Underscore object.
  _.mixin = function(obj) {
    each(_.functions(obj), function(name) {
      var func = _[name] = obj[name];
      _.prototype[name] = function() {
        var args = [this._wrapped];
        push.apply(args, arguments);
        return result.call(this, func.apply(_, args));
      };
    });
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = ++idCounter + '';
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /(.)^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    "'":      "'",
    '\\':     '\\',
    '\r':     'r',
    '\n':     'n',
    '\t':     't',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  var escaper = /\\|'|\r|\n|\t|\u2028|\u2029/g;

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  _.template = function(text, data, settings) {
    var render;
    settings = _.defaults({}, settings, _.templateSettings);

    // Combine delimiters into one regular expression via alternation.
    var matcher = new RegExp([
      (settings.escape || noMatch).source,
      (settings.interpolate || noMatch).source,
      (settings.evaluate || noMatch).source
    ].join('|') + '|$', 'g');

    // Compile the template source, escaping string literals appropriately.
    var index = 0;
    var source = "__p+='";
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      source += text.slice(index, offset)
        .replace(escaper, function(match) { return '\\' + escapes[match]; });

      if (escape) {
        source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
      }
      if (interpolate) {
        source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
      }
      if (evaluate) {
        source += "';\n" + evaluate + "\n__p+='";
      }
      index = offset + match.length;
      return match;
    });
    source += "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __t,__p='',__j=Array.prototype.join," +
      "print=function(){__p+=__j.call(arguments,'');};\n" +
      source + "return __p;\n";

    try {
      render = new Function(settings.variable || 'obj', '_', source);
    } catch (e) {
      e.source = source;
      throw e;
    }

    if (data) return render(data, _);
    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled function source as a convenience for precompilation.
    template.source = 'function(' + (settings.variable || 'obj') + '){\n' + source + '}';

    return template;
  };

  // Add a "chain" function, which will delegate to the wrapper.
  _.chain = function(obj) {
    return _(obj).chain();
  };

  // OOP
  // ---------------
  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.

  // Helper function to continue chaining intermediate results.
  var result = function(obj) {
    return this._chain ? _(obj).chain() : obj;
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      var obj = this._wrapped;
      method.apply(obj, arguments);
      if ((name == 'shift' || name == 'splice') && obj.length === 0) delete obj[0];
      return result.call(this, obj);
    };
  });

  // Add all accessor Array functions to the wrapper.
  each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      return result.call(this, method.apply(this._wrapped, arguments));
    };
  });

  _.extend(_.prototype, {

    // Start chaining a wrapped Underscore object.
    chain: function() {
      this._chain = true;
      return this;
    },

    // Extracts the result from a wrapped and chained object.
    value: function() {
      return this._wrapped;
    }

  });

  // AMD registration happens at the end for compatibility with AMD loaders
  // that may not enforce next-turn semantics on modules. Even though general
  // practice for AMD registration is to be anonymous, underscore registers
  // as a named module because, like jQuery, it is a base library that is
  // popular enough to be bundled in a third party lib, but not be part of
  // an AMD load request. Those cases could generate an error when an
  // anonymous define() is called outside of a loader request.
  if (typeof define === 'function' && define.amd) {
    define('vendor/underscore', [], function() {
      return _;
    });
  }
}).call(this);


//! moment.js
//! version : 2.4.0
//! authors : Tim Wood, Iskren Chernev, Moment.js contributors
//! license : MIT
//! momentjs.com

(function (undefined) {

  /************************************
   Constants
   ************************************/

  var moment,
    VERSION = "2.4.0",
    round = Math.round,
    i,

    YEAR = 0,
    MONTH = 1,
    DATE = 2,
    HOUR = 3,
    MINUTE = 4,
    SECOND = 5,
    MILLISECOND = 6,

  // internal storage for language config files
    languages = {},

  // check for nodeJS
    hasModule = (typeof module !== 'undefined' && module.exports),

  // ASP.NET json date format regex
    aspNetJsonRegex = /^\/?Date\((\-?\d+)/i,
    aspNetTimeSpanJsonRegex = /(\-)?(?:(\d*)\.)?(\d+)\:(\d+)(?:\:(\d+)\.?(\d{3})?)?/,

  // from http://docs.closure-library.googlecode.com/git/closure_goog_date_date.js.source.html
  // somewhat more in line with 4.4.3.2 2004 spec, but allows decimal anywhere
    isoDurationRegex = /^(-)?P(?:(?:([0-9,.]*)Y)?(?:([0-9,.]*)M)?(?:([0-9,.]*)D)?(?:T(?:([0-9,.]*)H)?(?:([0-9,.]*)M)?(?:([0-9,.]*)S)?)?|([0-9,.]*)W)$/,

  // format tokens
    formattingTokens = /(\[[^\[]*\])|(\\)?(Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|YYYYY|YYYY|YY|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|mm?|ss?|S{1,4}|X|zz?|ZZ?|.)/g,
    localFormattingTokens = /(\[[^\[]*\])|(\\)?(LT|LL?L?L?|l{1,4})/g,

  // parsing token regexes
    parseTokenOneOrTwoDigits = /\d\d?/, // 0 - 99
    parseTokenOneToThreeDigits = /\d{1,3}/, // 0 - 999
    parseTokenThreeDigits = /\d{3}/, // 000 - 999
    parseTokenFourDigits = /\d{1,4}/, // 0 - 9999
    parseTokenSixDigits = /[+\-]?\d{1,6}/, // -999,999 - 999,999
    parseTokenDigits = /\d+/, // nonzero number of digits
    parseTokenWord = /[0-9]*['a-z\u00A0-\u05FF\u0700-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+|[\u0600-\u06FF\/]+(\s*?[\u0600-\u06FF]+){1,2}/i, // any word (or two) characters or numbers including two/three word month in arabic.
    parseTokenTimezone = /Z|[\+\-]\d\d:?\d\d/i, // +00:00 -00:00 +0000 -0000 or Z
    parseTokenT = /T/i, // T (ISO seperator)
    parseTokenTimestampMs = /[\+\-]?\d+(\.\d{1,3})?/, // 123456789 123456789.123

  // preliminary iso regex
  // 0000-00-00 0000-W00 or 0000-W00-0 + T + 00 or 00:00 or 00:00:00 or 00:00:00.000 + +00:00 or +0000)
    isoRegex = /^\s*\d{4}-(?:(\d\d-\d\d)|(W\d\d$)|(W\d\d-\d)|(\d\d\d))((T| )(\d\d(:\d\d(:\d\d(\.\d+)?)?)?)?([\+\-]\d\d:?\d\d|Z)?)?$/,

    isoFormat = 'YYYY-MM-DDTHH:mm:ssZ',

    isoDates = [
      'YYYY-MM-DD',
      'GGGG-[W]WW',
      'GGGG-[W]WW-E',
      'YYYY-DDD'
    ],

  // iso time formats and regexes
    isoTimes = [
      ['HH:mm:ss.SSSS', /(T| )\d\d:\d\d:\d\d\.\d{1,3}/],
      ['HH:mm:ss', /(T| )\d\d:\d\d:\d\d/],
      ['HH:mm', /(T| )\d\d:\d\d/],
      ['HH', /(T| )\d\d/]
    ],

  // timezone chunker "+10:00" > ["10", "00"] or "-1530" > ["-15", "30"]
    parseTimezoneChunker = /([\+\-]|\d\d)/gi,

  // getter and setter names
    proxyGettersAndSetters = 'Date|Hours|Minutes|Seconds|Milliseconds'.split('|'),
    unitMillisecondFactors = {
      'Milliseconds' : 1,
      'Seconds' : 1e3,
      'Minutes' : 6e4,
      'Hours' : 36e5,
      'Days' : 864e5,
      'Months' : 2592e6,
      'Years' : 31536e6
    },

    unitAliases = {
      ms : 'millisecond',
      s : 'second',
      m : 'minute',
      h : 'hour',
      d : 'day',
      D : 'date',
      w : 'week',
      W : 'isoWeek',
      M : 'month',
      y : 'year',
      DDD : 'dayOfYear',
      e : 'weekday',
      E : 'isoWeekday',
      gg: 'weekYear',
      GG: 'isoWeekYear'
    },

    camelFunctions = {
      dayofyear : 'dayOfYear',
      isoweekday : 'isoWeekday',
      isoweek : 'isoWeek',
      weekyear : 'weekYear',
      isoweekyear : 'isoWeekYear'
    },

  // format function strings
    formatFunctions = {},

  // tokens to ordinalize and pad
    ordinalizeTokens = 'DDD w W M D d'.split(' '),
    paddedTokens = 'M D H h m s w W'.split(' '),

    formatTokenFunctions = {
      M    : function () {
        return this.month() + 1;
      },
      MMM  : function (format) {
        return this.lang().monthsShort(this, format);
      },
      MMMM : function (format) {
        return this.lang().months(this, format);
      },
      D    : function () {
        return this.date();
      },
      DDD  : function () {
        return this.dayOfYear();
      },
      d    : function () {
        return this.day();
      },
      dd   : function (format) {
        return this.lang().weekdaysMin(this, format);
      },
      ddd  : function (format) {
        return this.lang().weekdaysShort(this, format);
      },
      dddd : function (format) {
        return this.lang().weekdays(this, format);
      },
      w    : function () {
        return this.week();
      },
      W    : function () {
        return this.isoWeek();
      },
      YY   : function () {
        return leftZeroFill(this.year() % 100, 2);
      },
      YYYY : function () {
        return leftZeroFill(this.year(), 4);
      },
      YYYYY : function () {
        return leftZeroFill(this.year(), 5);
      },
      gg   : function () {
        return leftZeroFill(this.weekYear() % 100, 2);
      },
      gggg : function () {
        return this.weekYear();
      },
      ggggg : function () {
        return leftZeroFill(this.weekYear(), 5);
      },
      GG   : function () {
        return leftZeroFill(this.isoWeekYear() % 100, 2);
      },
      GGGG : function () {
        return this.isoWeekYear();
      },
      GGGGG : function () {
        return leftZeroFill(this.isoWeekYear(), 5);
      },
      e : function () {
        return this.weekday();
      },
      E : function () {
        return this.isoWeekday();
      },
      a    : function () {
        return this.lang().meridiem(this.hours(), this.minutes(), true);
      },
      A    : function () {
        return this.lang().meridiem(this.hours(), this.minutes(), false);
      },
      H    : function () {
        return this.hours();
      },
      h    : function () {
        return this.hours() % 12 || 12;
      },
      m    : function () {
        return this.minutes();
      },
      s    : function () {
        return this.seconds();
      },
      S    : function () {
        return toInt(this.milliseconds() / 100);
      },
      SS   : function () {
        return leftZeroFill(toInt(this.milliseconds() / 10), 2);
      },
      SSS  : function () {
        return leftZeroFill(this.milliseconds(), 3);
      },
      SSSS : function () {
        return leftZeroFill(this.milliseconds(), 3);
      },
      Z    : function () {
        var a = -this.zone(),
          b = "+";
        if (a < 0) {
          a = -a;
          b = "-";
        }
        return b + leftZeroFill(toInt(a / 60), 2) + ":" + leftZeroFill(toInt(a) % 60, 2);
      },
      ZZ   : function () {
        var a = -this.zone(),
          b = "+";
        if (a < 0) {
          a = -a;
          b = "-";
        }
        return b + leftZeroFill(toInt(10 * a / 6), 4);
      },
      z : function () {
        return this.zoneAbbr();
      },
      zz : function () {
        return this.zoneName();
      },
      X    : function () {
        return this.unix();
      }
    },

    lists = ['months', 'monthsShort', 'weekdays', 'weekdaysShort', 'weekdaysMin'];

  function padToken(func, count) {
    return function (a) {
      return leftZeroFill(func.call(this, a), count);
    };
  }
  function ordinalizeToken(func, period) {
    return function (a) {
      return this.lang().ordinal(func.call(this, a), period);
    };
  }

  while (ordinalizeTokens.length) {
    i = ordinalizeTokens.pop();
    formatTokenFunctions[i + 'o'] = ordinalizeToken(formatTokenFunctions[i], i);
  }
  while (paddedTokens.length) {
    i = paddedTokens.pop();
    formatTokenFunctions[i + i] = padToken(formatTokenFunctions[i], 2);
  }
  formatTokenFunctions.DDDD = padToken(formatTokenFunctions.DDD, 3);


  /************************************
   Constructors
   ************************************/

  function Language() {

  }

  // Moment prototype object
  function Moment(config) {
    checkOverflow(config);
    extend(this, config);
  }

  // Duration Constructor
  function Duration(duration) {
    var normalizedInput = normalizeObjectUnits(duration),
      years = normalizedInput.year || 0,
      months = normalizedInput.month || 0,
      weeks = normalizedInput.week || 0,
      days = normalizedInput.day || 0,
      hours = normalizedInput.hour || 0,
      minutes = normalizedInput.minute || 0,
      seconds = normalizedInput.second || 0,
      milliseconds = normalizedInput.millisecond || 0;

    // store reference to input for deterministic cloning
    this._input = duration;

    // representation for dateAddRemove
    this._milliseconds = +milliseconds +
      seconds * 1e3 + // 1000
      minutes * 6e4 + // 1000 * 60
      hours * 36e5; // 1000 * 60 * 60
    // Because of dateAddRemove treats 24 hours as different from a
    // day when working around DST, we need to store them separately
    this._days = +days +
      weeks * 7;
    // It is impossible translate months into days without knowing
    // which months you are are talking about, so we have to store
    // it separately.
    this._months = +months +
      years * 12;

    this._data = {};

    this._bubble();
  }

  /************************************
   Helpers
   ************************************/


  function extend(a, b) {
    for (var i in b) {
      if (b.hasOwnProperty(i)) {
        a[i] = b[i];
      }
    }

    if (b.hasOwnProperty("toString")) {
      a.toString = b.toString;
    }

    if (b.hasOwnProperty("valueOf")) {
      a.valueOf = b.valueOf;
    }

    return a;
  }

  function absRound(number) {
    if (number < 0) {
      return Math.ceil(number);
    } else {
      return Math.floor(number);
    }
  }

  // left zero fill a number
  // see http://jsperf.com/left-zero-filling for performance comparison
  function leftZeroFill(number, targetLength) {
    var output = number + '';
    while (output.length < targetLength) {
      output = '0' + output;
    }
    return output;
  }

  // helper function for _.addTime and _.subtractTime
  function addOrSubtractDurationFromMoment(mom, duration, isAdding, ignoreUpdateOffset) {
    var milliseconds = duration._milliseconds,
      days = duration._days,
      months = duration._months,
      minutes,
      hours;

    if (milliseconds) {
      mom._d.setTime(+mom._d + milliseconds * isAdding);
    }
    // store the minutes and hours so we can restore them
    if (days || months) {
      minutes = mom.minute();
      hours = mom.hour();
    }
    if (days) {
      mom.date(mom.date() + days * isAdding);
    }
    if (months) {
      mom.month(mom.month() + months * isAdding);
    }
    if (milliseconds && !ignoreUpdateOffset) {
      moment.updateOffset(mom);
    }
    // restore the minutes and hours after possibly changing dst
    if (days || months) {
      mom.minute(minutes);
      mom.hour(hours);
    }
  }

  // check if is an array
  function isArray(input) {
    return Object.prototype.toString.call(input) === '[object Array]';
  }

  function isDate(input) {
    return  Object.prototype.toString.call(input) === '[object Date]' ||
      input instanceof Date;
  }

  // compare two arrays, return the number of differences
  function compareArrays(array1, array2, dontConvert) {
    var len = Math.min(array1.length, array2.length),
      lengthDiff = Math.abs(array1.length - array2.length),
      diffs = 0,
      i;
    for (i = 0; i < len; i++) {
      if ((dontConvert && array1[i] !== array2[i]) ||
        (!dontConvert && toInt(array1[i]) !== toInt(array2[i]))) {
        diffs++;
      }
    }
    return diffs + lengthDiff;
  }

  function normalizeUnits(units) {
    if (units) {
      var lowered = units.toLowerCase().replace(/(.)s$/, '$1');
      units = unitAliases[units] || camelFunctions[lowered] || lowered;
    }
    return units;
  }

  function normalizeObjectUnits(inputObject) {
    var normalizedInput = {},
      normalizedProp,
      prop,
      index;

    for (prop in inputObject) {
      if (inputObject.hasOwnProperty(prop)) {
        normalizedProp = normalizeUnits(prop);
        if (normalizedProp) {
          normalizedInput[normalizedProp] = inputObject[prop];
        }
      }
    }

    return normalizedInput;
  }

  function makeList(field) {
    var count, setter;

    if (field.indexOf('week') === 0) {
      count = 7;
      setter = 'day';
    }
    else if (field.indexOf('month') === 0) {
      count = 12;
      setter = 'month';
    }
    else {
      return;
    }

    moment[field] = function (format, index) {
      var i, getter,
        method = moment.fn._lang[field],
        results = [];

      if (typeof format === 'number') {
        index = format;
        format = undefined;
      }

      getter = function (i) {
        var m = moment().utc().set(setter, i);
        return method.call(moment.fn._lang, m, format || '');
      };

      if (index != null) {
        return getter(index);
      }
      else {
        for (i = 0; i < count; i++) {
          results.push(getter(i));
        }
        return results;
      }
    };
  }

  function toInt(argumentForCoercion) {
    var coercedNumber = +argumentForCoercion,
      value = 0;

    if (coercedNumber !== 0 && isFinite(coercedNumber)) {
      if (coercedNumber >= 0) {
        value = Math.floor(coercedNumber);
      } else {
        value = Math.ceil(coercedNumber);
      }
    }

    return value;
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  }

  function daysInYear(year) {
    return isLeapYear(year) ? 366 : 365;
  }

  function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  function checkOverflow(m) {
    var overflow;
    if (m._a && m._pf.overflow === -2) {
      overflow =
        m._a[MONTH] < 0 || m._a[MONTH] > 11 ? MONTH :
          m._a[DATE] < 1 || m._a[DATE] > daysInMonth(m._a[YEAR], m._a[MONTH]) ? DATE :
            m._a[HOUR] < 0 || m._a[HOUR] > 23 ? HOUR :
              m._a[MINUTE] < 0 || m._a[MINUTE] > 59 ? MINUTE :
                m._a[SECOND] < 0 || m._a[SECOND] > 59 ? SECOND :
                  m._a[MILLISECOND] < 0 || m._a[MILLISECOND] > 999 ? MILLISECOND :
                    -1;

      if (m._pf._overflowDayOfYear && (overflow < YEAR || overflow > DATE)) {
        overflow = DATE;
      }

      m._pf.overflow = overflow;
    }
  }

  function initializeParsingFlags(config) {
    config._pf = {
      empty : false,
      unusedTokens : [],
      unusedInput : [],
      overflow : -2,
      charsLeftOver : 0,
      nullInput : false,
      invalidMonth : null,
      invalidFormat : false,
      userInvalidated : false,
      iso: false
    };
  }

  function isValid(m) {
    if (m._isValid == null) {
      m._isValid = !isNaN(m._d.getTime()) &&
        m._pf.overflow < 0 &&
        !m._pf.empty &&
        !m._pf.invalidMonth &&
        !m._pf.nullInput &&
        !m._pf.invalidFormat &&
        !m._pf.userInvalidated;

      if (m._strict) {
        m._isValid = m._isValid &&
          m._pf.charsLeftOver === 0 &&
          m._pf.unusedTokens.length === 0;
      }
    }
    return m._isValid;
  }

  function normalizeLanguage(key) {
    return key ? key.toLowerCase().replace('_', '-') : key;
  }

  /************************************
   Languages
   ************************************/


  extend(Language.prototype, {

    set : function (config) {
      var prop, i;
      for (i in config) {
        prop = config[i];
        if (typeof prop === 'function') {
          this[i] = prop;
        } else {
          this['_' + i] = prop;
        }
      }
    },

    _months : "January_February_March_April_May_June_July_August_September_October_November_December".split("_"),
    months : function (m) {
      return this._months[m.month()];
    },

    _monthsShort : "Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),
    monthsShort : function (m) {
      return this._monthsShort[m.month()];
    },

    monthsParse : function (monthName) {
      var i, mom, regex;

      if (!this._monthsParse) {
        this._monthsParse = [];
      }

      for (i = 0; i < 12; i++) {
        // make the regex if we don't have it already
        if (!this._monthsParse[i]) {
          mom = moment.utc([2000, i]);
          regex = '^' + this.months(mom, '') + '|^' + this.monthsShort(mom, '');
          this._monthsParse[i] = new RegExp(regex.replace('.', ''), 'i');
        }
        // test the regex
        if (this._monthsParse[i].test(monthName)) {
          return i;
        }
      }
    },

    _weekdays : "Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),
    weekdays : function (m) {
      return this._weekdays[m.day()];
    },

    _weekdaysShort : "Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),
    weekdaysShort : function (m) {
      return this._weekdaysShort[m.day()];
    },

    _weekdaysMin : "Su_Mo_Tu_We_Th_Fr_Sa".split("_"),
    weekdaysMin : function (m) {
      return this._weekdaysMin[m.day()];
    },

    weekdaysParse : function (weekdayName) {
      var i, mom, regex;

      if (!this._weekdaysParse) {
        this._weekdaysParse = [];
      }

      for (i = 0; i < 7; i++) {
        // make the regex if we don't have it already
        if (!this._weekdaysParse[i]) {
          mom = moment([2000, 1]).day(i);
          regex = '^' + this.weekdays(mom, '') + '|^' + this.weekdaysShort(mom, '') + '|^' + this.weekdaysMin(mom, '');
          this._weekdaysParse[i] = new RegExp(regex.replace('.', ''), 'i');
        }
        // test the regex
        if (this._weekdaysParse[i].test(weekdayName)) {
          return i;
        }
      }
    },

    _longDateFormat : {
      LT : "h:mm A",
      L : "MM/DD/YYYY",
      LL : "MMMM D YYYY",
      LLL : "MMMM D YYYY LT",
      LLLL : "dddd, MMMM D YYYY LT"
    },
    longDateFormat : function (key) {
      var output = this._longDateFormat[key];
      if (!output && this._longDateFormat[key.toUpperCase()]) {
        output = this._longDateFormat[key.toUpperCase()].replace(/MMMM|MM|DD|dddd/g, function (val) {
          return val.slice(1);
        });
        this._longDateFormat[key] = output;
      }
      return output;
    },

    isPM : function (input) {
      // IE8 Quirks Mode & IE7 Standards Mode do not allow accessing strings like arrays
      // Using charAt should be more compatible.
      return ((input + '').toLowerCase().charAt(0) === 'p');
    },

    _meridiemParse : /[ap]\.?m?\.?/i,
    meridiem : function (hours, minutes, isLower) {
      if (hours > 11) {
        return isLower ? 'pm' : 'PM';
      } else {
        return isLower ? 'am' : 'AM';
      }
    },

    _calendar : {
      sameDay : '[Today at] LT',
      nextDay : '[Tomorrow at] LT',
      nextWeek : 'dddd [at] LT',
      lastDay : '[Yesterday at] LT',
      lastWeek : '[Last] dddd [at] LT',
      sameElse : 'L'
    },
    calendar : function (key, mom) {
      var output = this._calendar[key];
      return typeof output === 'function' ? output.apply(mom) : output;
    },

    _relativeTime : {
      future : "in %s",
      past : "%s ago",
      s : "a few seconds",
      m : "a minute",
      mm : "%d minutes",
      h : "an hour",
      hh : "%d hours",
      d : "a day",
      dd : "%d days",
      M : "a month",
      MM : "%d months",
      y : "a year",
      yy : "%d years"
    },
    relativeTime : function (number, withoutSuffix, string, isFuture) {
      var output = this._relativeTime[string];
      return (typeof output === 'function') ?
        output(number, withoutSuffix, string, isFuture) :
        output.replace(/%d/i, number);
    },
    pastFuture : function (diff, output) {
      var format = this._relativeTime[diff > 0 ? 'future' : 'past'];
      return typeof format === 'function' ? format(output) : format.replace(/%s/i, output);
    },

    ordinal : function (number) {
      return this._ordinal.replace("%d", number);
    },
    _ordinal : "%d",

    preparse : function (string) {
      return string;
    },

    postformat : function (string) {
      return string;
    },

    week : function (mom) {
      return weekOfYear(mom, this._week.dow, this._week.doy).week;
    },

    _week : {
      dow : 0, // Sunday is the first day of the week.
      doy : 6  // The week that contains Jan 1st is the first week of the year.
    },

    _invalidDate: 'Invalid date',
    invalidDate: function () {
      return this._invalidDate;
    }
  });

  // Loads a language definition into the `languages` cache.  The function
  // takes a key and optionally values.  If not in the browser and no values
  // are provided, it will load the language file module.  As a convenience,
  // this function also returns the language values.
  function loadLang(key, values) {
    values.abbr = key;
    if (!languages[key]) {
      languages[key] = new Language();
    }
    languages[key].set(values);
    return languages[key];
  }

  // Remove a language from the `languages` cache. Mostly useful in tests.
  function unloadLang(key) {
    delete languages[key];
  }

  // Determines which language definition to use and returns it.
  //
  // With no parameters, it will return the global language.  If you
  // pass in a language key, such as 'en', it will return the
  // definition for 'en', so long as 'en' has already been loaded using
  // moment.lang.
  function getLangDefinition(key) {
    var i = 0, j, lang, next, split,
      get = function (k) {
        if (!languages[k] && hasModule) {
          try {
            require('./lang/' + k);
          } catch (e) { }
        }
        return languages[k];
      };

    if (!key) {
      return moment.fn._lang;
    }

    if (!isArray(key)) {
      //short-circuit everything else
      lang = get(key);
      if (lang) {
        return lang;
      }
      key = [key];
    }

    //pick the language from the array
    //try ['en-au', 'en-gb'] as 'en-au', 'en-gb', 'en', as in move through the list trying each
    //substring from most specific to least, but move to the next array item if it's a more specific variant than the current root
    while (i < key.length) {
      split = normalizeLanguage(key[i]).split('-');
      j = split.length;
      next = normalizeLanguage(key[i + 1]);
      next = next ? next.split('-') : null;
      while (j > 0) {
        lang = get(split.slice(0, j).join('-'));
        if (lang) {
          return lang;
        }
        if (next && next.length >= j && compareArrays(split, next, true) >= j - 1) {
          //the next array item is better than a shallower substring of this one
          break;
        }
        j--;
      }
      i++;
    }
    return moment.fn._lang;
  }

  /************************************
   Formatting
   ************************************/


  function removeFormattingTokens(input) {
    if (input.match(/\[[\s\S]/)) {
      return input.replace(/^\[|\]$/g, "");
    }
    return input.replace(/\\/g, "");
  }

  function makeFormatFunction(format) {
    var array = format.match(formattingTokens), i, length;

    for (i = 0, length = array.length; i < length; i++) {
      if (formatTokenFunctions[array[i]]) {
        array[i] = formatTokenFunctions[array[i]];
      } else {
        array[i] = removeFormattingTokens(array[i]);
      }
    }

    return function (mom) {
      var output = "";
      for (i = 0; i < length; i++) {
        output += array[i] instanceof Function ? array[i].call(mom, format) : array[i];
      }
      return output;
    };
  }

  // format date using native date object
  function formatMoment(m, format) {

    if (!m.isValid()) {
      return m.lang().invalidDate();
    }

    format = expandFormat(format, m.lang());

    if (!formatFunctions[format]) {
      formatFunctions[format] = makeFormatFunction(format);
    }

    return formatFunctions[format](m);
  }

  function expandFormat(format, lang) {
    var i = 5;

    function replaceLongDateFormatTokens(input) {
      return lang.longDateFormat(input) || input;
    }

    localFormattingTokens.lastIndex = 0;
    while (i >= 0 && localFormattingTokens.test(format)) {
      format = format.replace(localFormattingTokens, replaceLongDateFormatTokens);
      localFormattingTokens.lastIndex = 0;
      i -= 1;
    }

    return format;
  }


  /************************************
   Parsing
   ************************************/


    // get the regex to find the next token
  function getParseRegexForToken(token, config) {
    var a;
    switch (token) {
      case 'DDDD':
        return parseTokenThreeDigits;
      case 'YYYY':
      case 'GGGG':
      case 'gggg':
        return parseTokenFourDigits;
      case 'YYYYY':
      case 'GGGGG':
      case 'ggggg':
        return parseTokenSixDigits;
      case 'S':
      case 'SS':
      case 'SSS':
      case 'DDD':
        return parseTokenOneToThreeDigits;
      case 'MMM':
      case 'MMMM':
      case 'dd':
      case 'ddd':
      case 'dddd':
        return parseTokenWord;
      case 'a':
      case 'A':
        return getLangDefinition(config._l)._meridiemParse;
      case 'X':
        return parseTokenTimestampMs;
      case 'Z':
      case 'ZZ':
        return parseTokenTimezone;
      case 'T':
        return parseTokenT;
      case 'SSSS':
        return parseTokenDigits;
      case 'MM':
      case 'DD':
      case 'YY':
      case 'GG':
      case 'gg':
      case 'HH':
      case 'hh':
      case 'mm':
      case 'ss':
      case 'M':
      case 'D':
      case 'd':
      case 'H':
      case 'h':
      case 'm':
      case 's':
      case 'w':
      case 'ww':
      case 'W':
      case 'WW':
      case 'e':
      case 'E':
        return parseTokenOneOrTwoDigits;
      default :
        a = new RegExp(regexpEscape(unescapeFormat(token.replace('\\', '')), "i"));
        return a;
    }
  }

  function timezoneMinutesFromString(string) {
    var tzchunk = (parseTokenTimezone.exec(string) || [])[0],
      parts = (tzchunk + '').match(parseTimezoneChunker) || ['-', 0, 0],
      minutes = +(parts[1] * 60) + toInt(parts[2]);

    return parts[0] === '+' ? -minutes : minutes;
  }

  // function to convert string input to date
  function addTimeToArrayFromToken(token, input, config) {
    var a, datePartArray = config._a;

    switch (token) {
      // MONTH
      case 'M' : // fall through to MM
      case 'MM' :
        if (input != null) {
          datePartArray[MONTH] = toInt(input) - 1;
        }
        break;
      case 'MMM' : // fall through to MMMM
      case 'MMMM' :
        a = getLangDefinition(config._l).monthsParse(input);
        // if we didn't find a month name, mark the date as invalid.
        if (a != null) {
          datePartArray[MONTH] = a;
        } else {
          config._pf.invalidMonth = input;
        }
        break;
      // DAY OF MONTH
      case 'D' : // fall through to DD
      case 'DD' :
        if (input != null) {
          datePartArray[DATE] = toInt(input);
        }
        break;
      // DAY OF YEAR
      case 'DDD' : // fall through to DDDD
      case 'DDDD' :
        if (input != null) {
          config._dayOfYear = toInt(input);
        }

        break;
      // YEAR
      case 'YY' :
        datePartArray[YEAR] = toInt(input) + (toInt(input) > 68 ? 1900 : 2000);
        break;
      case 'YYYY' :
      case 'YYYYY' :
        datePartArray[YEAR] = toInt(input);
        break;
      // AM / PM
      case 'a' : // fall through to A
      case 'A' :
        config._isPm = getLangDefinition(config._l).isPM(input);
        break;
      // 24 HOUR
      case 'H' : // fall through to hh
      case 'HH' : // fall through to hh
      case 'h' : // fall through to hh
      case 'hh' :
        datePartArray[HOUR] = toInt(input);
        break;
      // MINUTE
      case 'm' : // fall through to mm
      case 'mm' :
        datePartArray[MINUTE] = toInt(input);
        break;
      // SECOND
      case 's' : // fall through to ss
      case 'ss' :
        datePartArray[SECOND] = toInt(input);
        break;
      // MILLISECOND
      case 'S' :
      case 'SS' :
      case 'SSS' :
      case 'SSSS' :
        datePartArray[MILLISECOND] = toInt(('0.' + input) * 1000);
        break;
      // UNIX TIMESTAMP WITH MS
      case 'X':
        config._d = new Date(parseFloat(input) * 1000);
        break;
      // TIMEZONE
      case 'Z' : // fall through to ZZ
      case 'ZZ' :
        config._useUTC = true;
        config._tzm = timezoneMinutesFromString(input);
        break;
      case 'w':
      case 'ww':
      case 'W':
      case 'WW':
      case 'd':
      case 'dd':
      case 'ddd':
      case 'dddd':
      case 'e':
      case 'E':
        token = token.substr(0, 1);
      /* falls through */
      case 'gg':
      case 'gggg':
      case 'GG':
      case 'GGGG':
      case 'GGGGG':
        token = token.substr(0, 2);
        if (input) {
          config._w = config._w || {};
          config._w[token] = input;
        }
        break;
    }
  }

  // convert an array to a date.
  // the array should mirror the parameters below
  // note: all values past the year are optional and will default to the lowest possible value.
  // [year, month, day , hour, minute, second, millisecond]
  function dateFromConfig(config) {
    var i, date, input = [], currentDate,
      yearToUse, fixYear, w, temp, lang, weekday, week;

    if (config._d) {
      return;
    }

    currentDate = currentDateArray(config);

    //compute day of the year from weeks and weekdays
    if (config._w && config._a[DATE] == null && config._a[MONTH] == null) {
      fixYear = function (val) {
        return val ?
          (val.length < 3 ? (parseInt(val, 10) > 68 ? '19' + val : '20' + val) : val) :
          (config._a[YEAR] == null ? moment().weekYear() : config._a[YEAR]);
      };

      w = config._w;
      if (w.GG != null || w.W != null || w.E != null) {
        temp = dayOfYearFromWeeks(fixYear(w.GG), w.W || 1, w.E, 4, 1);
      }
      else {
        lang = getLangDefinition(config._l);
        weekday = w.d != null ?  parseWeekday(w.d, lang) :
          (w.e != null ?  parseInt(w.e, 10) + lang._week.dow : 0);

        week = parseInt(w.w, 10) || 1;

        //if we're parsing 'd', then the low day numbers may be next week
        if (w.d != null && weekday < lang._week.dow) {
          week++;
        }

        temp = dayOfYearFromWeeks(fixYear(w.gg), week, weekday, lang._week.doy, lang._week.dow);
      }

      config._a[YEAR] = temp.year;
      config._dayOfYear = temp.dayOfYear;
    }

    //if the day of the year is set, figure out what it is
    if (config._dayOfYear) {
      yearToUse = config._a[YEAR] == null ? currentDate[YEAR] : config._a[YEAR];

      if (config._dayOfYear > daysInYear(yearToUse)) {
        config._pf._overflowDayOfYear = true;
      }

      date = makeUTCDate(yearToUse, 0, config._dayOfYear);
      config._a[MONTH] = date.getUTCMonth();
      config._a[DATE] = date.getUTCDate();
    }

    // Default to current date.
    // * if no year, month, day of month are given, default to today
    // * if day of month is given, default month and year
    // * if month is given, default only year
    // * if year is given, don't default anything
    for (i = 0; i < 3 && config._a[i] == null; ++i) {
      config._a[i] = input[i] = currentDate[i];
    }

    // Zero out whatever was not defaulted, including time
    for (; i < 7; i++) {
      config._a[i] = input[i] = (config._a[i] == null) ? (i === 2 ? 1 : 0) : config._a[i];
    }

    // add the offsets to the time to be parsed so that we can have a clean array for checking isValid
    input[HOUR] += toInt((config._tzm || 0) / 60);
    input[MINUTE] += toInt((config._tzm || 0) % 60);

    config._d = (config._useUTC ? makeUTCDate : makeDate).apply(null, input);
  }

  function dateFromObject(config) {
    var normalizedInput;

    if (config._d) {
      return;
    }

    normalizedInput = normalizeObjectUnits(config._i);
    config._a = [
      normalizedInput.year,
      normalizedInput.month,
      normalizedInput.day,
      normalizedInput.hour,
      normalizedInput.minute,
      normalizedInput.second,
      normalizedInput.millisecond
    ];

    dateFromConfig(config);
  }

  function currentDateArray(config) {
    var now = new Date();
    if (config._useUTC) {
      return [
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
      ];
    } else {
      return [now.getFullYear(), now.getMonth(), now.getDate()];
    }
  }

  // date from string and format string
  function makeDateFromStringAndFormat(config) {

    config._a = [];
    config._pf.empty = true;

    // This array is used to make a Date, either with `new Date` or `Date.UTC`
    var lang = getLangDefinition(config._l),
      string = '' + config._i,
      i, parsedInput, tokens, token, skipped,
      stringLength = string.length,
      totalParsedInputLength = 0;

    tokens = expandFormat(config._f, lang).match(formattingTokens) || [];

    for (i = 0; i < tokens.length; i++) {
      token = tokens[i];
      parsedInput = (getParseRegexForToken(token, config).exec(string) || [])[0];
      if (parsedInput) {
        skipped = string.substr(0, string.indexOf(parsedInput));
        if (skipped.length > 0) {
          config._pf.unusedInput.push(skipped);
        }
        string = string.slice(string.indexOf(parsedInput) + parsedInput.length);
        totalParsedInputLength += parsedInput.length;
      }
      // don't parse if it's not a known token
      if (formatTokenFunctions[token]) {
        if (parsedInput) {
          config._pf.empty = false;
        }
        else {
          config._pf.unusedTokens.push(token);
        }
        addTimeToArrayFromToken(token, parsedInput, config);
      }
      else if (config._strict && !parsedInput) {
        config._pf.unusedTokens.push(token);
      }
    }

    // add remaining unparsed input length to the string
    config._pf.charsLeftOver = stringLength - totalParsedInputLength;
    if (string.length > 0) {
      config._pf.unusedInput.push(string);
    }

    // handle am pm
    if (config._isPm && config._a[HOUR] < 12) {
      config._a[HOUR] += 12;
    }
    // if is 12 am, change hours to 0
    if (config._isPm === false && config._a[HOUR] === 12) {
      config._a[HOUR] = 0;
    }

    dateFromConfig(config);
    checkOverflow(config);
  }

  function unescapeFormat(s) {
    return s.replace(/\\(\[)|\\(\])|\[([^\]\[]*)\]|\\(.)/g, function (matched, p1, p2, p3, p4) {
      return p1 || p2 || p3 || p4;
    });
  }

  // Code from http://stackoverflow.com/questions/3561493/is-there-a-regexp-escape-function-in-javascript
  function regexpEscape(s) {
    return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  }

  // date from string and array of format strings
  function makeDateFromStringAndArray(config) {
    var tempConfig,
      bestMoment,

      scoreToBeat,
      i,
      currentScore;

    if (config._f.length === 0) {
      config._pf.invalidFormat = true;
      config._d = new Date(NaN);
      return;
    }

    for (i = 0; i < config._f.length; i++) {
      currentScore = 0;
      tempConfig = extend({}, config);
      initializeParsingFlags(tempConfig);
      tempConfig._f = config._f[i];
      makeDateFromStringAndFormat(tempConfig);

      if (!isValid(tempConfig)) {
        continue;
      }

      // if there is any input that was not parsed add a penalty for that format
      currentScore += tempConfig._pf.charsLeftOver;

      //or tokens
      currentScore += tempConfig._pf.unusedTokens.length * 10;

      tempConfig._pf.score = currentScore;

      if (scoreToBeat == null || currentScore < scoreToBeat) {
        scoreToBeat = currentScore;
        bestMoment = tempConfig;
      }
    }

    extend(config, bestMoment || tempConfig);
  }

  // date from iso format
  function makeDateFromString(config) {
    var i,
      string = config._i,
      match = isoRegex.exec(string);

    if (match) {
      config._pf.iso = true;
      for (i = 4; i > 0; i--) {
        if (match[i]) {
          // match[5] should be "T" or undefined
          config._f = isoDates[i - 1] + (match[6] || " ");
          break;
        }
      }
      for (i = 0; i < 4; i++) {
        if (isoTimes[i][1].exec(string)) {
          config._f += isoTimes[i][0];
          break;
        }
      }
      if (parseTokenTimezone.exec(string)) {
        config._f += "Z";
      }
      makeDateFromStringAndFormat(config);
    }
    else {
      config._d = new Date(string);
    }
  }

  function makeDateFromInput(config) {
    var input = config._i,
      matched = aspNetJsonRegex.exec(input);

    if (input === undefined) {
      config._d = new Date();
    } else if (matched) {
      config._d = new Date(+matched[1]);
    } else if (typeof input === 'string') {
      makeDateFromString(config);
    } else if (isArray(input)) {
      config._a = input.slice(0);
      dateFromConfig(config);
    } else if (isDate(input)) {
      config._d = new Date(+input);
    } else if (typeof(input) === 'object') {
      dateFromObject(config);
    } else {
      config._d = new Date(input);
    }
  }

  function makeDate(y, m, d, h, M, s, ms) {
    //can't just apply() to create a date:
    //http://stackoverflow.com/questions/181348/instantiating-a-javascript-object-by-calling-prototype-constructor-apply
    var date = new Date(y, m, d, h, M, s, ms);

    //the date constructor doesn't accept years < 1970
    if (y < 1970) {
      date.setFullYear(y);
    }
    return date;
  }

  function makeUTCDate(y) {
    var date = new Date(Date.UTC.apply(null, arguments));
    if (y < 1970) {
      date.setUTCFullYear(y);
    }
    return date;
  }

  function parseWeekday(input, language) {
    if (typeof input === 'string') {
      if (!isNaN(input)) {
        input = parseInt(input, 10);
      }
      else {
        input = language.weekdaysParse(input);
        if (typeof input !== 'number') {
          return null;
        }
      }
    }
    return input;
  }

  /************************************
   Relative Time
   ************************************/


    // helper function for moment.fn.from, moment.fn.fromNow, and moment.duration.fn.humanize
  function substituteTimeAgo(string, number, withoutSuffix, isFuture, lang) {
    return lang.relativeTime(number || 1, !!withoutSuffix, string, isFuture);
  }

  function relativeTime(milliseconds, withoutSuffix, lang) {
    var seconds = round(Math.abs(milliseconds) / 1000),
      minutes = round(seconds / 60),
      hours = round(minutes / 60),
      days = round(hours / 24),
      years = round(days / 365),
      args = seconds < 45 && ['s', seconds] ||
        minutes === 1 && ['m'] ||
        minutes < 45 && ['mm', minutes] ||
        hours === 1 && ['h'] ||
        hours < 22 && ['hh', hours] ||
        days === 1 && ['d'] ||
        days <= 25 && ['dd', days] ||
        days <= 45 && ['M'] ||
        days < 345 && ['MM', round(days / 30)] ||
        years === 1 && ['y'] || ['yy', years];
    args[2] = withoutSuffix;
    args[3] = milliseconds > 0;
    args[4] = lang;
    return substituteTimeAgo.apply({}, args);
  }


  /************************************
   Week of Year
   ************************************/


    // firstDayOfWeek       0 = sun, 6 = sat
    //                      the day of the week that starts the week
    //                      (usually sunday or monday)
    // firstDayOfWeekOfYear 0 = sun, 6 = sat
    //                      the first week is the week that contains the first
    //                      of this day of the week
    //                      (eg. ISO weeks use thursday (4))
  function weekOfYear(mom, firstDayOfWeek, firstDayOfWeekOfYear) {
    var end = firstDayOfWeekOfYear - firstDayOfWeek,
      daysToDayOfWeek = firstDayOfWeekOfYear - mom.day(),
      adjustedMoment;


    if (daysToDayOfWeek > end) {
      daysToDayOfWeek -= 7;
    }

    if (daysToDayOfWeek < end - 7) {
      daysToDayOfWeek += 7;
    }

    adjustedMoment = moment(mom).add('d', daysToDayOfWeek);
    return {
      week: Math.ceil(adjustedMoment.dayOfYear() / 7),
      year: adjustedMoment.year()
    };
  }

  //http://en.wikipedia.org/wiki/ISO_week_date#Calculating_a_date_given_the_year.2C_week_number_and_weekday
  function dayOfYearFromWeeks(year, week, weekday, firstDayOfWeekOfYear, firstDayOfWeek) {
    var d = new Date(Date.UTC(year, 0)).getUTCDay(),
      daysToAdd, dayOfYear;

    weekday = weekday != null ? weekday : firstDayOfWeek;
    daysToAdd = firstDayOfWeek - d + (d > firstDayOfWeekOfYear ? 7 : 0);
    dayOfYear = 7 * (week - 1) + (weekday - firstDayOfWeek) + daysToAdd + 1;

    return {
      year: dayOfYear > 0 ? year : year - 1,
      dayOfYear: dayOfYear > 0 ?  dayOfYear : daysInYear(year - 1) + dayOfYear
    };
  }

  /************************************
   Top Level Functions
   ************************************/

  function makeMoment(config) {
    var input = config._i,
      format = config._f;

    if (typeof config._pf === 'undefined') {
      initializeParsingFlags(config);
    }

    if (input === null) {
      return moment.invalid({nullInput: true});
    }

    if (typeof input === 'string') {
      config._i = input = getLangDefinition().preparse(input);
    }

    if (moment.isMoment(input)) {
      config = extend({}, input);

      config._d = new Date(+input._d);
    } else if (format) {
      if (isArray(format)) {
        makeDateFromStringAndArray(config);
      } else {
        makeDateFromStringAndFormat(config);
      }
    } else {
      makeDateFromInput(config);
    }

    return new Moment(config);
  }

  moment = function (input, format, lang, strict) {
    if (typeof(lang) === "boolean") {
      strict = lang;
      lang = undefined;
    }
    return makeMoment({
      _i : input,
      _f : format,
      _l : lang,
      _strict : strict,
      _isUTC : false
    });
  };

  // creating with utc
  moment.utc = function (input, format, lang, strict) {
    var m;

    if (typeof(lang) === "boolean") {
      strict = lang;
      lang = undefined;
    }
    m = makeMoment({
      _useUTC : true,
      _isUTC : true,
      _l : lang,
      _i : input,
      _f : format,
      _strict : strict
    }).utc();

    return m;
  };

  // creating with unix timestamp (in seconds)
  moment.unix = function (input) {
    return moment(input * 1000);
  };

  // duration
  moment.duration = function (input, key) {
    var isDuration = moment.isDuration(input),
      isNumber = (typeof input === 'number'),
      duration = (isDuration ? input._input : (isNumber ? {} : input)),
    // matching against regexp is expensive, do it on demand
      match = null,
      sign,
      ret,
      parseIso,
      timeEmpty,
      dateTimeEmpty;

    if (isNumber) {
      if (key) {
        duration[key] = input;
      } else {
        duration.milliseconds = input;
      }
    } else if (!!(match = aspNetTimeSpanJsonRegex.exec(input))) {
      sign = (match[1] === "-") ? -1 : 1;
      duration = {
        y: 0,
        d: toInt(match[DATE]) * sign,
        h: toInt(match[HOUR]) * sign,
        m: toInt(match[MINUTE]) * sign,
        s: toInt(match[SECOND]) * sign,
        ms: toInt(match[MILLISECOND]) * sign
      };
    } else if (!!(match = isoDurationRegex.exec(input))) {
      sign = (match[1] === "-") ? -1 : 1;
      parseIso = function (inp) {
        // We'd normally use ~~inp for this, but unfortunately it also
        // converts floats to ints.
        // inp may be undefined, so careful calling replace on it.
        var res = inp && parseFloat(inp.replace(',', '.'));
        // apply sign while we're at it
        return (isNaN(res) ? 0 : res) * sign;
      };
      duration = {
        y: parseIso(match[2]),
        M: parseIso(match[3]),
        d: parseIso(match[4]),
        h: parseIso(match[5]),
        m: parseIso(match[6]),
        s: parseIso(match[7]),
        w: parseIso(match[8])
      };
    }

    ret = new Duration(duration);

    if (isDuration && input.hasOwnProperty('_lang')) {
      ret._lang = input._lang;
    }

    return ret;
  };

  // version number
  moment.version = VERSION;

  // default format
  moment.defaultFormat = isoFormat;

  // This function will be called whenever a moment is mutated.
  // It is intended to keep the offset in sync with the timezone.
  moment.updateOffset = function () {};

  // This function will load languages and then set the global language.  If
  // no arguments are passed in, it will simply return the current global
  // language key.
  moment.lang = function (key, values) {
    var r;
    if (!key) {
      return moment.fn._lang._abbr;
    }
    if (values) {
      loadLang(normalizeLanguage(key), values);
    } else if (values === null) {
      unloadLang(key);
      key = 'en';
    } else if (!languages[key]) {
      getLangDefinition(key);
    }
    r = moment.duration.fn._lang = moment.fn._lang = getLangDefinition(key);
    return r._abbr;
  };

  // returns language data
  moment.langData = function (key) {
    if (key && key._lang && key._lang._abbr) {
      key = key._lang._abbr;
    }
    return getLangDefinition(key);
  };

  // compare moment object
  moment.isMoment = function (obj) {
    return obj instanceof Moment;
  };

  // for typechecking Duration objects
  moment.isDuration = function (obj) {
    return obj instanceof Duration;
  };

  for (i = lists.length - 1; i >= 0; --i) {
    makeList(lists[i]);
  }

  moment.normalizeUnits = function (units) {
    return normalizeUnits(units);
  };

  moment.invalid = function (flags) {
    var m = moment.utc(NaN);
    if (flags != null) {
      extend(m._pf, flags);
    }
    else {
      m._pf.userInvalidated = true;
    }

    return m;
  };

  moment.parseZone = function (input) {
    return moment(input).parseZone();
  };

  /************************************
   Moment Prototype
   ************************************/


  extend(moment.fn = Moment.prototype, {

    clone : function () {
      return moment(this);
    },

    valueOf : function () {
      return +this._d + ((this._offset || 0) * 60000);
    },

    unix : function () {
      return Math.floor(+this / 1000);
    },

    toString : function () {
      return this.clone().lang('en').format("ddd MMM DD YYYY HH:mm:ss [GMT]ZZ");
    },

    toDate : function () {
      return this._offset ? new Date(+this) : this._d;
    },

    toISOString : function () {
      return formatMoment(moment(this).utc(), 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]');
    },

    toArray : function () {
      var m = this;
      return [
        m.year(),
        m.month(),
        m.date(),
        m.hours(),
        m.minutes(),
        m.seconds(),
        m.milliseconds()
      ];
    },

    isValid : function () {
      return isValid(this);
    },

    isDSTShifted : function () {

      if (this._a) {
        return this.isValid() && compareArrays(this._a, (this._isUTC ? moment.utc(this._a) : moment(this._a)).toArray()) > 0;
      }

      return false;
    },

    parsingFlags : function () {
      return extend({}, this._pf);
    },

    invalidAt: function () {
      return this._pf.overflow;
    },

    utc : function () {
      return this.zone(0);
    },

    local : function () {
      this.zone(0);
      this._isUTC = false;
      return this;
    },

    format : function (inputString) {
      var output = formatMoment(this, inputString || moment.defaultFormat);
      return this.lang().postformat(output);
    },

    add : function (input, val) {
      var dur;
      // switch args to support add('s', 1) and add(1, 's')
      if (typeof input === 'string') {
        dur = moment.duration(+val, input);
      } else {
        dur = moment.duration(input, val);
      }
      addOrSubtractDurationFromMoment(this, dur, 1);
      return this;
    },

    subtract : function (input, val) {
      var dur;
      // switch args to support subtract('s', 1) and subtract(1, 's')
      if (typeof input === 'string') {
        dur = moment.duration(+val, input);
      } else {
        dur = moment.duration(input, val);
      }
      addOrSubtractDurationFromMoment(this, dur, -1);
      return this;
    },

    diff : function (input, units, asFloat) {
      var that = this._isUTC ? moment(input).zone(this._offset || 0) : moment(input).local(),
        zoneDiff = (this.zone() - that.zone()) * 6e4,
        diff, output;

      units = normalizeUnits(units);

      if (units === 'year' || units === 'month') {
        // average number of days in the months in the given dates
        diff = (this.daysInMonth() + that.daysInMonth()) * 432e5; // 24 * 60 * 60 * 1000 / 2
        // difference in months
        output = ((this.year() - that.year()) * 12) + (this.month() - that.month());
        // adjust by taking difference in days, average number of days
        // and dst in the given months.
        output += ((this - moment(this).startOf('month')) -
          (that - moment(that).startOf('month'))) / diff;
        // same as above but with zones, to negate all dst
        output -= ((this.zone() - moment(this).startOf('month').zone()) -
          (that.zone() - moment(that).startOf('month').zone())) * 6e4 / diff;
        if (units === 'year') {
          output = output / 12;
        }
      } else {
        diff = (this - that);
        output = units === 'second' ? diff / 1e3 : // 1000
          units === 'minute' ? diff / 6e4 : // 1000 * 60
            units === 'hour' ? diff / 36e5 : // 1000 * 60 * 60
              units === 'day' ? (diff - zoneDiff) / 864e5 : // 1000 * 60 * 60 * 24, negate dst
                units === 'week' ? (diff - zoneDiff) / 6048e5 : // 1000 * 60 * 60 * 24 * 7, negate dst
                  diff;
      }
      return asFloat ? output : absRound(output);
    },

    from : function (time, withoutSuffix) {
      return moment.duration(this.diff(time)).lang(this.lang()._abbr).humanize(!withoutSuffix);
    },

    fromNow : function (withoutSuffix) {
      return this.from(moment(), withoutSuffix);
    },

    calendar : function () {
      var diff = this.diff(moment().zone(this.zone()).startOf('day'), 'days', true),
        format = diff < -6 ? 'sameElse' :
          diff < -1 ? 'lastWeek' :
            diff < 0 ? 'lastDay' :
              diff < 1 ? 'sameDay' :
                diff < 2 ? 'nextDay' :
                  diff < 7 ? 'nextWeek' : 'sameElse';
      return this.format(this.lang().calendar(format, this));
    },

    isLeapYear : function () {
      return isLeapYear(this.year());
    },

    isDST : function () {
      return (this.zone() < this.clone().month(0).zone() ||
        this.zone() < this.clone().month(5).zone());
    },

    day : function (input) {
      var day = this._isUTC ? this._d.getUTCDay() : this._d.getDay();
      if (input != null) {
        input = parseWeekday(input, this.lang());
        return this.add({ d : input - day });
      } else {
        return day;
      }
    },

    month : function (input) {
      var utc = this._isUTC ? 'UTC' : '',
        dayOfMonth;

      if (input != null) {
        if (typeof input === 'string') {
          input = this.lang().monthsParse(input);
          if (typeof input !== 'number') {
            return this;
          }
        }

        dayOfMonth = this.date();
        this.date(1);
        this._d['set' + utc + 'Month'](input);
        this.date(Math.min(dayOfMonth, this.daysInMonth()));

        moment.updateOffset(this);
        return this;
      } else {
        return this._d['get' + utc + 'Month']();
      }
    },

    startOf: function (units) {
      units = normalizeUnits(units);
      // the following switch intentionally omits break keywords
      // to utilize falling through the cases.
      switch (units) {
        case 'year':
          this.month(0);
        /* falls through */
        case 'month':
          this.date(1);
        /* falls through */
        case 'week':
        case 'isoWeek':
        case 'day':
          this.hours(0);
        /* falls through */
        case 'hour':
          this.minutes(0);
        /* falls through */
        case 'minute':
          this.seconds(0);
        /* falls through */
        case 'second':
          this.milliseconds(0);
        /* falls through */
      }

      // weeks are a special case
      if (units === 'week') {
        this.weekday(0);
      } else if (units === 'isoWeek') {
        this.isoWeekday(1);
      }

      return this;
    },

    endOf: function (units) {
      units = normalizeUnits(units);
      return this.startOf(units).add((units === 'isoWeek' ? 'week' : units), 1).subtract('ms', 1);
    },

    isAfter: function (input, units) {
      units = typeof units !== 'undefined' ? units : 'millisecond';
      return +this.clone().startOf(units) > +moment(input).startOf(units);
    },

    isBefore: function (input, units) {
      units = typeof units !== 'undefined' ? units : 'millisecond';
      return +this.clone().startOf(units) < +moment(input).startOf(units);
    },

    isSame: function (input, units) {
      units = typeof units !== 'undefined' ? units : 'millisecond';
      return +this.clone().startOf(units) === +moment(input).startOf(units);
    },

    min: function (other) {
      other = moment.apply(null, arguments);
      return other < this ? this : other;
    },

    max: function (other) {
      other = moment.apply(null, arguments);
      return other > this ? this : other;
    },

    zone : function (input) {
      var offset = this._offset || 0;
      if (input != null) {
        if (typeof input === "string") {
          input = timezoneMinutesFromString(input);
        }
        if (Math.abs(input) < 16) {
          input = input * 60;
        }
        this._offset = input;
        this._isUTC = true;
        if (offset !== input) {
          addOrSubtractDurationFromMoment(this, moment.duration(offset - input, 'm'), 1, true);
        }
      } else {
        return this._isUTC ? offset : this._d.getTimezoneOffset();
      }
      return this;
    },

    zoneAbbr : function () {
      return this._isUTC ? "UTC" : "";
    },

    zoneName : function () {
      return this._isUTC ? "Coordinated Universal Time" : "";
    },

    parseZone : function () {
      if (typeof this._i === 'string') {
        this.zone(this._i);
      }
      return this;
    },

    hasAlignedHourOffset : function (input) {
      if (!input) {
        input = 0;
      }
      else {
        input = moment(input).zone();
      }

      return (this.zone() - input) % 60 === 0;
    },

    daysInMonth : function () {
      return daysInMonth(this.year(), this.month());
    },

    dayOfYear : function (input) {
      var dayOfYear = round((moment(this).startOf('day') - moment(this).startOf('year')) / 864e5) + 1;
      return input == null ? dayOfYear : this.add("d", (input - dayOfYear));
    },

    weekYear : function (input) {
      var year = weekOfYear(this, this.lang()._week.dow, this.lang()._week.doy).year;
      return input == null ? year : this.add("y", (input - year));
    },

    isoWeekYear : function (input) {
      var year = weekOfYear(this, 1, 4).year;
      return input == null ? year : this.add("y", (input - year));
    },

    week : function (input) {
      var week = this.lang().week(this);
      return input == null ? week : this.add("d", (input - week) * 7);
    },

    isoWeek : function (input) {
      var week = weekOfYear(this, 1, 4).week;
      return input == null ? week : this.add("d", (input - week) * 7);
    },

    weekday : function (input) {
      var weekday = (this.day() + 7 - this.lang()._week.dow) % 7;
      return input == null ? weekday : this.add("d", input - weekday);
    },

    isoWeekday : function (input) {
      // behaves the same as moment#day except
      // as a getter, returns 7 instead of 0 (1-7 range instead of 0-6)
      // as a setter, sunday should belong to the previous week.
      return input == null ? this.day() || 7 : this.day(this.day() % 7 ? input : input - 7);
    },

    get : function (units) {
      units = normalizeUnits(units);
      return this[units]();
    },

    set : function (units, value) {
      units = normalizeUnits(units);
      if (typeof this[units] === 'function') {
        this[units](value);
      }
      return this;
    },

    // If passed a language key, it will set the language for this
    // instance.  Otherwise, it will return the language configuration
    // variables for this instance.
    lang : function (key) {
      if (key === undefined) {
        return this._lang;
      } else {
        this._lang = getLangDefinition(key);
        return this;
      }
    }
  });

  // helper for adding shortcuts
  function makeGetterAndSetter(name, key) {
    moment.fn[name] = moment.fn[name + 's'] = function (input) {
      var utc = this._isUTC ? 'UTC' : '';
      if (input != null) {
        this._d['set' + utc + key](input);
        moment.updateOffset(this);
        return this;
      } else {
        return this._d['get' + utc + key]();
      }
    };
  }

  // loop through and add shortcuts (Month, Date, Hours, Minutes, Seconds, Milliseconds)
  for (i = 0; i < proxyGettersAndSetters.length; i ++) {
    makeGetterAndSetter(proxyGettersAndSetters[i].toLowerCase().replace(/s$/, ''), proxyGettersAndSetters[i]);
  }

  // add shortcut for year (uses different syntax than the getter/setter 'year' == 'FullYear')
  makeGetterAndSetter('year', 'FullYear');

  // add plural methods
  moment.fn.days = moment.fn.day;
  moment.fn.months = moment.fn.month;
  moment.fn.weeks = moment.fn.week;
  moment.fn.isoWeeks = moment.fn.isoWeek;

  // add aliased format methods
  moment.fn.toJSON = moment.fn.toISOString;

  /************************************
   Duration Prototype
   ************************************/


  extend(moment.duration.fn = Duration.prototype, {

    _bubble : function () {
      var milliseconds = this._milliseconds,
        days = this._days,
        months = this._months,
        data = this._data,
        seconds, minutes, hours, years;

      // The following code bubbles up values, see the tests for
      // examples of what that means.
      data.milliseconds = milliseconds % 1000;

      seconds = absRound(milliseconds / 1000);
      data.seconds = seconds % 60;

      minutes = absRound(seconds / 60);
      data.minutes = minutes % 60;

      hours = absRound(minutes / 60);
      data.hours = hours % 24;

      days += absRound(hours / 24);
      data.days = days % 30;

      months += absRound(days / 30);
      data.months = months % 12;

      years = absRound(months / 12);
      data.years = years;
    },

    weeks : function () {
      return absRound(this.days() / 7);
    },

    valueOf : function () {
      return this._milliseconds +
        this._days * 864e5 +
        (this._months % 12) * 2592e6 +
        toInt(this._months / 12) * 31536e6;
    },

    humanize : function (withSuffix) {
      var difference = +this,
        output = relativeTime(difference, !withSuffix, this.lang());

      if (withSuffix) {
        output = this.lang().pastFuture(difference, output);
      }

      return this.lang().postformat(output);
    },

    add : function (input, val) {
      // supports only 2.0-style add(1, 's') or add(moment)
      var dur = moment.duration(input, val);

      this._milliseconds += dur._milliseconds;
      this._days += dur._days;
      this._months += dur._months;

      this._bubble();

      return this;
    },

    subtract : function (input, val) {
      var dur = moment.duration(input, val);

      this._milliseconds -= dur._milliseconds;
      this._days -= dur._days;
      this._months -= dur._months;

      this._bubble();

      return this;
    },

    get : function (units) {
      units = normalizeUnits(units);
      return this[units.toLowerCase() + 's']();
    },

    as : function (units) {
      units = normalizeUnits(units);
      return this['as' + units.charAt(0).toUpperCase() + units.slice(1) + 's']();
    },

    lang : moment.fn.lang,

    toIsoString : function () {
      // inspired by https://github.com/dordille/moment-isoduration/blob/master/moment.isoduration.js
      var years = Math.abs(this.years()),
        months = Math.abs(this.months()),
        days = Math.abs(this.days()),
        hours = Math.abs(this.hours()),
        minutes = Math.abs(this.minutes()),
        seconds = Math.abs(this.seconds() + this.milliseconds() / 1000);

      if (!this.asSeconds()) {
        // this is the same as C#'s (Noda) and python (isodate)...
        // but not other JS (goog.date)
        return 'P0D';
      }

      return (this.asSeconds() < 0 ? '-' : '') +
        'P' +
        (years ? years + 'Y' : '') +
        (months ? months + 'M' : '') +
        (days ? days + 'D' : '') +
        ((hours || minutes || seconds) ? 'T' : '') +
        (hours ? hours + 'H' : '') +
        (minutes ? minutes + 'M' : '') +
        (seconds ? seconds + 'S' : '');
    }
  });

  function makeDurationGetter(name) {
    moment.duration.fn[name] = function () {
      return this._data[name];
    };
  }

  function makeDurationAsGetter(name, factor) {
    moment.duration.fn['as' + name] = function () {
      return +this / factor;
    };
  }

  for (i in unitMillisecondFactors) {
    if (unitMillisecondFactors.hasOwnProperty(i)) {
      makeDurationAsGetter(i, unitMillisecondFactors[i]);
      makeDurationGetter(i.toLowerCase());
    }
  }

  makeDurationAsGetter('Weeks', 6048e5);
  moment.duration.fn.asMonths = function () {
    return (+this - this.years() * 31536e6) / 2592e6 + this.years() * 12;
  };


  /************************************
   Default Lang
   ************************************/


    // Set default language, other languages will inherit from English.
  moment.lang('en', {
    ordinal : function (number) {
      var b = number % 10,
        output = (toInt(number % 100 / 10) === 1) ? 'th' :
          (b === 1) ? 'st' :
            (b === 2) ? 'nd' :
              (b === 3) ? 'rd' : 'th';
      return number + output;
    }
  });

  // moment.js language configuration
// language : Moroccan Arabic (ar-ma)
// author : ElFadili Yassine : https://github.com/ElFadiliY
// author : Abdel Said : https://github.com/abdelsaid

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('ar-ma', {
      months : "ÙŠÙ†Ø§ÙŠØ±_ÙØ¨Ø±Ø§ÙŠØ±_Ù…Ø§Ø±Ø³_Ø£Ø¨Ø±ÙŠÙ„_Ù…Ø§ÙŠ_ÙŠÙˆÙ†ÙŠÙˆ_ÙŠÙˆÙ„ÙŠÙˆØ²_ØºØ´Øª_Ø´ØªÙ†Ø¨Ø±_Ø£ÙƒØªÙˆØ¨Ø±_Ù†ÙˆÙ†Ø¨Ø±_Ø¯Ø¬Ù†Ø¨Ø±".split("_"),
      monthsShort : "ÙŠÙ†Ø§ÙŠØ±_ÙØ¨Ø±Ø§ÙŠØ±_Ù…Ø§Ø±Ø³_Ø£Ø¨Ø±ÙŠÙ„_Ù…Ø§ÙŠ_ÙŠÙˆÙ†ÙŠÙˆ_ÙŠÙˆÙ„ÙŠÙˆØ²_ØºØ´Øª_Ø´ØªÙ†Ø¨Ø±_Ø£ÙƒØªÙˆØ¨Ø±_Ù†ÙˆÙ†Ø¨Ø±_Ø¯Ø¬Ù†Ø¨Ø±".split("_"),
      weekdays : "Ø§Ù„Ø£Ø­Ø¯_Ø§Ù„Ø¥ØªÙ†ÙŠÙ†_Ø§Ù„Ø«Ù„Ø§Ø«Ø§Ø¡_Ø§Ù„Ø£Ø±Ø¨Ø¹Ø§Ø¡_Ø§Ù„Ø®Ù…ÙŠØ³_Ø§Ù„Ø¬Ù…Ø¹Ø©_Ø§Ù„Ø³Ø¨Øª".split("_"),
      weekdaysShort : "Ø§Ø­Ø¯_Ø§ØªÙ†ÙŠÙ†_Ø«Ù„Ø§Ø«Ø§Ø¡_Ø§Ø±Ø¨Ø¹Ø§Ø¡_Ø®Ù…ÙŠØ³_Ø¬Ù…Ø¹Ø©_Ø³Ø¨Øª".split("_"),
      weekdaysMin : "Ø­_Ù†_Ø«_Ø±_Ø®_Ø¬_Ø³".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd D MMMM YYYY LT"
      },
      calendar : {
        sameDay: "[Ø§Ù„ÙŠÙˆÙ… Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT",
        nextDay: '[ØºØ¯Ø§ Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
        nextWeek: 'dddd [Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
        lastDay: '[Ø£Ù…Ø³ Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
        lastWeek: 'dddd [Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
        sameElse: 'L'
      },
      relativeTime : {
        future : "ÙÙŠ %s",
        past : "Ù…Ù†Ø° %s",
        s : "Ø«ÙˆØ§Ù†",
        m : "Ø¯Ù‚ÙŠÙ‚Ø©",
        mm : "%d Ø¯Ù‚Ø§Ø¦Ù‚",
        h : "Ø³Ø§Ø¹Ø©",
        hh : "%d Ø³Ø§Ø¹Ø§Øª",
        d : "ÙŠÙˆÙ…",
        dd : "%d Ø£ÙŠØ§Ù…",
        M : "Ø´Ù‡Ø±",
        MM : "%d Ø£Ø´Ù‡Ø±",
        y : "Ø³Ù†Ø©",
        yy : "%d Ø³Ù†ÙˆØ§Øª"
      },
      week : {
        dow : 6, // Saturday is the first day of the week.
        doy : 12  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : Arabic (ar)
// author : Abdel Said : https://github.com/abdelsaid
// changes in months, weekdays : Ahmed Elkhatib

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('ar', {
      months : "ÙŠÙ†Ø§ÙŠØ±/ ÙƒØ§Ù†ÙˆÙ† Ø§Ù„Ø«Ø§Ù†ÙŠ_ÙØ¨Ø±Ø§ÙŠØ±/ Ø´Ø¨Ø§Ø·_Ù…Ø§Ø±Ø³/ Ø¢Ø°Ø§Ø±_Ø£Ø¨Ø±ÙŠÙ„/ Ù†ÙŠØ³Ø§Ù†_Ù…Ø§ÙŠÙˆ/ Ø£ÙŠØ§Ø±_ÙŠÙˆÙ†ÙŠÙˆ/ Ø­Ø²ÙŠØ±Ø§Ù†_ÙŠÙˆÙ„ÙŠÙˆ/ ØªÙ…ÙˆØ²_Ø£ØºØ³Ø·Ø³/ Ø¢Ø¨_Ø³Ø¨ØªÙ…Ø¨Ø±/ Ø£ÙŠÙ„ÙˆÙ„_Ø£ÙƒØªÙˆØ¨Ø±/ ØªØ´Ø±ÙŠÙ† Ø§Ù„Ø£ÙˆÙ„_Ù†ÙˆÙÙ…Ø¨Ø±/ ØªØ´Ø±ÙŠÙ† Ø§Ù„Ø«Ø§Ù†ÙŠ_Ø¯ÙŠØ³Ù…Ø¨Ø±/ ÙƒØ§Ù†ÙˆÙ† Ø§Ù„Ø£ÙˆÙ„".split("_"),
      monthsShort : "ÙŠÙ†Ø§ÙŠØ±/ ÙƒØ§Ù†ÙˆÙ† Ø§Ù„Ø«Ø§Ù†ÙŠ_ÙØ¨Ø±Ø§ÙŠØ±/ Ø´Ø¨Ø§Ø·_Ù…Ø§Ø±Ø³/ Ø¢Ø°Ø§Ø±_Ø£Ø¨Ø±ÙŠÙ„/ Ù†ÙŠØ³Ø§Ù†_Ù…Ø§ÙŠÙˆ/ Ø£ÙŠØ§Ø±_ÙŠÙˆÙ†ÙŠÙˆ/ Ø­Ø²ÙŠØ±Ø§Ù†_ÙŠÙˆÙ„ÙŠÙˆ/ ØªÙ…ÙˆØ²_Ø£ØºØ³Ø·Ø³/ Ø¢Ø¨_Ø³Ø¨ØªÙ…Ø¨Ø±/ Ø£ÙŠÙ„ÙˆÙ„_Ø£ÙƒØªÙˆØ¨Ø±/ ØªØ´Ø±ÙŠÙ† Ø§Ù„Ø£ÙˆÙ„_Ù†ÙˆÙÙ…Ø¨Ø±/ ØªØ´Ø±ÙŠÙ† Ø§Ù„Ø«Ø§Ù†ÙŠ_Ø¯ÙŠØ³Ù…Ø¨Ø±/ ÙƒØ§Ù†ÙˆÙ† Ø§Ù„Ø£ÙˆÙ„".split("_"),
      weekdays : "Ø§Ù„Ø£Ø­Ø¯_Ø§Ù„Ø¥Ø«Ù†ÙŠÙ†_Ø§Ù„Ø«Ù„Ø§Ø«Ø§Ø¡_Ø§Ù„Ø£Ø±Ø¨Ø¹Ø§Ø¡_Ø§Ù„Ø®Ù…ÙŠØ³_Ø§Ù„Ø¬Ù…Ø¹Ø©_Ø§Ù„Ø³Ø¨Øª".split("_"),
      weekdaysShort : "Ø§Ù„Ø£Ø­Ø¯_Ø§Ù„Ø¥Ø«Ù†ÙŠÙ†_Ø§Ù„Ø«Ù„Ø§Ø«Ø§Ø¡_Ø§Ù„Ø£Ø±Ø¨Ø¹Ø§Ø¡_Ø§Ù„Ø®Ù…ÙŠØ³_Ø§Ù„Ø¬Ù…Ø¹Ø©_Ø§Ù„Ø³Ø¨Øª".split("_"),
      weekdaysMin : "Ø­_Ù†_Ø«_Ø±_Ø®_Ø¬_Ø³".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd D MMMM YYYY LT"
      },
      calendar : {
        sameDay: "[Ø§Ù„ÙŠÙˆÙ… Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT",
        nextDay: '[ØºØ¯Ø§ Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
        nextWeek: 'dddd [Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
        lastDay: '[Ø£Ù…Ø³ Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
        lastWeek: 'dddd [Ø¹Ù„Ù‰ Ø§Ù„Ø³Ø§Ø¹Ø©] LT',
        sameElse: 'L'
      },
      relativeTime : {
        future : "ÙÙŠ %s",
        past : "Ù…Ù†Ø° %s",
        s : "Ø«ÙˆØ§Ù†",
        m : "Ø¯Ù‚ÙŠÙ‚Ø©",
        mm : "%d Ø¯Ù‚Ø§Ø¦Ù‚",
        h : "Ø³Ø§Ø¹Ø©",
        hh : "%d Ø³Ø§Ø¹Ø§Øª",
        d : "ÙŠÙˆÙ…",
        dd : "%d Ø£ÙŠØ§Ù…",
        M : "Ø´Ù‡Ø±",
        MM : "%d Ø£Ø´Ù‡Ø±",
        y : "Ø³Ù†Ø©",
        yy : "%d Ø³Ù†ÙˆØ§Øª"
      },
      week : {
        dow : 6, // Saturday is the first day of the week.
        doy : 12  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : bulgarian (bg)
// author : Krasen Borisov : https://github.com/kraz

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('bg', {
      months : "ÑÐ½ÑƒÐ°Ñ€Ð¸_Ñ„ÐµÐ²Ñ€ÑƒÐ°Ñ€Ð¸_Ð¼Ð°Ñ€Ñ‚_Ð°Ð¿Ñ€Ð¸Ð»_Ð¼Ð°Ð¹_ÑŽÐ½Ð¸_ÑŽÐ»Ð¸_Ð°Ð²Ð³ÑƒÑÑ‚_ÑÐµÐ¿Ñ‚ÐµÐ¼Ð²Ñ€Ð¸_Ð¾ÐºÑ‚Ð¾Ð¼Ð²Ñ€Ð¸_Ð½Ð¾ÐµÐ¼Ð²Ñ€Ð¸_Ð´ÐµÐºÐµÐ¼Ð²Ñ€Ð¸".split("_"),
      monthsShort : "ÑÐ½Ñ€_Ñ„ÐµÐ²_Ð¼Ð°Ñ€_Ð°Ð¿Ñ€_Ð¼Ð°Ð¹_ÑŽÐ½Ð¸_ÑŽÐ»Ð¸_Ð°Ð²Ð³_ÑÐµÐ¿_Ð¾ÐºÑ‚_Ð½Ð¾Ðµ_Ð´ÐµÐº".split("_"),
      weekdays : "Ð½ÐµÐ´ÐµÐ»Ñ_Ð¿Ð¾Ð½ÐµÐ´ÐµÐ»Ð½Ð¸Ðº_Ð²Ñ‚Ð¾Ñ€Ð½Ð¸Ðº_ÑÑ€ÑÐ´Ð°_Ñ‡ÐµÑ‚Ð²ÑŠÑ€Ñ‚ÑŠÐº_Ð¿ÐµÑ‚ÑŠÐº_ÑÑŠÐ±Ð¾Ñ‚Ð°".split("_"),
      weekdaysShort : "Ð½ÐµÐ´_Ð¿Ð¾Ð½_Ð²Ñ‚Ð¾_ÑÑ€Ñ_Ñ‡ÐµÑ‚_Ð¿ÐµÑ‚_ÑÑŠÐ±".split("_"),
      weekdaysMin : "Ð½Ð´_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),
      longDateFormat : {
        LT : "H:mm",
        L : "D.MM.YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd, D MMMM YYYY LT"
      },
      calendar : {
        sameDay : '[Ð”Ð½ÐµÑ Ð²] LT',
        nextDay : '[Ð£Ñ‚Ñ€Ðµ Ð²] LT',
        nextWeek : 'dddd [Ð²] LT',
        lastDay : '[Ð’Ñ‡ÐµÑ€Ð° Ð²] LT',
        lastWeek : function () {
          switch (this.day()) {
            case 0:
            case 3:
            case 6:
              return '[Ð’ Ð¸Ð·Ð¼Ð¸Ð½Ð°Ð»Ð°Ñ‚Ð°] dddd [Ð²] LT';
            case 1:
            case 2:
            case 4:
            case 5:
              return '[Ð’ Ð¸Ð·Ð¼Ð¸Ð½Ð°Ð»Ð¸Ñ] dddd [Ð²] LT';
          }
        },
        sameElse : 'L'
      },
      relativeTime : {
        future : "ÑÐ»ÐµÐ´ %s",
        past : "Ð¿Ñ€ÐµÐ´Ð¸ %s",
        s : "Ð½ÑÐºÐ¾Ð»ÐºÐ¾ ÑÐµÐºÑƒÐ½Ð´Ð¸",
        m : "Ð¼Ð¸Ð½ÑƒÑ‚Ð°",
        mm : "%d Ð¼Ð¸Ð½ÑƒÑ‚Ð¸",
        h : "Ñ‡Ð°Ñ",
        hh : "%d Ñ‡Ð°ÑÐ°",
        d : "Ð´ÐµÐ½",
        dd : "%d Ð´Ð½Ð¸",
        M : "Ð¼ÐµÑÐµÑ†",
        MM : "%d Ð¼ÐµÑÐµÑ†Ð°",
        y : "Ð³Ð¾Ð´Ð¸Ð½Ð°",
        yy : "%d Ð³Ð¾Ð´Ð¸Ð½Ð¸"
      },
      ordinal : function (number) {
        var lastDigit = number % 10,
          last2Digits = number % 100;
        if (number === 0) {
          return number + '-ÐµÐ²';
        } else if (last2Digits === 0) {
          return number + '-ÐµÐ½';
        } else if (last2Digits > 10 && last2Digits < 20) {
          return number + '-Ñ‚Ð¸';
        } else if (lastDigit === 1) {
          return number + '-Ð²Ð¸';
        } else if (lastDigit === 2) {
          return number + '-Ñ€Ð¸';
        } else if (lastDigit === 7 || lastDigit === 8) {
          return number + '-Ð¼Ð¸';
        } else {
          return number + '-Ñ‚Ð¸';
        }
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : breton (br)
// author : Jean-Baptiste Le Duigou : https://github.com/jbleduigou

  (function (factory) {
    factory(moment);
  }(function (moment) {
    function relativeTimeWithMutation(number, withoutSuffix, key) {
      var format = {
        'mm': "munutenn",
        'MM': "miz",
        'dd': "devezh"
      };
      return number + ' ' + mutation(format[key], number);
    }

    function specialMutationForYears(number) {
      switch (lastNumber(number)) {
        case 1:
        case 3:
        case 4:
        case 5:
        case 9:
          return number + ' bloaz';
        default:
          return number + ' vloaz';
      }
    }

    function lastNumber(number) {
      if (number > 9) {
        return lastNumber(number % 10);
      }
      return number;
    }

    function mutation(text, number) {
      if (number === 2) {
        return softMutation(text);
      }
      return text;
    }

    function softMutation(text) {
      var mutationTable = {
        'm': 'v',
        'b': 'v',
        'd': 'z'
      };
      if (mutationTable[text.charAt(0)] === undefined) {
        return text;
      }
      return mutationTable[text.charAt(0)] + text.substring(1);
    }

    return moment.lang('br', {
      months : "Genver_C'hwevrer_Meurzh_Ebrel_Mae_Mezheven_Gouere_Eost_Gwengolo_Here_Du_Kerzu".split("_"),
      monthsShort : "Gen_C'hwe_Meu_Ebr_Mae_Eve_Gou_Eos_Gwe_Her_Du_Ker".split("_"),
      weekdays : "Sul_Lun_Meurzh_Merc'her_Yaou_Gwener_Sadorn".split("_"),
      weekdaysShort : "Sul_Lun_Meu_Mer_Yao_Gwe_Sad".split("_"),
      weekdaysMin : "Su_Lu_Me_Mer_Ya_Gw_Sa".split("_"),
      longDateFormat : {
        LT : "h[e]mm A",
        L : "DD/MM/YYYY",
        LL : "D [a viz] MMMM YYYY",
        LLL : "D [a viz] MMMM YYYY LT",
        LLLL : "dddd, D [a viz] MMMM YYYY LT"
      },
      calendar : {
        sameDay : '[Hiziv da] LT',
        nextDay : '[Warc\'hoazh da] LT',
        nextWeek : 'dddd [da] LT',
        lastDay : '[Dec\'h da] LT',
        lastWeek : 'dddd [paset da] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "a-benn %s",
        past : "%s 'zo",
        s : "un nebeud segondennoÃ¹",
        m : "ur vunutenn",
        mm : relativeTimeWithMutation,
        h : "un eur",
        hh : "%d eur",
        d : "un devezh",
        dd : relativeTimeWithMutation,
        M : "ur miz",
        MM : relativeTimeWithMutation,
        y : "ur bloaz",
        yy : specialMutationForYears
      },
      ordinal : function (number) {
        var output = (number === 1) ? 'aÃ±' : 'vet';
        return number + output;
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : bosnian (bs)
// author : Nedim Cholich : https://github.com/frontyard
// based on (hr) translation by Bojan MarkoviÄ‡

  (function (factory) {
    factory(moment);
  }(function (moment) {

    function translate(number, withoutSuffix, key) {
      var result = number + " ";
      switch (key) {
        case 'm':
          return withoutSuffix ? 'jedna minuta' : 'jedne minute';
        case 'mm':
          if (number === 1) {
            result += 'minuta';
          } else if (number === 2 || number === 3 || number === 4) {
            result += 'minute';
          } else {
            result += 'minuta';
          }
          return result;
        case 'h':
          return withoutSuffix ? 'jedan sat' : 'jednog sata';
        case 'hh':
          if (number === 1) {
            result += 'sat';
          } else if (number === 2 || number === 3 || number === 4) {
            result += 'sata';
          } else {
            result += 'sati';
          }
          return result;
        case 'dd':
          if (number === 1) {
            result += 'dan';
          } else {
            result += 'dana';
          }
          return result;
        case 'MM':
          if (number === 1) {
            result += 'mjesec';
          } else if (number === 2 || number === 3 || number === 4) {
            result += 'mjeseca';
          } else {
            result += 'mjeseci';
          }
          return result;
        case 'yy':
          if (number === 1) {
            result += 'godina';
          } else if (number === 2 || number === 3 || number === 4) {
            result += 'godine';
          } else {
            result += 'godina';
          }
          return result;
      }
    }

    return moment.lang('bs', {
      months : "januar_februar_mart_april_maj_juni_juli_avgust_septembar_oktobar_novembar_decembar".split("_"),
      monthsShort : "jan._feb._mar._apr._maj._jun._jul._avg._sep._okt._nov._dec.".split("_"),
      weekdays : "nedjelja_ponedjeljak_utorak_srijeda_Äetvrtak_petak_subota".split("_"),
      weekdaysShort : "ned._pon._uto._sri._Äet._pet._sub.".split("_"),
      weekdaysMin : "ne_po_ut_sr_Äe_pe_su".split("_"),
      longDateFormat : {
        LT : "H:mm",
        L : "DD. MM. YYYY",
        LL : "D. MMMM YYYY",
        LLL : "D. MMMM YYYY LT",
        LLLL : "dddd, D. MMMM YYYY LT"
      },
      calendar : {
        sameDay  : '[danas u] LT',
        nextDay  : '[sutra u] LT',

        nextWeek : function () {
          switch (this.day()) {
            case 0:
              return '[u] [nedjelju] [u] LT';
            case 3:
              return '[u] [srijedu] [u] LT';
            case 6:
              return '[u] [subotu] [u] LT';
            case 1:
            case 2:
            case 4:
            case 5:
              return '[u] dddd [u] LT';
          }
        },
        lastDay  : '[juÄer u] LT',
        lastWeek : function () {
          switch (this.day()) {
            case 0:
            case 3:
              return '[proÅ¡lu] dddd [u] LT';
            case 6:
              return '[proÅ¡le] [subote] [u] LT';
            case 1:
            case 2:
            case 4:
            case 5:
              return '[proÅ¡li] dddd [u] LT';
          }
        },
        sameElse : 'L'
      },
      relativeTime : {
        future : "za %s",
        past   : "prije %s",
        s      : "par sekundi",
        m      : translate,
        mm     : translate,
        h      : translate,
        hh     : translate,
        d      : "dan",
        dd     : translate,
        M      : "mjesec",
        MM     : translate,
        y      : "godinu",
        yy     : translate
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : catalan (ca)
// author : Juan G. Hurtado : https://github.com/juanghurtado

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('ca', {
      months : "Gener_Febrer_MarÃ§_Abril_Maig_Juny_Juliol_Agost_Setembre_Octubre_Novembre_Desembre".split("_"),
      monthsShort : "Gen._Febr._Mar._Abr._Mai._Jun._Jul._Ag._Set._Oct._Nov._Des.".split("_"),
      weekdays : "Diumenge_Dilluns_Dimarts_Dimecres_Dijous_Divendres_Dissabte".split("_"),
      weekdaysShort : "Dg._Dl._Dt._Dc._Dj._Dv._Ds.".split("_"),
      weekdaysMin : "Dg_Dl_Dt_Dc_Dj_Dv_Ds".split("_"),
      longDateFormat : {
        LT : "H:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd D MMMM YYYY LT"
      },
      calendar : {
        sameDay : function () {
          return '[avui a ' + ((this.hours() !== 1) ? 'les' : 'la') + '] LT';
        },
        nextDay : function () {
          return '[demÃ  a ' + ((this.hours() !== 1) ? 'les' : 'la') + '] LT';
        },
        nextWeek : function () {
          return 'dddd [a ' + ((this.hours() !== 1) ? 'les' : 'la') + '] LT';
        },
        lastDay : function () {
          return '[ahir a ' + ((this.hours() !== 1) ? 'les' : 'la') + '] LT';
        },
        lastWeek : function () {
          return '[el] dddd [passat a ' + ((this.hours() !== 1) ? 'les' : 'la') + '] LT';
        },
        sameElse : 'L'
      },
      relativeTime : {
        future : "en %s",
        past : "fa %s",
        s : "uns segons",
        m : "un minut",
        mm : "%d minuts",
        h : "una hora",
        hh : "%d hores",
        d : "un dia",
        dd : "%d dies",
        M : "un mes",
        MM : "%d mesos",
        y : "un any",
        yy : "%d anys"
      },
      ordinal : '%dÂº',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : czech (cs)
// author : petrbela : https://github.com/petrbela

  (function (factory) {
    factory(moment);
  }(function (moment) {
    var months = "leden_Ãºnor_bÅ™ezen_duben_kvÄ›ten_Äerven_Äervenec_srpen_zÃ¡Å™Ã­_Å™Ã­jen_listopad_prosinec".split("_"),
      monthsShort = "led_Ãºno_bÅ™e_dub_kvÄ›_Ävn_Ävc_srp_zÃ¡Å™_Å™Ã­j_lis_pro".split("_");

    function plural(n) {
      return (n > 1) && (n < 5) && (~~(n / 10) !== 1);
    }

    function translate(number, withoutSuffix, key, isFuture) {
      var result = number + " ";
      switch (key) {
        case 's':  // a few seconds / in a few seconds / a few seconds ago
          return (withoutSuffix || isFuture) ? 'pÃ¡r vteÅ™in' : 'pÃ¡r vteÅ™inami';
        case 'm':  // a minute / in a minute / a minute ago
          return withoutSuffix ? 'minuta' : (isFuture ? 'minutu' : 'minutou');
        case 'mm': // 9 minutes / in 9 minutes / 9 minutes ago
          if (withoutSuffix || isFuture) {
            return result + (plural(number) ? 'minuty' : 'minut');
          } else {
            return result + 'minutami';
          }
          break;
        case 'h':  // an hour / in an hour / an hour ago
          return withoutSuffix ? 'hodina' : (isFuture ? 'hodinu' : 'hodinou');
        case 'hh': // 9 hours / in 9 hours / 9 hours ago
          if (withoutSuffix || isFuture) {
            return result + (plural(number) ? 'hodiny' : 'hodin');
          } else {
            return result + 'hodinami';
          }
          break;
        case 'd':  // a day / in a day / a day ago
          return (withoutSuffix || isFuture) ? 'den' : 'dnem';
        case 'dd': // 9 days / in 9 days / 9 days ago
          if (withoutSuffix || isFuture) {
            return result + (plural(number) ? 'dny' : 'dnÃ­');
          } else {
            return result + 'dny';
          }
          break;
        case 'M':  // a month / in a month / a month ago
          return (withoutSuffix || isFuture) ? 'mÄ›sÃ­c' : 'mÄ›sÃ­cem';
        case 'MM': // 9 months / in 9 months / 9 months ago
          if (withoutSuffix || isFuture) {
            return result + (plural(number) ? 'mÄ›sÃ­ce' : 'mÄ›sÃ­cÅ¯');
          } else {
            return result + 'mÄ›sÃ­ci';
          }
          break;
        case 'y':  // a year / in a year / a year ago
          return (withoutSuffix || isFuture) ? 'rok' : 'rokem';
        case 'yy': // 9 years / in 9 years / 9 years ago
          if (withoutSuffix || isFuture) {
            return result + (plural(number) ? 'roky' : 'let');
          } else {
            return result + 'lety';
          }
          break;
      }
    }

    return moment.lang('cs', {
      months : months,
      monthsShort : monthsShort,
      monthsParse : (function (months, monthsShort) {
        var i, _monthsParse = [];
        for (i = 0; i < 12; i++) {
          // use custom parser to solve problem with July (Äervenec)
          _monthsParse[i] = new RegExp('^' + months[i] + '$|^' + monthsShort[i] + '$', 'i');
        }
        return _monthsParse;
      }(months, monthsShort)),
      weekdays : "nedÄ›le_pondÄ›lÃ­_ÃºterÃ½_stÅ™eda_Ätvrtek_pÃ¡tek_sobota".split("_"),
      weekdaysShort : "ne_po_Ãºt_st_Ät_pÃ¡_so".split("_"),
      weekdaysMin : "ne_po_Ãºt_st_Ät_pÃ¡_so".split("_"),
      longDateFormat : {
        LT: "H:mm",
        L : "DD.MM.YYYY",
        LL : "D. MMMM YYYY",
        LLL : "D. MMMM YYYY LT",
        LLLL : "dddd D. MMMM YYYY LT"
      },
      calendar : {
        sameDay: "[dnes v] LT",
        nextDay: '[zÃ­tra v] LT',
        nextWeek: function () {
          switch (this.day()) {
            case 0:
              return '[v nedÄ›li v] LT';
            case 1:
            case 2:
              return '[v] dddd [v] LT';
            case 3:
              return '[ve stÅ™edu v] LT';
            case 4:
              return '[ve Ätvrtek v] LT';
            case 5:
              return '[v pÃ¡tek v] LT';
            case 6:
              return '[v sobotu v] LT';
          }
        },
        lastDay: '[vÄera v] LT',
        lastWeek: function () {
          switch (this.day()) {
            case 0:
              return '[minulou nedÄ›li v] LT';
            case 1:
            case 2:
              return '[minulÃ©] dddd [v] LT';
            case 3:
              return '[minulou stÅ™edu v] LT';
            case 4:
            case 5:
              return '[minulÃ½] dddd [v] LT';
            case 6:
              return '[minulou sobotu v] LT';
          }
        },
        sameElse: "L"
      },
      relativeTime : {
        future : "za %s",
        past : "pÅ™ed %s",
        s : translate,
        m : translate,
        mm : translate,
        h : translate,
        hh : translate,
        d : translate,
        dd : translate,
        M : translate,
        MM : translate,
        y : translate,
        yy : translate
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : chuvash (cv)
// author : Anatoly Mironov : https://github.com/mirontoli

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('cv', {
      months : "ÐºÄƒÑ€Ð»Ð°Ñ‡_Ð½Ð°Ñ€ÄƒÑ_Ð¿ÑƒÑˆ_Ð°ÐºÐ°_Ð¼Ð°Ð¹_Ã§Ä•Ñ€Ñ‚Ð¼Ðµ_ÑƒÑ‚Äƒ_Ã§ÑƒÑ€Ð»Ð°_Ð°Ð²ÄƒÐ½_ÑŽÐ¿Ð°_Ñ‡Ó³Ðº_Ñ€Ð°ÑˆÑ‚Ð°Ð²".split("_"),
      monthsShort : "ÐºÄƒÑ€_Ð½Ð°Ñ€_Ð¿ÑƒÑˆ_Ð°ÐºÐ°_Ð¼Ð°Ð¹_Ã§Ä•Ñ€_ÑƒÑ‚Äƒ_Ã§ÑƒÑ€_Ð°Ð²_ÑŽÐ¿Ð°_Ñ‡Ó³Ðº_Ñ€Ð°Ñˆ".split("_"),
      weekdays : "Ð²Ñ‹Ñ€ÑÐ°Ñ€Ð½Ð¸ÐºÑƒÐ½_Ñ‚ÑƒÐ½Ñ‚Ð¸ÐºÑƒÐ½_Ñ‹Ñ‚Ð»Ð°Ñ€Ð¸ÐºÑƒÐ½_ÑŽÐ½ÐºÑƒÐ½_ÐºÄ•Ã§Ð½ÐµÑ€Ð½Ð¸ÐºÑƒÐ½_ÑÑ€Ð½ÐµÐºÑƒÐ½_ÑˆÄƒÐ¼Ð°Ñ‚ÐºÑƒÐ½".split("_"),
      weekdaysShort : "Ð²Ñ‹Ñ€_Ñ‚ÑƒÐ½_Ñ‹Ñ‚Ð»_ÑŽÐ½_ÐºÄ•Ã§_ÑÑ€Ð½_ÑˆÄƒÐ¼".split("_"),
      weekdaysMin : "Ð²Ñ€_Ñ‚Ð½_Ñ‹Ñ‚_ÑŽÐ½_ÐºÃ§_ÑÑ€_ÑˆÐ¼".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD-MM-YYYY",
        LL : "YYYY [Ã§ÑƒÐ»Ñ…Ð¸] MMMM [ÑƒÐ¹ÄƒÑ…Ä•Ð½] D[-Ð¼Ä•ÑˆÄ•]",
        LLL : "YYYY [Ã§ÑƒÐ»Ñ…Ð¸] MMMM [ÑƒÐ¹ÄƒÑ…Ä•Ð½] D[-Ð¼Ä•ÑˆÄ•], LT",
        LLLL : "dddd, YYYY [Ã§ÑƒÐ»Ñ…Ð¸] MMMM [ÑƒÐ¹ÄƒÑ…Ä•Ð½] D[-Ð¼Ä•ÑˆÄ•], LT"
      },
      calendar : {
        sameDay: '[ÐŸÐ°ÑÐ½] LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]',
        nextDay: '[Ð«Ñ€Ð°Ð½] LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]',
        lastDay: '[Ä”Ð½ÐµÑ€] LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]',
        nextWeek: '[Ã‡Ð¸Ñ‚ÐµÑ] dddd LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]',
        lastWeek: '[Ð˜Ñ€Ñ‚Ð½Ä•] dddd LT [ÑÐµÑ…ÐµÑ‚Ñ€Ðµ]',
        sameElse: 'L'
      },
      relativeTime : {
        future : function (output) {
          var affix = /ÑÐµÑ…ÐµÑ‚$/i.exec(output) ? "Ñ€ÐµÐ½" : /Ã§ÑƒÐ»$/i.exec(output) ? "Ñ‚Ð°Ð½" : "Ñ€Ð°Ð½";
          return output + affix;
        },
        past : "%s ÐºÐ°ÑÐ»Ð»Ð°",
        s : "Ð¿Ä•Ñ€-Ð¸Ðº Ã§ÐµÐºÐºÑƒÐ½Ñ‚",
        m : "Ð¿Ä•Ñ€ Ð¼Ð¸Ð½ÑƒÑ‚",
        mm : "%d Ð¼Ð¸Ð½ÑƒÑ‚",
        h : "Ð¿Ä•Ñ€ ÑÐµÑ…ÐµÑ‚",
        hh : "%d ÑÐµÑ…ÐµÑ‚",
        d : "Ð¿Ä•Ñ€ ÐºÑƒÐ½",
        dd : "%d ÐºÑƒÐ½",
        M : "Ð¿Ä•Ñ€ ÑƒÐ¹ÄƒÑ…",
        MM : "%d ÑƒÐ¹ÄƒÑ…",
        y : "Ð¿Ä•Ñ€ Ã§ÑƒÐ»",
        yy : "%d Ã§ÑƒÐ»"
      },
      ordinal : '%d-Ð¼Ä•Ñˆ',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : Welsh (cy)
// author : Robert Allen

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang("cy", {
      months: "Ionawr_Chwefror_Mawrth_Ebrill_Mai_Mehefin_Gorffennaf_Awst_Medi_Hydref_Tachwedd_Rhagfyr".split("_"),
      monthsShort: "Ion_Chwe_Maw_Ebr_Mai_Meh_Gor_Aws_Med_Hyd_Tach_Rhag".split("_"),
      weekdays: "Dydd Sul_Dydd Llun_Dydd Mawrth_Dydd Mercher_Dydd Iau_Dydd Gwener_Dydd Sadwrn".split("_"),
      weekdaysShort: "Sul_Llun_Maw_Mer_Iau_Gwe_Sad".split("_"),
      weekdaysMin: "Su_Ll_Ma_Me_Ia_Gw_Sa".split("_"),
      // time formats are the same as en-gb
      longDateFormat: {
        LT: "HH:mm",
        L: "DD/MM/YYYY",
        LL: "D MMMM YYYY",
        LLL: "D MMMM YYYY LT",
        LLLL: "dddd, D MMMM YYYY LT"
      },
      calendar: {
        sameDay: '[Heddiw am] LT',
        nextDay: '[Yfory am] LT',
        nextWeek: 'dddd [am] LT',
        lastDay: '[Ddoe am] LT',
        lastWeek: 'dddd [diwethaf am] LT',
        sameElse: 'L'
      },
      relativeTime: {
        future: "mewn %s",
        past: "%s yn &#244;l",
        s: "ychydig eiliadau",
        m: "munud",
        mm: "%d munud",
        h: "awr",
        hh: "%d awr",
        d: "diwrnod",
        dd: "%d diwrnod",
        M: "mis",
        MM: "%d mis",
        y: "blwyddyn",
        yy: "%d flynedd"
      },
      // traditional ordinal numbers above 31 are not commonly used in colloquial Welsh
      ordinal: function (number) {
        var b = number,
          output = '',
          lookup = [
            '', 'af', 'il', 'ydd', 'ydd', 'ed', 'ed', 'ed', 'fed', 'fed', 'fed', // 1af to 10fed
            'eg', 'fed', 'eg', 'eg', 'fed', 'eg', 'eg', 'fed', 'eg', 'fed' // 11eg to 20fed
          ];

        if (b > 20) {
          if (b === 40 || b === 50 || b === 60 || b === 80 || b === 100) {
            output = 'fed'; // not 30ain, 70ain or 90ain
          } else {
            output = 'ain';
          }
        } else if (b > 0) {
          output = lookup[b];
        }

        return number + output;
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : danish (da)
// author : Ulrik Nielsen : https://github.com/mrbase

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('da', {
      months : "januar_februar_marts_april_maj_juni_juli_august_september_oktober_november_december".split("_"),
      monthsShort : "jan_feb_mar_apr_maj_jun_jul_aug_sep_okt_nov_dec".split("_"),
      weekdays : "sÃ¸ndag_mandag_tirsdag_onsdag_torsdag_fredag_lÃ¸rdag".split("_"),
      weekdaysShort : "sÃ¸n_man_tir_ons_tor_fre_lÃ¸r".split("_"),
      weekdaysMin : "sÃ¸_ma_ti_on_to_fr_lÃ¸".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd D. MMMM, YYYY LT"
      },
      calendar : {
        sameDay : '[I dag kl.] LT',
        nextDay : '[I morgen kl.] LT',
        nextWeek : 'dddd [kl.] LT',
        lastDay : '[I gÃ¥r kl.] LT',
        lastWeek : '[sidste] dddd [kl] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "om %s",
        past : "%s siden",
        s : "fÃ¥ sekunder",
        m : "et minut",
        mm : "%d minutter",
        h : "en time",
        hh : "%d timer",
        d : "en dag",
        dd : "%d dage",
        M : "en mÃ¥ned",
        MM : "%d mÃ¥neder",
        y : "et Ã¥r",
        yy : "%d Ã¥r"
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : german (de)
// author : lluchs : https://github.com/lluchs
// author: Menelion ElensÃºle: https://github.com/Oire

  (function (factory) {
    factory(moment);
  }(function (moment) {
    function processRelativeTime(number, withoutSuffix, key, isFuture) {
      var format = {
        'm': ['eine Minute', 'einer Minute'],
        'h': ['eine Stunde', 'einer Stunde'],
        'd': ['ein Tag', 'einem Tag'],
        'dd': [number + ' Tage', number + ' Tagen'],
        'M': ['ein Monat', 'einem Monat'],
        'MM': [number + ' Monate', number + ' Monaten'],
        'y': ['ein Jahr', 'einem Jahr'],
        'yy': [number + ' Jahre', number + ' Jahren']
      };
      return withoutSuffix ? format[key][0] : format[key][1];
    }

    return moment.lang('de', {
      months : "Januar_Februar_MÃ¤rz_April_Mai_Juni_Juli_August_September_Oktober_November_Dezember".split("_"),
      monthsShort : "Jan._Febr._Mrz._Apr._Mai_Jun._Jul._Aug._Sept._Okt._Nov._Dez.".split("_"),
      weekdays : "Sonntag_Montag_Dienstag_Mittwoch_Donnerstag_Freitag_Samstag".split("_"),
      weekdaysShort : "So._Mo._Di._Mi._Do._Fr._Sa.".split("_"),
      weekdaysMin : "So_Mo_Di_Mi_Do_Fr_Sa".split("_"),
      longDateFormat : {
        LT: "H:mm [Uhr]",
        L : "DD.MM.YYYY",
        LL : "D. MMMM YYYY",
        LLL : "D. MMMM YYYY LT",
        LLLL : "dddd, D. MMMM YYYY LT"
      },
      calendar : {
        sameDay: "[Heute um] LT",
        sameElse: "L",
        nextDay: '[Morgen um] LT',
        nextWeek: 'dddd [um] LT',
        lastDay: '[Gestern um] LT',
        lastWeek: '[letzten] dddd [um] LT'
      },
      relativeTime : {
        future : "in %s",
        past : "vor %s",
        s : "ein paar Sekunden",
        m : processRelativeTime,
        mm : "%d Minuten",
        h : processRelativeTime,
        hh : "%d Stunden",
        d : processRelativeTime,
        dd : processRelativeTime,
        M : processRelativeTime,
        MM : processRelativeTime,
        y : processRelativeTime,
        yy : processRelativeTime
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : modern greek (el)
// author : Aggelos Karalias : https://github.com/mehiel

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('el', {
      monthsNominativeEl : "Î™Î±Î½Î¿Ï…Î¬ÏÎ¹Î¿Ï‚_Î¦ÎµÎ²ÏÎ¿Ï…Î¬ÏÎ¹Î¿Ï‚_ÎœÎ¬ÏÏ„Î¹Î¿Ï‚_Î‘Ï€ÏÎ¯Î»Î¹Î¿Ï‚_ÎœÎ¬Î¹Î¿Ï‚_Î™Î¿ÏÎ½Î¹Î¿Ï‚_Î™Î¿ÏÎ»Î¹Î¿Ï‚_Î‘ÏÎ³Î¿Ï…ÏƒÏ„Î¿Ï‚_Î£ÎµÏ€Ï„Î­Î¼Î²ÏÎ¹Î¿Ï‚_ÎŸÎºÏ„ÏŽÎ²ÏÎ¹Î¿Ï‚_ÎÎ¿Î­Î¼Î²ÏÎ¹Î¿Ï‚_Î”ÎµÎºÎ­Î¼Î²ÏÎ¹Î¿Ï‚".split("_"),
      monthsGenitiveEl : "Î™Î±Î½Î¿Ï…Î±ÏÎ¯Î¿Ï…_Î¦ÎµÎ²ÏÎ¿Ï…Î±ÏÎ¯Î¿Ï…_ÎœÎ±ÏÏ„Î¯Î¿Ï…_Î‘Ï€ÏÎ¹Î»Î¯Î¿Ï…_ÎœÎ±ÎÎ¿Ï…_Î™Î¿Ï…Î½Î¯Î¿Ï…_Î™Î¿Ï…Î»Î¯Î¿Ï…_Î‘Ï…Î³Î¿ÏÏƒÏ„Î¿Ï…_Î£ÎµÏ€Ï„ÎµÎ¼Î²ÏÎ¯Î¿Ï…_ÎŸÎºÏ„Ï‰Î²ÏÎ¯Î¿Ï…_ÎÎ¿ÎµÎ¼Î²ÏÎ¯Î¿Ï…_Î”ÎµÎºÎµÎ¼Î²ÏÎ¯Î¿Ï…".split("_"),
      months : function (momentToFormat, format) {
        if (/D/.test(format.substring(0, format.indexOf("MMMM")))) { // if there is a day number before 'MMMM'
          return this._monthsGenitiveEl[momentToFormat.month()];
        } else {
          return this._monthsNominativeEl[momentToFormat.month()];
        }
      },
      monthsShort : "Î™Î±Î½_Î¦ÎµÎ²_ÎœÎ±Ï_Î‘Ï€Ï_ÎœÎ±ÏŠ_Î™Î¿Ï…Î½_Î™Î¿Ï…Î»_Î‘Ï…Î³_Î£ÎµÏ€_ÎŸÎºÏ„_ÎÎ¿Îµ_Î”ÎµÎº".split("_"),
      weekdays : "ÎšÏ…ÏÎ¹Î±ÎºÎ®_Î”ÎµÏ…Ï„Î­ÏÎ±_Î¤ÏÎ¯Ï„Î·_Î¤ÎµÏ„Î¬ÏÏ„Î·_Î Î­Î¼Ï€Ï„Î·_Î Î±ÏÎ±ÏƒÎºÎµÏ…Î®_Î£Î¬Î²Î²Î±Ï„Î¿".split("_"),
      weekdaysShort : "ÎšÏ…Ï_Î”ÎµÏ…_Î¤ÏÎ¹_Î¤ÎµÏ„_Î ÎµÎ¼_Î Î±Ï_Î£Î±Î²".split("_"),
      weekdaysMin : "ÎšÏ…_Î”Îµ_Î¤Ï_Î¤Îµ_Î Îµ_Î Î±_Î£Î±".split("_"),
      meridiem : function (hours, minutes, isLower) {
        if (hours > 11) {
          return isLower ? 'Î¼Î¼' : 'ÎœÎœ';
        } else {
          return isLower ? 'Ï€Î¼' : 'Î Îœ';
        }
      },
      longDateFormat : {
        LT : "h:mm A",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd, D MMMM YYYY LT"
      },
      calendarEl : {
        sameDay : '[Î£Î®Î¼ÎµÏÎ± {}] LT',
        nextDay : '[Î‘ÏÏÎ¹Î¿ {}] LT',
        nextWeek : 'dddd [{}] LT',
        lastDay : '[Î§Î¸ÎµÏ‚ {}] LT',
        lastWeek : '[Ï„Î·Î½ Ï€ÏÎ¿Î·Î³Î¿ÏÎ¼ÎµÎ½Î·] dddd [{}] LT',
        sameElse : 'L'
      },
      calendar : function (key, mom) {
        var output = this._calendarEl[key],
          hours = mom && mom.hours();

        return output.replace("{}", (hours % 12 === 1 ? "ÏƒÏ„Î·" : "ÏƒÏ„Î¹Ï‚"));
      },
      relativeTime : {
        future : "ÏƒÎµ %s",
        past : "%s Ï€ÏÎ¹Î½",
        s : "Î´ÎµÏ…Ï„ÎµÏÏŒÎ»ÎµÏ€Ï„Î±",
        m : "Î­Î½Î± Î»ÎµÏ€Ï„ÏŒ",
        mm : "%d Î»ÎµÏ€Ï„Î¬",
        h : "Î¼Î¯Î± ÏŽÏÎ±",
        hh : "%d ÏŽÏÎµÏ‚",
        d : "Î¼Î¯Î± Î¼Î­ÏÎ±",
        dd : "%d Î¼Î­ÏÎµÏ‚",
        M : "Î­Î½Î±Ï‚ Î¼Î®Î½Î±Ï‚",
        MM : "%d Î¼Î®Î½ÎµÏ‚",
        y : "Î­Î½Î±Ï‚ Ï‡ÏÏŒÎ½Î¿Ï‚",
        yy : "%d Ï‡ÏÏŒÎ½Î¹Î±"
      },
      ordinal : function (number) {
        return number + 'Î·';
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : australian english (en-au)

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('en-au', {
      months : "January_February_March_April_May_June_July_August_September_October_November_December".split("_"),
      monthsShort : "Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),
      weekdays : "Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),
      weekdaysShort : "Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),
      weekdaysMin : "Su_Mo_Tu_We_Th_Fr_Sa".split("_"),
      longDateFormat : {
        LT : "h:mm A",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd, D MMMM YYYY LT"
      },
      calendar : {
        sameDay : '[Today at] LT',
        nextDay : '[Tomorrow at] LT',
        nextWeek : 'dddd [at] LT',
        lastDay : '[Yesterday at] LT',
        lastWeek : '[Last] dddd [at] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "in %s",
        past : "%s ago",
        s : "a few seconds",
        m : "a minute",
        mm : "%d minutes",
        h : "an hour",
        hh : "%d hours",
        d : "a day",
        dd : "%d days",
        M : "a month",
        MM : "%d months",
        y : "a year",
        yy : "%d years"
      },
      ordinal : function (number) {
        var b = number % 10,
          output = (~~ (number % 100 / 10) === 1) ? 'th' :
            (b === 1) ? 'st' :
              (b === 2) ? 'nd' :
                (b === 3) ? 'rd' : 'th';
        return number + output;
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : canadian english (en-ca)
// author : Jonathan Abourbih : https://github.com/jonbca

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('en-ca', {
      months : "January_February_March_April_May_June_July_August_September_October_November_December".split("_"),
      monthsShort : "Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),
      weekdays : "Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),
      weekdaysShort : "Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),
      weekdaysMin : "Su_Mo_Tu_We_Th_Fr_Sa".split("_"),
      longDateFormat : {
        LT : "h:mm A",
        L : "YYYY-MM-DD",
        LL : "D MMMM, YYYY",
        LLL : "D MMMM, YYYY LT",
        LLLL : "dddd, D MMMM, YYYY LT"
      },
      calendar : {
        sameDay : '[Today at] LT',
        nextDay : '[Tomorrow at] LT',
        nextWeek : 'dddd [at] LT',
        lastDay : '[Yesterday at] LT',
        lastWeek : '[Last] dddd [at] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "in %s",
        past : "%s ago",
        s : "a few seconds",
        m : "a minute",
        mm : "%d minutes",
        h : "an hour",
        hh : "%d hours",
        d : "a day",
        dd : "%d days",
        M : "a month",
        MM : "%d months",
        y : "a year",
        yy : "%d years"
      },
      ordinal : function (number) {
        var b = number % 10,
          output = (~~ (number % 100 / 10) === 1) ? 'th' :
            (b === 1) ? 'st' :
              (b === 2) ? 'nd' :
                (b === 3) ? 'rd' : 'th';
        return number + output;
      }
    });
  }));
// moment.js language configuration
// language : great britain english (en-gb)
// author : Chris Gedrim : https://github.com/chrisgedrim

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('en-gb', {
      months : "January_February_March_April_May_June_July_August_September_October_November_December".split("_"),
      monthsShort : "Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),
      weekdays : "Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),
      weekdaysShort : "Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),
      weekdaysMin : "Su_Mo_Tu_We_Th_Fr_Sa".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd, D MMMM YYYY LT"
      },
      calendar : {
        sameDay : '[Today at] LT',
        nextDay : '[Tomorrow at] LT',
        nextWeek : 'dddd [at] LT',
        lastDay : '[Yesterday at] LT',
        lastWeek : '[Last] dddd [at] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "in %s",
        past : "%s ago",
        s : "a few seconds",
        m : "a minute",
        mm : "%d minutes",
        h : "an hour",
        hh : "%d hours",
        d : "a day",
        dd : "%d days",
        M : "a month",
        MM : "%d months",
        y : "a year",
        yy : "%d years"
      },
      ordinal : function (number) {
        var b = number % 10,
          output = (~~ (number % 100 / 10) === 1) ? 'th' :
            (b === 1) ? 'st' :
              (b === 2) ? 'nd' :
                (b === 3) ? 'rd' : 'th';
        return number + output;
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : esperanto (eo)
// author : Colin Dean : https://github.com/colindean
// komento: Mi estas malcerta se mi korekte traktis akuzativojn en tiu traduko.
//          Se ne, bonvolu korekti kaj avizi min por ke mi povas lerni!

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('eo', {
      months : "januaro_februaro_marto_aprilo_majo_junio_julio_aÅ­gusto_septembro_oktobro_novembro_decembro".split("_"),
      monthsShort : "jan_feb_mar_apr_maj_jun_jul_aÅ­g_sep_okt_nov_dec".split("_"),
      weekdays : "DimanÄ‰o_Lundo_Mardo_Merkredo_Ä´aÅ­do_Vendredo_Sabato".split("_"),
      weekdaysShort : "Dim_Lun_Mard_Merk_Ä´aÅ­_Ven_Sab".split("_"),
      weekdaysMin : "Di_Lu_Ma_Me_Ä´a_Ve_Sa".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "YYYY-MM-DD",
        LL : "D[-an de] MMMM, YYYY",
        LLL : "D[-an de] MMMM, YYYY LT",
        LLLL : "dddd, [la] D[-an de] MMMM, YYYY LT"
      },
      meridiem : function (hours, minutes, isLower) {
        if (hours > 11) {
          return isLower ? 'p.t.m.' : 'P.T.M.';
        } else {
          return isLower ? 'a.t.m.' : 'A.T.M.';
        }
      },
      calendar : {
        sameDay : '[HodiaÅ­ je] LT',
        nextDay : '[MorgaÅ­ je] LT',
        nextWeek : 'dddd [je] LT',
        lastDay : '[HieraÅ­ je] LT',
        lastWeek : '[pasinta] dddd [je] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "je %s",
        past : "antaÅ­ %s",
        s : "sekundoj",
        m : "minuto",
        mm : "%d minutoj",
        h : "horo",
        hh : "%d horoj",
        d : "tago",//ne 'diurno', Ä‰ar estas uzita por proksimumo
        dd : "%d tagoj",
        M : "monato",
        MM : "%d monatoj",
        y : "jaro",
        yy : "%d jaroj"
      },
      ordinal : "%da",
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : spanish (es)
// author : Julio NapurÃ­ : https://github.com/julionc

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('es', {
      months : "enero_febrero_marzo_abril_mayo_junio_julio_agosto_septiembre_octubre_noviembre_diciembre".split("_"),
      monthsShort : "ene._feb._mar._abr._may._jun._jul._ago._sep._oct._nov._dic.".split("_"),
      weekdays : "domingo_lunes_martes_miÃ©rcoles_jueves_viernes_sÃ¡bado".split("_"),
      weekdaysShort : "dom._lun._mar._miÃ©._jue._vie._sÃ¡b.".split("_"),
      weekdaysMin : "Do_Lu_Ma_Mi_Ju_Vi_SÃ¡".split("_"),
      longDateFormat : {
        LT : "H:mm",
        L : "DD/MM/YYYY",
        LL : "D [de] MMMM [de] YYYY",
        LLL : "D [de] MMMM [de] YYYY LT",
        LLLL : "dddd, D [de] MMMM [de] YYYY LT"
      },
      calendar : {
        sameDay : function () {
          return '[hoy a la' + ((this.hours() !== 1) ? 's' : '') + '] LT';
        },
        nextDay : function () {
          return '[maÃ±ana a la' + ((this.hours() !== 1) ? 's' : '') + '] LT';
        },
        nextWeek : function () {
          return 'dddd [a la' + ((this.hours() !== 1) ? 's' : '') + '] LT';
        },
        lastDay : function () {
          return '[ayer a la' + ((this.hours() !== 1) ? 's' : '') + '] LT';
        },
        lastWeek : function () {
          return '[el] dddd [pasado a la' + ((this.hours() !== 1) ? 's' : '') + '] LT';
        },
        sameElse : 'L'
      },
      relativeTime : {
        future : "en %s",
        past : "hace %s",
        s : "unos segundos",
        m : "un minuto",
        mm : "%d minutos",
        h : "una hora",
        hh : "%d horas",
        d : "un dÃ­a",
        dd : "%d dÃ­as",
        M : "un mes",
        MM : "%d meses",
        y : "un aÃ±o",
        yy : "%d aÃ±os"
      },
      ordinal : '%dÂº',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : estonian (et)
// author : Henry Kehlmann : https://github.com/madhenry

  (function (factory) {
    factory(moment);
  }(function (moment) {
    function translateSeconds(number, withoutSuffix, key, isFuture) {
      return (isFuture || withoutSuffix) ? 'paari sekundi' : 'paar sekundit';
    }

    return moment.lang('et', {
      months        : "jaanuar_veebruar_mÃ¤rts_aprill_mai_juuni_juuli_august_september_oktoober_november_detsember".split("_"),
      monthsShort   : "jaan_veebr_mÃ¤rts_apr_mai_juuni_juuli_aug_sept_okt_nov_dets".split("_"),
      weekdays      : "pÃ¼hapÃ¤ev_esmaspÃ¤ev_teisipÃ¤ev_kolmapÃ¤ev_neljapÃ¤ev_reede_laupÃ¤ev".split("_"),
      weekdaysShort : "P_E_T_K_N_R_L".split("_"),
      weekdaysMin   : "P_E_T_K_N_R_L".split("_"),
      longDateFormat : {
        LT   : "H:mm",
        L    : "DD.MM.YYYY",
        LL   : "D. MMMM YYYY",
        LLL  : "D. MMMM YYYY LT",
        LLLL : "dddd, D. MMMM YYYY LT"
      },
      calendar : {
        sameDay  : '[TÃ¤na,] LT',
        nextDay  : '[Homme,] LT',
        nextWeek : '[JÃ¤rgmine] dddd LT',
        lastDay  : '[Eile,] LT',
        lastWeek : '[Eelmine] dddd LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "%s pÃ¤rast",
        past   : "%s tagasi",
        s      : translateSeconds,
        m      : "minut",
        mm     : "%d minutit",
        h      : "tund",
        hh     : "%d tundi",
        d      : "pÃ¤ev",
        dd     : "%d pÃ¤eva",
        M      : "kuu",
        MM     : "%d kuud",
        y      : "aasta",
        yy     : "%d aastat"
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : euskara (eu)
// author : Eneko Illarramendi : https://github.com/eillarra

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('eu', {
      months : "urtarrila_otsaila_martxoa_apirila_maiatza_ekaina_uztaila_abuztua_iraila_urria_azaroa_abendua".split("_"),
      monthsShort : "urt._ots._mar._api._mai._eka._uzt._abu._ira._urr._aza._abe.".split("_"),
      weekdays : "igandea_astelehena_asteartea_asteazkena_osteguna_ostirala_larunbata".split("_"),
      weekdaysShort : "ig._al._ar._az._og._ol._lr.".split("_"),
      weekdaysMin : "ig_al_ar_az_og_ol_lr".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "YYYY-MM-DD",
        LL : "YYYY[ko] MMMM[ren] D[a]",
        LLL : "YYYY[ko] MMMM[ren] D[a] LT",
        LLLL : "dddd, YYYY[ko] MMMM[ren] D[a] LT",
        l : "YYYY-M-D",
        ll : "YYYY[ko] MMM D[a]",
        lll : "YYYY[ko] MMM D[a] LT",
        llll : "ddd, YYYY[ko] MMM D[a] LT"
      },
      calendar : {
        sameDay : '[gaur] LT[etan]',
        nextDay : '[bihar] LT[etan]',
        nextWeek : 'dddd LT[etan]',
        lastDay : '[atzo] LT[etan]',
        lastWeek : '[aurreko] dddd LT[etan]',
        sameElse : 'L'
      },
      relativeTime : {
        future : "%s barru",
        past : "duela %s",
        s : "segundo batzuk",
        m : "minutu bat",
        mm : "%d minutu",
        h : "ordu bat",
        hh : "%d ordu",
        d : "egun bat",
        dd : "%d egun",
        M : "hilabete bat",
        MM : "%d hilabete",
        y : "urte bat",
        yy : "%d urte"
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : Persian Language
// author : Ebrahim Byagowi : https://github.com/ebraminio

  (function (factory) {
    factory(moment);
  }(function (moment) {
    var symbolMap = {
      '1': 'Û±',
      '2': 'Û²',
      '3': 'Û³',
      '4': 'Û´',
      '5': 'Ûµ',
      '6': 'Û¶',
      '7': 'Û·',
      '8': 'Û¸',
      '9': 'Û¹',
      '0': 'Û°'
    }, numberMap = {
      'Û±': '1',
      'Û²': '2',
      'Û³': '3',
      'Û´': '4',
      'Ûµ': '5',
      'Û¶': '6',
      'Û·': '7',
      'Û¸': '8',
      'Û¹': '9',
      'Û°': '0'
    };

    return moment.lang('fa', {
      months : 'Ú˜Ø§Ù†ÙˆÛŒÙ‡_ÙÙˆØ±ÛŒÙ‡_Ù…Ø§Ø±Ø³_Ø¢ÙˆØ±ÛŒÙ„_Ù…Ù‡_Ú˜ÙˆØ¦Ù†_Ú˜ÙˆØ¦ÛŒÙ‡_Ø§ÙˆØª_Ø³Ù¾ØªØ§Ù…Ø¨Ø±_Ø§Ú©ØªØ¨Ø±_Ù†ÙˆØ§Ù…Ø¨Ø±_Ø¯Ø³Ø§Ù…Ø¨Ø±'.split('_'),
      monthsShort : 'Ú˜Ø§Ù†ÙˆÛŒÙ‡_ÙÙˆØ±ÛŒÙ‡_Ù…Ø§Ø±Ø³_Ø¢ÙˆØ±ÛŒÙ„_Ù…Ù‡_Ú˜ÙˆØ¦Ù†_Ú˜ÙˆØ¦ÛŒÙ‡_Ø§ÙˆØª_Ø³Ù¾ØªØ§Ù…Ø¨Ø±_Ø§Ú©ØªØ¨Ø±_Ù†ÙˆØ§Ù…Ø¨Ø±_Ø¯Ø³Ø§Ù…Ø¨Ø±'.split('_'),
      weekdays : 'ÛŒÚ©\u200cØ´Ù†Ø¨Ù‡_Ø¯ÙˆØ´Ù†Ø¨Ù‡_Ø³Ù‡\u200cØ´Ù†Ø¨Ù‡_Ú†Ù‡Ø§Ø±Ø´Ù†Ø¨Ù‡_Ù¾Ù†Ø¬\u200cØ´Ù†Ø¨Ù‡_Ø¬Ù…Ø¹Ù‡_Ø´Ù†Ø¨Ù‡'.split('_'),
      weekdaysShort : 'ÛŒÚ©\u200cØ´Ù†Ø¨Ù‡_Ø¯ÙˆØ´Ù†Ø¨Ù‡_Ø³Ù‡\u200cØ´Ù†Ø¨Ù‡_Ú†Ù‡Ø§Ø±Ø´Ù†Ø¨Ù‡_Ù¾Ù†Ø¬\u200cØ´Ù†Ø¨Ù‡_Ø¬Ù…Ø¹Ù‡_Ø´Ù†Ø¨Ù‡'.split('_'),
      weekdaysMin : 'ÛŒ_Ø¯_Ø³_Ú†_Ù¾_Ø¬_Ø´'.split('_'),
      longDateFormat : {
        LT : 'HH:mm',
        L : 'DD/MM/YYYY',
        LL : 'D MMMM YYYY',
        LLL : 'D MMMM YYYY LT',
        LLLL : 'dddd, D MMMM YYYY LT'
      },
      meridiem : function (hour, minute, isLower) {
        if (hour < 12) {
          return "Ù‚Ø¨Ù„ Ø§Ø² Ø¸Ù‡Ø±";
        } else {
          return "Ø¨Ø¹Ø¯ Ø§Ø² Ø¸Ù‡Ø±";
        }
      },
      calendar : {
        sameDay : '[Ø§Ù…Ø±ÙˆØ² Ø³Ø§Ø¹Øª] LT',
        nextDay : '[ÙØ±Ø¯Ø§ Ø³Ø§Ø¹Øª] LT',
        nextWeek : 'dddd [Ø³Ø§Ø¹Øª] LT',
        lastDay : '[Ø¯ÛŒØ±ÙˆØ² Ø³Ø§Ø¹Øª] LT',
        lastWeek : 'dddd [Ù¾ÛŒØ´] [Ø³Ø§Ø¹Øª] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : 'Ø¯Ø± %s',
        past : '%s Ù¾ÛŒØ´',
        s : 'Ú†Ù†Ø¯ÛŒÙ† Ø«Ø§Ù†ÛŒÙ‡',
        m : 'ÛŒÚ© Ø¯Ù‚ÛŒÙ‚Ù‡',
        mm : '%d Ø¯Ù‚ÛŒÙ‚Ù‡',
        h : 'ÛŒÚ© Ø³Ø§Ø¹Øª',
        hh : '%d Ø³Ø§Ø¹Øª',
        d : 'ÛŒÚ© Ø±ÙˆØ²',
        dd : '%d Ø±ÙˆØ²',
        M : 'ÛŒÚ© Ù…Ø§Ù‡',
        MM : '%d Ù…Ø§Ù‡',
        y : 'ÛŒÚ© Ø³Ø§Ù„',
        yy : '%d Ø³Ø§Ù„'
      },
      preparse: function (string) {
        return string.replace(/[Û°-Û¹]/g, function (match) {
          return numberMap[match];
        }).replace(/ØŒ/g, ',');
      },
      postformat: function (string) {
        return string.replace(/\d/g, function (match) {
          return symbolMap[match];
        }).replace(/,/g, 'ØŒ');
      },
      ordinal : '%dÙ…',
      week : {
        dow : 6, // Saturday is the first day of the week.
        doy : 12 // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : finnish (fi)
// author : Tarmo Aidantausta : https://github.com/bleadof

  (function (factory) {
    factory(moment);
  }(function (moment) {
    var numbers_past = 'nolla yksi kaksi kolme neljÃ¤ viisi kuusi seitsemÃ¤n kahdeksan yhdeksÃ¤n'.split(' '),
      numbers_future = ['nolla', 'yhden', 'kahden', 'kolmen', 'neljÃ¤n', 'viiden', 'kuuden',
        numbers_past[7], numbers_past[8], numbers_past[9]];

    function translate(number, withoutSuffix, key, isFuture) {
      var result = "";
      switch (key) {
        case 's':
          return isFuture ? 'muutaman sekunnin' : 'muutama sekunti';
        case 'm':
          return isFuture ? 'minuutin' : 'minuutti';
        case 'mm':
          result = isFuture ? 'minuutin' : 'minuuttia';
          break;
        case 'h':
          return isFuture ? 'tunnin' : 'tunti';
        case 'hh':
          result = isFuture ? 'tunnin' : 'tuntia';
          break;
        case 'd':
          return isFuture ? 'pÃ¤ivÃ¤n' : 'pÃ¤ivÃ¤';
        case 'dd':
          result = isFuture ? 'pÃ¤ivÃ¤n' : 'pÃ¤ivÃ¤Ã¤';
          break;
        case 'M':
          return isFuture ? 'kuukauden' : 'kuukausi';
        case 'MM':
          result = isFuture ? 'kuukauden' : 'kuukautta';
          break;
        case 'y':
          return isFuture ? 'vuoden' : 'vuosi';
        case 'yy':
          result = isFuture ? 'vuoden' : 'vuotta';
          break;
      }
      result = verbal_number(number, isFuture) + " " + result;
      return result;
    }

    function verbal_number(number, isFuture) {
      return number < 10 ? (isFuture ? numbers_future[number] : numbers_past[number]) : number;
    }

    return moment.lang('fi', {
      months : "tammikuu_helmikuu_maaliskuu_huhtikuu_toukokuu_kesÃ¤kuu_heinÃ¤kuu_elokuu_syyskuu_lokakuu_marraskuu_joulukuu".split("_"),
      monthsShort : "tammi_helmi_maalis_huhti_touko_kesÃ¤_heinÃ¤_elo_syys_loka_marras_joulu".split("_"),
      weekdays : "sunnuntai_maanantai_tiistai_keskiviikko_torstai_perjantai_lauantai".split("_"),
      weekdaysShort : "su_ma_ti_ke_to_pe_la".split("_"),
      weekdaysMin : "su_ma_ti_ke_to_pe_la".split("_"),
      longDateFormat : {
        LT : "HH.mm",
        L : "DD.MM.YYYY",
        LL : "Do MMMM[ta] YYYY",
        LLL : "Do MMMM[ta] YYYY, [klo] LT",
        LLLL : "dddd, Do MMMM[ta] YYYY, [klo] LT",
        l : "D.M.YYYY",
        ll : "Do MMM YYYY",
        lll : "Do MMM YYYY, [klo] LT",
        llll : "ddd, Do MMM YYYY, [klo] LT"
      },
      calendar : {
        sameDay : '[tÃ¤nÃ¤Ã¤n] [klo] LT',
        nextDay : '[huomenna] [klo] LT',
        nextWeek : 'dddd [klo] LT',
        lastDay : '[eilen] [klo] LT',
        lastWeek : '[viime] dddd[na] [klo] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "%s pÃ¤Ã¤stÃ¤",
        past : "%s sitten",
        s : translate,
        m : translate,
        mm : translate,
        h : translate,
        hh : translate,
        d : translate,
        dd : translate,
        M : translate,
        MM : translate,
        y : translate,
        yy : translate
      },
      ordinal : "%d.",
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : faroese (fo)
// author : Ragnar Johannesen : https://github.com/ragnar123

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('fo', {
      months : "januar_februar_mars_aprÃ­l_mai_juni_juli_august_september_oktober_november_desember".split("_"),
      monthsShort : "jan_feb_mar_apr_mai_jun_jul_aug_sep_okt_nov_des".split("_"),
      weekdays : "sunnudagur_mÃ¡nadagur_tÃ½sdagur_mikudagur_hÃ³sdagur_frÃ­ggjadagur_leygardagur".split("_"),
      weekdaysShort : "sun_mÃ¡n_tÃ½s_mik_hÃ³s_frÃ­_ley".split("_"),
      weekdaysMin : "su_mÃ¡_tÃ½_mi_hÃ³_fr_le".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd D. MMMM, YYYY LT"
      },
      calendar : {
        sameDay : '[Ã dag kl.] LT',
        nextDay : '[Ã morgin kl.] LT',
        nextWeek : 'dddd [kl.] LT',
        lastDay : '[Ã gjÃ¡r kl.] LT',
        lastWeek : '[sÃ­Ã°stu] dddd [kl] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "um %s",
        past : "%s sÃ­Ã°ani",
        s : "fÃ¡ sekund",
        m : "ein minutt",
        mm : "%d minuttir",
        h : "ein tÃ­mi",
        hh : "%d tÃ­mar",
        d : "ein dagur",
        dd : "%d dagar",
        M : "ein mÃ¡naÃ°i",
        MM : "%d mÃ¡naÃ°ir",
        y : "eitt Ã¡r",
        yy : "%d Ã¡r"
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : canadian french (fr-ca)
// author : Jonathan Abourbih : https://github.com/jonbca

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('fr-ca', {
      months : "janvier_fÃ©vrier_mars_avril_mai_juin_juillet_aoÃ»t_septembre_octobre_novembre_dÃ©cembre".split("_"),
      monthsShort : "janv._fÃ©vr._mars_avr._mai_juin_juil._aoÃ»t_sept._oct._nov._dÃ©c.".split("_"),
      weekdays : "dimanche_lundi_mardi_mercredi_jeudi_vendredi_samedi".split("_"),
      weekdaysShort : "dim._lun._mar._mer._jeu._ven._sam.".split("_"),
      weekdaysMin : "Di_Lu_Ma_Me_Je_Ve_Sa".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "YYYY-MM-DD",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd D MMMM YYYY LT"
      },
      calendar : {
        sameDay: "[Aujourd'hui Ã ] LT",
        nextDay: '[Demain Ã ] LT',
        nextWeek: 'dddd [Ã ] LT',
        lastDay: '[Hier Ã ] LT',
        lastWeek: 'dddd [dernier Ã ] LT',
        sameElse: 'L'
      },
      relativeTime : {
        future : "dans %s",
        past : "il y a %s",
        s : "quelques secondes",
        m : "une minute",
        mm : "%d minutes",
        h : "une heure",
        hh : "%d heures",
        d : "un jour",
        dd : "%d jours",
        M : "un mois",
        MM : "%d mois",
        y : "un an",
        yy : "%d ans"
      },
      ordinal : function (number) {
        return number + (number === 1 ? 'er' : '');
      }
    });
  }));
// moment.js language configuration
// language : french (fr)
// author : John Fischer : https://github.com/jfroffice

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('fr', {
      months : "janvier_fÃ©vrier_mars_avril_mai_juin_juillet_aoÃ»t_septembre_octobre_novembre_dÃ©cembre".split("_"),
      monthsShort : "janv._fÃ©vr._mars_avr._mai_juin_juil._aoÃ»t_sept._oct._nov._dÃ©c.".split("_"),
      weekdays : "dimanche_lundi_mardi_mercredi_jeudi_vendredi_samedi".split("_"),
      weekdaysShort : "dim._lun._mar._mer._jeu._ven._sam.".split("_"),
      weekdaysMin : "Di_Lu_Ma_Me_Je_Ve_Sa".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd D MMMM YYYY LT"
      },
      calendar : {
        sameDay: "[Aujourd'hui Ã ] LT",
        nextDay: '[Demain Ã ] LT',
        nextWeek: 'dddd [Ã ] LT',
        lastDay: '[Hier Ã ] LT',
        lastWeek: 'dddd [dernier Ã ] LT',
        sameElse: 'L'
      },
      relativeTime : {
        future : "dans %s",
        past : "il y a %s",
        s : "quelques secondes",
        m : "une minute",
        mm : "%d minutes",
        h : "une heure",
        hh : "%d heures",
        d : "un jour",
        dd : "%d jours",
        M : "un mois",
        MM : "%d mois",
        y : "un an",
        yy : "%d ans"
      },
      ordinal : function (number) {
        return number + (number === 1 ? 'er' : '');
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : galician (gl)
// author : Juan G. Hurtado : https://github.com/juanghurtado

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('gl', {
      months : "Xaneiro_Febreiro_Marzo_Abril_Maio_XuÃ±o_Xullo_Agosto_Setembro_Outubro_Novembro_Decembro".split("_"),
      monthsShort : "Xan._Feb._Mar._Abr._Mai._XuÃ±._Xul._Ago._Set._Out._Nov._Dec.".split("_"),
      weekdays : "Domingo_Luns_Martes_MÃ©rcores_Xoves_Venres_SÃ¡bado".split("_"),
      weekdaysShort : "Dom._Lun._Mar._MÃ©r._Xov._Ven._SÃ¡b.".split("_"),
      weekdaysMin : "Do_Lu_Ma_MÃ©_Xo_Ve_SÃ¡".split("_"),
      longDateFormat : {
        LT : "H:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd D MMMM YYYY LT"
      },
      calendar : {
        sameDay : function () {
          return '[hoxe ' + ((this.hours() !== 1) ? 'Ã¡s' : 'Ã¡') + '] LT';
        },
        nextDay : function () {
          return '[maÃ±Ã¡ ' + ((this.hours() !== 1) ? 'Ã¡s' : 'Ã¡') + '] LT';
        },
        nextWeek : function () {
          return 'dddd [' + ((this.hours() !== 1) ? 'Ã¡s' : 'a') + '] LT';
        },
        lastDay : function () {
          return '[onte ' + ((this.hours() !== 1) ? 'Ã¡' : 'a') + '] LT';
        },
        lastWeek : function () {
          return '[o] dddd [pasado ' + ((this.hours() !== 1) ? 'Ã¡s' : 'a') + '] LT';
        },
        sameElse : 'L'
      },
      relativeTime : {
        future : function (str) {
          if (str === "uns segundos") {
            return "nuns segundos";
          }
          return "en " + str;
        },
        past : "hai %s",
        s : "uns segundos",
        m : "un minuto",
        mm : "%d minutos",
        h : "unha hora",
        hh : "%d horas",
        d : "un dÃ­a",
        dd : "%d dÃ­as",
        M : "un mes",
        MM : "%d meses",
        y : "un ano",
        yy : "%d anos"
      },
      ordinal : '%dÂº',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : Hebrew (he)
// author : Tomer Cohen : https://github.com/tomer
// author : Moshe Simantov : https://github.com/DevelopmentIL
// author : Tal Ater : https://github.com/TalAter

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('he', {
      months : "×™× ×•××¨_×¤×‘×¨×•××¨_×ž×¨×¥_××¤×¨×™×œ_×ž××™_×™×•× ×™_×™×•×œ×™_××•×’×•×¡×˜_×¡×¤×˜×ž×‘×¨_××•×§×˜×•×‘×¨_× ×•×‘×ž×‘×¨_×“×¦×ž×‘×¨".split("_"),
      monthsShort : "×™× ×•×³_×¤×‘×¨×³_×ž×¨×¥_××¤×¨×³_×ž××™_×™×•× ×™_×™×•×œ×™_××•×’×³_×¡×¤×˜×³_××•×§×³_× ×•×‘×³_×“×¦×ž×³".split("_"),
      weekdays : "×¨××©×•×Ÿ_×©× ×™_×©×œ×™×©×™_×¨×‘×™×¢×™_×—×ž×™×©×™_×©×™×©×™_×©×‘×ª".split("_"),
      weekdaysShort : "××³_×‘×³_×’×³_×“×³_×”×³_×•×³_×©×³".split("_"),
      weekdaysMin : "×_×‘_×’_×“_×”_×•_×©".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D [×‘]MMMM YYYY",
        LLL : "D [×‘]MMMM YYYY LT",
        LLLL : "dddd, D [×‘]MMMM YYYY LT",
        l : "D/M/YYYY",
        ll : "D MMM YYYY",
        lll : "D MMM YYYY LT",
        llll : "ddd, D MMM YYYY LT"
      },
      calendar : {
        sameDay : '[×”×™×•× ×‘Ö¾]LT',
        nextDay : '[×ž×—×¨ ×‘Ö¾]LT',
        nextWeek : 'dddd [×‘×©×¢×”] LT',
        lastDay : '[××ª×ž×•×œ ×‘Ö¾]LT',
        lastWeek : '[×‘×™×•×] dddd [×”××—×¨×•×Ÿ ×‘×©×¢×”] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "×‘×¢×•×“ %s",
        past : "×œ×¤× ×™ %s",
        s : "×ž×¡×¤×¨ ×©× ×™×•×ª",
        m : "×“×§×”",
        mm : "%d ×“×§×•×ª",
        h : "×©×¢×”",
        hh : function (number) {
          if (number === 2) {
            return "×©×¢×ª×™×™×";
          }
          return number + " ×©×¢×•×ª";
        },
        d : "×™×•×",
        dd : function (number) {
          if (number === 2) {
            return "×™×•×ž×™×™×";
          }
          return number + " ×™×ž×™×";
        },
        M : "×—×•×“×©",
        MM : function (number) {
          if (number === 2) {
            return "×—×•×“×©×™×™×";
          }
          return number + " ×—×•×“×©×™×";
        },
        y : "×©× ×”",
        yy : function (number) {
          if (number === 2) {
            return "×©× ×ª×™×™×";
          }
          return number + " ×©× ×™×";
        }
      }
    });
  }));
// moment.js language configuration
// language : hindi (hi)
// author : Mayank Singhal : https://github.com/mayanksinghal

  (function (factory) {
    factory(moment);
  }(function (moment) {
    var symbolMap = {
        '1': 'à¥§',
        '2': 'à¥¨',
        '3': 'à¥©',
        '4': 'à¥ª',
        '5': 'à¥«',
        '6': 'à¥¬',
        '7': 'à¥­',
        '8': 'à¥®',
        '9': 'à¥¯',
        '0': 'à¥¦'
      },
      numberMap = {
        'à¥§': '1',
        'à¥¨': '2',
        'à¥©': '3',
        'à¥ª': '4',
        'à¥«': '5',
        'à¥¬': '6',
        'à¥­': '7',
        'à¥®': '8',
        'à¥¯': '9',
        'à¥¦': '0'
      };

    return moment.lang('hi', {
      months : 'à¤œà¤¨à¤µà¤°à¥€_à¤«à¤¼à¤°à¤µà¤°à¥€_à¤®à¤¾à¤°à¥à¤š_à¤…à¤ªà¥à¤°à¥ˆà¤²_à¤®à¤ˆ_à¤œà¥‚à¤¨_à¤œà¥à¤²à¤¾à¤ˆ_à¤…à¤—à¤¸à¥à¤¤_à¤¸à¤¿à¤¤à¤®à¥à¤¬à¤°_à¤…à¤•à¥à¤Ÿà¥‚à¤¬à¤°_à¤¨à¤µà¤®à¥à¤¬à¤°_à¤¦à¤¿à¤¸à¤®à¥à¤¬à¤°'.split("_"),
      monthsShort : 'à¤œà¤¨._à¤«à¤¼à¤°._à¤®à¤¾à¤°à¥à¤š_à¤…à¤ªà¥à¤°à¥ˆ._à¤®à¤ˆ_à¤œà¥‚à¤¨_à¤œà¥à¤²._à¤…à¤—._à¤¸à¤¿à¤¤._à¤…à¤•à¥à¤Ÿà¥‚._à¤¨à¤µ._à¤¦à¤¿à¤¸.'.split("_"),
      weekdays : 'à¤°à¤µà¤¿à¤µà¤¾à¤°_à¤¸à¥‹à¤®à¤µà¤¾à¤°_à¤®à¤‚à¤—à¤²à¤µà¤¾à¤°_à¤¬à¥à¤§à¤µà¤¾à¤°_à¤—à¥à¤°à¥‚à¤µà¤¾à¤°_à¤¶à¥à¤•à¥à¤°à¤µà¤¾à¤°_à¤¶à¤¨à¤¿à¤µà¤¾à¤°'.split("_"),
      weekdaysShort : 'à¤°à¤µà¤¿_à¤¸à¥‹à¤®_à¤®à¤‚à¤—à¤²_à¤¬à¥à¤§_à¤—à¥à¤°à¥‚_à¤¶à¥à¤•à¥à¤°_à¤¶à¤¨à¤¿'.split("_"),
      weekdaysMin : 'à¤°_à¤¸à¥‹_à¤®à¤‚_à¤¬à¥_à¤—à¥_à¤¶à¥_à¤¶'.split("_"),
      longDateFormat : {
        LT : "A h:mm à¤¬à¤œà¥‡",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY, LT",
        LLLL : "dddd, D MMMM YYYY, LT"
      },
      calendar : {
        sameDay : '[à¤†à¤œ] LT',
        nextDay : '[à¤•à¤²] LT',
        nextWeek : 'dddd, LT',
        lastDay : '[à¤•à¤²] LT',
        lastWeek : '[à¤ªà¤¿à¤›à¤²à¥‡] dddd, LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "%s à¤®à¥‡à¤‚",
        past : "%s à¤ªà¤¹à¤²à¥‡",
        s : "à¤•à¥à¤› à¤¹à¥€ à¤•à¥à¤·à¤£",
        m : "à¤à¤• à¤®à¤¿à¤¨à¤Ÿ",
        mm : "%d à¤®à¤¿à¤¨à¤Ÿ",
        h : "à¤à¤• à¤˜à¤‚à¤Ÿà¤¾",
        hh : "%d à¤˜à¤‚à¤Ÿà¥‡",
        d : "à¤à¤• à¤¦à¤¿à¤¨",
        dd : "%d à¤¦à¤¿à¤¨",
        M : "à¤à¤• à¤®à¤¹à¥€à¤¨à¥‡",
        MM : "%d à¤®à¤¹à¥€à¤¨à¥‡",
        y : "à¤à¤• à¤µà¤°à¥à¤·",
        yy : "%d à¤µà¤°à¥à¤·"
      },
      preparse: function (string) {
        return string.replace(/[à¥§à¥¨à¥©à¥ªà¥«à¥¬à¥­à¥®à¥¯à¥¦]/g, function (match) {
          return numberMap[match];
        });
      },
      postformat: function (string) {
        return string.replace(/\d/g, function (match) {
          return symbolMap[match];
        });
      },
      // Hindi notation for meridiems are quite fuzzy in practice. While there exists
      // a rigid notion of a 'Pahar' it is not used as rigidly in modern Hindi.
      meridiem : function (hour, minute, isLower) {
        if (hour < 4) {
          return "à¤°à¤¾à¤¤";
        } else if (hour < 10) {
          return "à¤¸à¥à¤¬à¤¹";
        } else if (hour < 17) {
          return "à¤¦à¥‹à¤ªà¤¹à¤°";
        } else if (hour < 20) {
          return "à¤¶à¤¾à¤®";
        } else {
          return "à¤°à¤¾à¤¤";
        }
      },
      week : {
        dow : 0, // Sunday is the first day of the week.
        doy : 6  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : hrvatski (hr)
// author : Bojan MarkoviÄ‡ : https://github.com/bmarkovic

// based on (sl) translation by Robert SedovÅ¡ek

  (function (factory) {
    factory(moment);
  }(function (moment) {

    function translate(number, withoutSuffix, key) {
      var result = number + " ";
      switch (key) {
        case 'm':
          return withoutSuffix ? 'jedna minuta' : 'jedne minute';
        case 'mm':
          if (number === 1) {
            result += 'minuta';
          } else if (number === 2 || number === 3 || number === 4) {
            result += 'minute';
          } else {
            result += 'minuta';
          }
          return result;
        case 'h':
          return withoutSuffix ? 'jedan sat' : 'jednog sata';
        case 'hh':
          if (number === 1) {
            result += 'sat';
          } else if (number === 2 || number === 3 || number === 4) {
            result += 'sata';
          } else {
            result += 'sati';
          }
          return result;
        case 'dd':
          if (number === 1) {
            result += 'dan';
          } else {
            result += 'dana';
          }
          return result;
        case 'MM':
          if (number === 1) {
            result += 'mjesec';
          } else if (number === 2 || number === 3 || number === 4) {
            result += 'mjeseca';
          } else {
            result += 'mjeseci';
          }
          return result;
        case 'yy':
          if (number === 1) {
            result += 'godina';
          } else if (number === 2 || number === 3 || number === 4) {
            result += 'godine';
          } else {
            result += 'godina';
          }
          return result;
      }
    }

    return moment.lang('hr', {
      months : "sjeÄanj_veljaÄa_oÅ¾ujak_travanj_svibanj_lipanj_srpanj_kolovoz_rujan_listopad_studeni_prosinac".split("_"),
      monthsShort : "sje._vel._oÅ¾u._tra._svi._lip._srp._kol._ruj._lis._stu._pro.".split("_"),
      weekdays : "nedjelja_ponedjeljak_utorak_srijeda_Äetvrtak_petak_subota".split("_"),
      weekdaysShort : "ned._pon._uto._sri._Äet._pet._sub.".split("_"),
      weekdaysMin : "ne_po_ut_sr_Äe_pe_su".split("_"),
      longDateFormat : {
        LT : "H:mm",
        L : "DD. MM. YYYY",
        LL : "D. MMMM YYYY",
        LLL : "D. MMMM YYYY LT",
        LLLL : "dddd, D. MMMM YYYY LT"
      },
      calendar : {
        sameDay  : '[danas u] LT',
        nextDay  : '[sutra u] LT',

        nextWeek : function () {
          switch (this.day()) {
            case 0:
              return '[u] [nedjelju] [u] LT';
            case 3:
              return '[u] [srijedu] [u] LT';
            case 6:
              return '[u] [subotu] [u] LT';
            case 1:
            case 2:
            case 4:
            case 5:
              return '[u] dddd [u] LT';
          }
        },
        lastDay  : '[juÄer u] LT',
        lastWeek : function () {
          switch (this.day()) {
            case 0:
            case 3:
              return '[proÅ¡lu] dddd [u] LT';
            case 6:
              return '[proÅ¡le] [subote] [u] LT';
            case 1:
            case 2:
            case 4:
            case 5:
              return '[proÅ¡li] dddd [u] LT';
          }
        },
        sameElse : 'L'
      },
      relativeTime : {
        future : "za %s",
        past   : "prije %s",
        s      : "par sekundi",
        m      : translate,
        mm     : translate,
        h      : translate,
        hh     : translate,
        d      : "dan",
        dd     : translate,
        M      : "mjesec",
        MM     : translate,
        y      : "godinu",
        yy     : translate
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : hungarian (hu)
// author : Adam Brunner : https://github.com/adambrunner

  (function (factory) {
    factory(moment);
  }(function (moment) {
    var weekEndings = 'vasÃ¡rnap hÃ©tfÅ‘n kedden szerdÃ¡n csÃ¼tÃ¶rtÃ¶kÃ¶n pÃ©nteken szombaton'.split(' ');

    function translate(number, withoutSuffix, key, isFuture) {
      var num = number,
        suffix;

      switch (key) {
        case 's':
          return (isFuture || withoutSuffix) ? 'nÃ©hÃ¡ny mÃ¡sodperc' : 'nÃ©hÃ¡ny mÃ¡sodperce';
        case 'm':
          return 'egy' + (isFuture || withoutSuffix ? ' perc' : ' perce');
        case 'mm':
          return num + (isFuture || withoutSuffix ? ' perc' : ' perce');
        case 'h':
          return 'egy' + (isFuture || withoutSuffix ? ' Ã³ra' : ' Ã³rÃ¡ja');
        case 'hh':
          return num + (isFuture || withoutSuffix ? ' Ã³ra' : ' Ã³rÃ¡ja');
        case 'd':
          return 'egy' + (isFuture || withoutSuffix ? ' nap' : ' napja');
        case 'dd':
          return num + (isFuture || withoutSuffix ? ' nap' : ' napja');
        case 'M':
          return 'egy' + (isFuture || withoutSuffix ? ' hÃ³nap' : ' hÃ³napja');
        case 'MM':
          return num + (isFuture || withoutSuffix ? ' hÃ³nap' : ' hÃ³napja');
        case 'y':
          return 'egy' + (isFuture || withoutSuffix ? ' Ã©v' : ' Ã©ve');
        case 'yy':
          return num + (isFuture || withoutSuffix ? ' Ã©v' : ' Ã©ve');
      }

      return '';
    }

    function week(isFuture) {
      return (isFuture ? '' : '[mÃºlt] ') + '[' + weekEndings[this.day()] + '] LT[-kor]';
    }

    return moment.lang('hu', {
      months : "januÃ¡r_februÃ¡r_mÃ¡rcius_Ã¡prilis_mÃ¡jus_jÃºnius_jÃºlius_augusztus_szeptember_oktÃ³ber_november_december".split("_"),
      monthsShort : "jan_feb_mÃ¡rc_Ã¡pr_mÃ¡j_jÃºn_jÃºl_aug_szept_okt_nov_dec".split("_"),
      weekdays : "vasÃ¡rnap_hÃ©tfÅ‘_kedd_szerda_csÃ¼tÃ¶rtÃ¶k_pÃ©ntek_szombat".split("_"),
      weekdaysShort : "vas_hÃ©t_kedd_sze_csÃ¼t_pÃ©n_szo".split("_"),
      weekdaysMin : "v_h_k_sze_cs_p_szo".split("_"),
      longDateFormat : {
        LT : "H:mm",
        L : "YYYY.MM.DD.",
        LL : "YYYY. MMMM D.",
        LLL : "YYYY. MMMM D., LT",
        LLLL : "YYYY. MMMM D., dddd LT"
      },
      calendar : {
        sameDay : '[ma] LT[-kor]',
        nextDay : '[holnap] LT[-kor]',
        nextWeek : function () {
          return week.call(this, true);
        },
        lastDay : '[tegnap] LT[-kor]',
        lastWeek : function () {
          return week.call(this, false);
        },
        sameElse : 'L'
      },
      relativeTime : {
        future : "%s mÃºlva",
        past : "%s",
        s : translate,
        m : translate,
        mm : translate,
        h : translate,
        hh : translate,
        d : translate,
        dd : translate,
        M : translate,
        MM : translate,
        y : translate,
        yy : translate
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : Bahasa Indonesia (id)
// author : Mohammad Satrio Utomo : https://github.com/tyok
// reference: http://id.wikisource.org/wiki/Pedoman_Umum_Ejaan_Bahasa_Indonesia_yang_Disempurnakan

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('id', {
      months : "Januari_Februari_Maret_April_Mei_Juni_Juli_Agustus_September_Oktober_November_Desember".split("_"),
      monthsShort : "Jan_Feb_Mar_Apr_Mei_Jun_Jul_Ags_Sep_Okt_Nov_Des".split("_"),
      weekdays : "Minggu_Senin_Selasa_Rabu_Kamis_Jumat_Sabtu".split("_"),
      weekdaysShort : "Min_Sen_Sel_Rab_Kam_Jum_Sab".split("_"),
      weekdaysMin : "Mg_Sn_Sl_Rb_Km_Jm_Sb".split("_"),
      longDateFormat : {
        LT : "HH.mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY [pukul] LT",
        LLLL : "dddd, D MMMM YYYY [pukul] LT"
      },
      meridiem : function (hours, minutes, isLower) {
        if (hours < 11) {
          return 'pagi';
        } else if (hours < 15) {
          return 'siang';
        } else if (hours < 19) {
          return 'sore';
        } else {
          return 'malam';
        }
      },
      calendar : {
        sameDay : '[Hari ini pukul] LT',
        nextDay : '[Besok pukul] LT',
        nextWeek : 'dddd [pukul] LT',
        lastDay : '[Kemarin pukul] LT',
        lastWeek : 'dddd [lalu pukul] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "dalam %s",
        past : "%s yang lalu",
        s : "beberapa detik",
        m : "semenit",
        mm : "%d menit",
        h : "sejam",
        hh : "%d jam",
        d : "sehari",
        dd : "%d hari",
        M : "sebulan",
        MM : "%d bulan",
        y : "setahun",
        yy : "%d tahun"
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : icelandic (is)
// author : Hinrik Ã–rn SigurÃ°sson : https://github.com/hinrik

  (function (factory) {
    factory(moment);
  }(function (moment) {
    function plural(n) {
      if (n % 100 === 11) {
        return true;
      } else if (n % 10 === 1) {
        return false;
      }
      return true;
    }

    function translate(number, withoutSuffix, key, isFuture) {
      var result = number + " ";
      switch (key) {
        case 's':
          return withoutSuffix || isFuture ? 'nokkrar sekÃºndur' : 'nokkrum sekÃºndum';
        case 'm':
          return withoutSuffix ? 'mÃ­nÃºta' : 'mÃ­nÃºtu';
        case 'mm':
          if (plural(number)) {
            return result + (withoutSuffix || isFuture ? 'mÃ­nÃºtur' : 'mÃ­nÃºtum');
          } else if (withoutSuffix) {
            return result + 'mÃ­nÃºta';
          }
          return result + 'mÃ­nÃºtu';
        case 'hh':
          if (plural(number)) {
            return result + (withoutSuffix || isFuture ? 'klukkustundir' : 'klukkustundum');
          }
          return result + 'klukkustund';
        case 'd':
          if (withoutSuffix) {
            return 'dagur';
          }
          return isFuture ? 'dag' : 'degi';
        case 'dd':
          if (plural(number)) {
            if (withoutSuffix) {
              return result + 'dagar';
            }
            return result + (isFuture ? 'daga' : 'dÃ¶gum');
          } else if (withoutSuffix) {
            return result + 'dagur';
          }
          return result + (isFuture ? 'dag' : 'degi');
        case 'M':
          if (withoutSuffix) {
            return 'mÃ¡nuÃ°ur';
          }
          return isFuture ? 'mÃ¡nuÃ°' : 'mÃ¡nuÃ°i';
        case 'MM':
          if (plural(number)) {
            if (withoutSuffix) {
              return result + 'mÃ¡nuÃ°ir';
            }
            return result + (isFuture ? 'mÃ¡nuÃ°i' : 'mÃ¡nuÃ°um');
          } else if (withoutSuffix) {
            return result + 'mÃ¡nuÃ°ur';
          }
          return result + (isFuture ? 'mÃ¡nuÃ°' : 'mÃ¡nuÃ°i');
        case 'y':
          return withoutSuffix || isFuture ? 'Ã¡r' : 'Ã¡ri';
        case 'yy':
          if (plural(number)) {
            return result + (withoutSuffix || isFuture ? 'Ã¡r' : 'Ã¡rum');
          }
          return result + (withoutSuffix || isFuture ? 'Ã¡r' : 'Ã¡ri');
      }
    }

    return moment.lang('is', {
      months : "janÃºar_febrÃºar_mars_aprÃ­l_maÃ­_jÃºnÃ­_jÃºlÃ­_Ã¡gÃºst_september_oktÃ³ber_nÃ³vember_desember".split("_"),
      monthsShort : "jan_feb_mar_apr_maÃ­_jÃºn_jÃºl_Ã¡gÃº_sep_okt_nÃ³v_des".split("_"),
      weekdays : "sunnudagur_mÃ¡nudagur_Ã¾riÃ°judagur_miÃ°vikudagur_fimmtudagur_fÃ¶studagur_laugardagur".split("_"),
      weekdaysShort : "sun_mÃ¡n_Ã¾ri_miÃ°_fim_fÃ¶s_lau".split("_"),
      weekdaysMin : "Su_MÃ¡_Ãžr_Mi_Fi_FÃ¶_La".split("_"),
      longDateFormat : {
        LT : "H:mm",
        L : "DD/MM/YYYY",
        LL : "D. MMMM YYYY",
        LLL : "D. MMMM YYYY [kl.] LT",
        LLLL : "dddd, D. MMMM YYYY [kl.] LT"
      },
      calendar : {
        sameDay : '[Ã­ dag kl.] LT',
        nextDay : '[Ã¡ morgun kl.] LT',
        nextWeek : 'dddd [kl.] LT',
        lastDay : '[Ã­ gÃ¦r kl.] LT',
        lastWeek : '[sÃ­Ã°asta] dddd [kl.] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "eftir %s",
        past : "fyrir %s sÃ­Ã°an",
        s : translate,
        m : translate,
        mm : translate,
        h : "klukkustund",
        hh : translate,
        d : translate,
        dd : translate,
        M : translate,
        MM : translate,
        y : translate,
        yy : translate
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : italian (it)
// author : Lorenzo : https://github.com/aliem
// author: Mattia Larentis: https://github.com/nostalgiaz

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('it', {
      months : "Gennaio_Febbraio_Marzo_Aprile_Maggio_Giugno_Luglio_Agosto_Settembre_Ottobre_Novembre_Dicembre".split("_"),
      monthsShort : "Gen_Feb_Mar_Apr_Mag_Giu_Lug_Ago_Set_Ott_Nov_Dic".split("_"),
      weekdays : "Domenica_LunedÃ¬_MartedÃ¬_MercoledÃ¬_GiovedÃ¬_VenerdÃ¬_Sabato".split("_"),
      weekdaysShort : "Dom_Lun_Mar_Mer_Gio_Ven_Sab".split("_"),
      weekdaysMin : "D_L_Ma_Me_G_V_S".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd, D MMMM YYYY LT"
      },
      calendar : {
        sameDay: '[Oggi alle] LT',
        nextDay: '[Domani alle] LT',
        nextWeek: 'dddd [alle] LT',
        lastDay: '[Ieri alle] LT',
        lastWeek: '[lo scorso] dddd [alle] LT',
        sameElse: 'L'
      },
      relativeTime : {
        future : function (s) {
          return ((/^[0-9].+$/).test(s) ? "tra" : "in") + " " + s;
        },
        past : "%s fa",
        s : "secondi",
        m : "un minuto",
        mm : "%d minuti",
        h : "un'ora",
        hh : "%d ore",
        d : "un giorno",
        dd : "%d giorni",
        M : "un mese",
        MM : "%d mesi",
        y : "un anno",
        yy : "%d anni"
      },
      ordinal: '%dÂº',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : japanese (ja)
// author : LI Long : https://github.com/baryon

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('ja', {
      months : "1æœˆ_2æœˆ_3æœˆ_4æœˆ_5æœˆ_6æœˆ_7æœˆ_8æœˆ_9æœˆ_10æœˆ_11æœˆ_12æœˆ".split("_"),
      monthsShort : "1æœˆ_2æœˆ_3æœˆ_4æœˆ_5æœˆ_6æœˆ_7æœˆ_8æœˆ_9æœˆ_10æœˆ_11æœˆ_12æœˆ".split("_"),
      weekdays : "æ—¥æ›œæ—¥_æœˆæ›œæ—¥_ç«æ›œæ—¥_æ°´æ›œæ—¥_æœ¨æ›œæ—¥_é‡‘æ›œæ—¥_åœŸæ›œæ—¥".split("_"),
      weekdaysShort : "æ—¥_æœˆ_ç«_æ°´_æœ¨_é‡‘_åœŸ".split("_"),
      weekdaysMin : "æ—¥_æœˆ_ç«_æ°´_æœ¨_é‡‘_åœŸ".split("_"),
      longDateFormat : {
        LT : "Ahæ™‚måˆ†",
        L : "YYYY/MM/DD",
        LL : "YYYYå¹´MæœˆDæ—¥",
        LLL : "YYYYå¹´MæœˆDæ—¥LT",
        LLLL : "YYYYå¹´MæœˆDæ—¥LT dddd"
      },
      meridiem : function (hour, minute, isLower) {
        if (hour < 12) {
          return "åˆå‰";
        } else {
          return "åˆå¾Œ";
        }
      },
      calendar : {
        sameDay : '[ä»Šæ—¥] LT',
        nextDay : '[æ˜Žæ—¥] LT',
        nextWeek : '[æ¥é€±]dddd LT',
        lastDay : '[æ˜¨æ—¥] LT',
        lastWeek : '[å‰é€±]dddd LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "%så¾Œ",
        past : "%så‰",
        s : "æ•°ç§’",
        m : "1åˆ†",
        mm : "%dåˆ†",
        h : "1æ™‚é–“",
        hh : "%dæ™‚é–“",
        d : "1æ—¥",
        dd : "%dæ—¥",
        M : "1ãƒ¶æœˆ",
        MM : "%dãƒ¶æœˆ",
        y : "1å¹´",
        yy : "%då¹´"
      }
    });
  }));
// moment.js language configuration
// language : Georgian (ka)
// author : Irakli Janiashvili : https://github.com/irakli-janiashvili

  (function (factory) {
    factory(moment);
  }(function (moment) {

    function monthsCaseReplace(m, format) {
      var months = {
          'nominative': 'áƒ˜áƒáƒœáƒ•áƒáƒ áƒ˜_áƒ—áƒ”áƒ‘áƒ”áƒ áƒ•áƒáƒšáƒ˜_áƒ›áƒáƒ áƒ¢áƒ˜_áƒáƒžáƒ áƒ˜áƒšáƒ˜_áƒ›áƒáƒ˜áƒ¡áƒ˜_áƒ˜áƒ•áƒœáƒ˜áƒ¡áƒ˜_áƒ˜áƒ•áƒšáƒ˜áƒ¡áƒ˜_áƒáƒ’áƒ•áƒ˜áƒ¡áƒ¢áƒ_áƒ¡áƒ”áƒ¥áƒ¢áƒ”áƒ›áƒ‘áƒ”áƒ áƒ˜_áƒáƒ¥áƒ¢áƒáƒ›áƒ‘áƒ”áƒ áƒ˜_áƒœáƒáƒ”áƒ›áƒ‘áƒ”áƒ áƒ˜_áƒ“áƒ”áƒ™áƒ”áƒ›áƒ‘áƒ”áƒ áƒ˜'.split('_'),
          'accusative': 'áƒ˜áƒáƒœáƒ•áƒáƒ áƒ¡_áƒ—áƒ”áƒ‘áƒ”áƒ áƒ•áƒáƒšáƒ¡_áƒ›áƒáƒ áƒ¢áƒ¡_áƒáƒžáƒ áƒ˜áƒšáƒ˜áƒ¡_áƒ›áƒáƒ˜áƒ¡áƒ¡_áƒ˜áƒ•áƒœáƒ˜áƒ¡áƒ¡_áƒ˜áƒ•áƒšáƒ˜áƒ¡áƒ¡_áƒáƒ’áƒ•áƒ˜áƒ¡áƒ¢áƒ¡_áƒ¡áƒ”áƒ¥áƒ¢áƒ”áƒ›áƒ‘áƒ”áƒ áƒ¡_áƒáƒ¥áƒ¢áƒáƒ›áƒ‘áƒ”áƒ áƒ¡_áƒœáƒáƒ”áƒ›áƒ‘áƒ”áƒ áƒ¡_áƒ“áƒ”áƒ™áƒ”áƒ›áƒ‘áƒ”áƒ áƒ¡'.split('_')
        },

        nounCase = (/D[oD] *MMMM?/).test(format) ?
          'accusative' :
          'nominative';

      return months[nounCase][m.month()];
    }

    function weekdaysCaseReplace(m, format) {
      var weekdays = {
          'nominative': 'áƒ™áƒ•áƒ˜áƒ áƒ_áƒáƒ áƒ¨áƒáƒ‘áƒáƒ—áƒ˜_áƒ¡áƒáƒ›áƒ¨áƒáƒ‘áƒáƒ—áƒ˜_áƒáƒ—áƒ®áƒ¨áƒáƒ‘áƒáƒ—áƒ˜_áƒ®áƒ£áƒ—áƒ¨áƒáƒ‘áƒáƒ—áƒ˜_áƒžáƒáƒ áƒáƒ¡áƒ™áƒ”áƒ•áƒ˜_áƒ¨áƒáƒ‘áƒáƒ—áƒ˜'.split('_'),
          'accusative': 'áƒ™áƒ•áƒ˜áƒ áƒáƒ¡_áƒáƒ áƒ¨áƒáƒ‘áƒáƒ—áƒ¡_áƒ¡áƒáƒ›áƒ¨áƒáƒ‘áƒáƒ—áƒ¡_áƒáƒ—áƒ®áƒ¨áƒáƒ‘áƒáƒ—áƒ¡_áƒ®áƒ£áƒ—áƒ¨áƒáƒ‘áƒáƒ—áƒ¡_áƒžáƒáƒ áƒáƒ¡áƒ™áƒ”áƒ•áƒ¡_áƒ¨áƒáƒ‘áƒáƒ—áƒ¡'.split('_')
        },

        nounCase = (/(áƒ¬áƒ˜áƒœáƒ|áƒ¨áƒ”áƒ›áƒ“áƒ”áƒ’)/).test(format) ?
          'accusative' :
          'nominative';

      return weekdays[nounCase][m.day()];
    }

    return moment.lang('ka', {
      months : monthsCaseReplace,
      monthsShort : "áƒ˜áƒáƒœ_áƒ—áƒ”áƒ‘_áƒ›áƒáƒ _áƒáƒžáƒ _áƒ›áƒáƒ˜_áƒ˜áƒ•áƒœ_áƒ˜áƒ•áƒš_áƒáƒ’áƒ•_áƒ¡áƒ”áƒ¥_áƒáƒ¥áƒ¢_áƒœáƒáƒ”_áƒ“áƒ”áƒ™".split("_"),
      weekdays : weekdaysCaseReplace,
      weekdaysShort : "áƒ™áƒ•áƒ˜_áƒáƒ áƒ¨_áƒ¡áƒáƒ›_áƒáƒ—áƒ®_áƒ®áƒ£áƒ—_áƒžáƒáƒ _áƒ¨áƒáƒ‘".split("_"),
      weekdaysMin : "áƒ™áƒ•_áƒáƒ _áƒ¡áƒ_áƒáƒ—_áƒ®áƒ£_áƒžáƒ_áƒ¨áƒ".split("_"),
      longDateFormat : {
        LT : "h:mm A",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd, D MMMM YYYY LT"
      },
      calendar : {
        sameDay : '[áƒ“áƒ¦áƒ”áƒ¡] LT[-áƒ–áƒ”]',
        nextDay : '[áƒ®áƒ•áƒáƒš] LT[-áƒ–áƒ”]',
        lastDay : '[áƒ’áƒ£áƒ¨áƒ˜áƒœ] LT[-áƒ–áƒ”]',
        nextWeek : '[áƒ¨áƒ”áƒ›áƒ“áƒ”áƒ’] dddd LT[-áƒ–áƒ”]',
        lastWeek : '[áƒ¬áƒ˜áƒœáƒ] dddd LT-áƒ–áƒ”',
        sameElse : 'L'
      },
      relativeTime : {
        future : function (s) {
          return (/(áƒ¬áƒáƒ›áƒ˜|áƒ¬áƒ£áƒ—áƒ˜|áƒ¡áƒáƒáƒ—áƒ˜|áƒ¬áƒ”áƒšáƒ˜)/).test(s) ?
            s.replace(/áƒ˜$/, "áƒ¨áƒ˜") :
            s + "áƒ¨áƒ˜";
        },
        past : function (s) {
          if ((/(áƒ¬áƒáƒ›áƒ˜|áƒ¬áƒ£áƒ—áƒ˜|áƒ¡áƒáƒáƒ—áƒ˜|áƒ“áƒ¦áƒ”|áƒ—áƒ•áƒ”)/).test(s)) {
            return s.replace(/(áƒ˜|áƒ”)$/, "áƒ˜áƒ¡ áƒ¬áƒ˜áƒœ");
          }
          if ((/áƒ¬áƒ”áƒšáƒ˜/).test(s)) {
            return s.replace(/áƒ¬áƒ”áƒšáƒ˜$/, "áƒ¬áƒšáƒ˜áƒ¡ áƒ¬áƒ˜áƒœ");
          }
        },
        s : "áƒ áƒáƒ›áƒ“áƒ”áƒœáƒ˜áƒ›áƒ” áƒ¬áƒáƒ›áƒ˜",
        m : "áƒ¬áƒ£áƒ—áƒ˜",
        mm : "%d áƒ¬áƒ£áƒ—áƒ˜",
        h : "áƒ¡áƒáƒáƒ—áƒ˜",
        hh : "%d áƒ¡áƒáƒáƒ—áƒ˜",
        d : "áƒ“áƒ¦áƒ”",
        dd : "%d áƒ“áƒ¦áƒ”",
        M : "áƒ—áƒ•áƒ”",
        MM : "%d áƒ—áƒ•áƒ”",
        y : "áƒ¬áƒ”áƒšáƒ˜",
        yy : "%d áƒ¬áƒ”áƒšáƒ˜"
      },
      ordinal : function (number) {
        if (number === 0) {
          return number;
        }

        if (number === 1) {
          return number + "-áƒšáƒ˜";
        }

        if ((number < 20) || (number <= 100 && (number % 20 === 0)) || (number % 100 === 0)) {
          return "áƒ›áƒ”-" + number;
        }

        return number + "-áƒ”";
      },
      week : {
        dow : 1,
        doy : 7
      }
    });
  }));
// moment.js language configuration
// language : korean (ko)
// author : Kyungwook, Park : https://github.com/kyungw00k

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('ko', {
      months : "1ì›”_2ì›”_3ì›”_4ì›”_5ì›”_6ì›”_7ì›”_8ì›”_9ì›”_10ì›”_11ì›”_12ì›”".split("_"),
      monthsShort : "1ì›”_2ì›”_3ì›”_4ì›”_5ì›”_6ì›”_7ì›”_8ì›”_9ì›”_10ì›”_11ì›”_12ì›”".split("_"),
      weekdays : "ì¼ìš”ì¼_ì›”ìš”ì¼_í™”ìš”ì¼_ìˆ˜ìš”ì¼_ëª©ìš”ì¼_ê¸ˆìš”ì¼_í† ìš”ì¼".split("_"),
      weekdaysShort : "ì¼_ì›”_í™”_ìˆ˜_ëª©_ê¸ˆ_í† ".split("_"),
      weekdaysMin : "ì¼_ì›”_í™”_ìˆ˜_ëª©_ê¸ˆ_í† ".split("_"),
      longDateFormat : {
        LT : "A hì‹œ mmë¶„",
        L : "YYYY.MM.DD",
        LL : "YYYYë…„ MMMM Dì¼",
        LLL : "YYYYë…„ MMMM Dì¼ LT",
        LLLL : "YYYYë…„ MMMM Dì¼ dddd LT"
      },
      meridiem : function (hour, minute, isUpper) {
        return hour < 12 ? 'ì˜¤ì „' : 'ì˜¤í›„';
      },
      calendar : {
        sameDay : 'ì˜¤ëŠ˜ LT',
        nextDay : 'ë‚´ì¼ LT',
        nextWeek : 'dddd LT',
        lastDay : 'ì–´ì œ LT',
        lastWeek : 'ì§€ë‚œì£¼ dddd LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "%s í›„",
        past : "%s ì „",
        s : "ëª‡ì´ˆ",
        ss : "%dì´ˆ",
        m : "ì¼ë¶„",
        mm : "%dë¶„",
        h : "í•œì‹œê°„",
        hh : "%dì‹œê°„",
        d : "í•˜ë£¨",
        dd : "%dì¼",
        M : "í•œë‹¬",
        MM : "%dë‹¬",
        y : "ì¼ë…„",
        yy : "%dë…„"
      },
      ordinal : '%dì¼'
    });
  }));
// moment.js language configuration
// language : Lithuanian (lt)
// author : Mindaugas MozÅ«ras : https://github.com/mmozuras

  (function (factory) {
    factory(moment);
  }(function (moment) {
    var units = {
        "m" : "minutÄ—_minutÄ—s_minutÄ™",
        "mm": "minutÄ—s_minuÄiÅ³_minutes",
        "h" : "valanda_valandos_valandÄ…",
        "hh": "valandos_valandÅ³_valandas",
        "d" : "diena_dienos_dienÄ…",
        "dd": "dienos_dienÅ³_dienas",
        "M" : "mÄ—nuo_mÄ—nesio_mÄ—nesÄ¯",
        "MM": "mÄ—nesiai_mÄ—nesiÅ³_mÄ—nesius",
        "y" : "metai_metÅ³_metus",
        "yy": "metai_metÅ³_metus"
      },
      weekDays = "pirmadienis_antradienis_treÄiadienis_ketvirtadienis_penktadienis_Å¡eÅ¡tadienis_sekmadienis".split("_");

    function translateSeconds(number, withoutSuffix, key, isFuture) {
      if (withoutSuffix) {
        return "kelios sekundÄ—s";
      } else {
        return isFuture ? "keliÅ³ sekundÅ¾iÅ³" : "kelias sekundes";
      }
    }

    function translateSingular(number, withoutSuffix, key, isFuture) {
      return withoutSuffix ? forms(key)[0] : (isFuture ? forms(key)[1] : forms(key)[2]);
    }

    function special(number) {
      return number % 10 === 0 || (number > 10 && number < 20);
    }

    function forms(key) {
      return units[key].split("_");
    }

    function translate(number, withoutSuffix, key, isFuture) {
      var result = number + " ";
      if (number === 1) {
        return result + translateSingular(number, withoutSuffix, key[0], isFuture);
      } else if (withoutSuffix) {
        return result + (special(number) ? forms(key)[1] : forms(key)[0]);
      } else {
        if (isFuture) {
          return result + forms(key)[1];
        } else {
          return result + (special(number) ? forms(key)[1] : forms(key)[2]);
        }
      }
    }

    function relativeWeekDay(moment, format) {
      var nominative = format.indexOf('dddd LT') === -1,
        weekDay = weekDays[moment.weekday()];

      return nominative ? weekDay : weekDay.substring(0, weekDay.length - 2) + "Ä¯";
    }

    return moment.lang("lt", {
      months : "sausio_vasario_kovo_balandÅ¾io_geguÅ¾Ä—s_birÅ¾Ä—lio_liepos_rugpjÅ«Äio_rugsÄ—jo_spalio_lapkriÄio_gruodÅ¾io".split("_"),
      monthsShort : "sau_vas_kov_bal_geg_bir_lie_rgp_rgs_spa_lap_grd".split("_"),
      weekdays : relativeWeekDay,
      weekdaysShort : "Sek_Pir_Ant_Tre_Ket_Pen_Å eÅ¡".split("_"),
      weekdaysMin : "S_P_A_T_K_Pn_Å ".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "YYYY-MM-DD",
        LL : "YYYY [m.] MMMM D [d.]",
        LLL : "YYYY [m.] MMMM D [d.], LT [val.]",
        LLLL : "YYYY [m.] MMMM D [d.], dddd, LT [val.]",
        l : "YYYY-MM-DD",
        ll : "YYYY [m.] MMMM D [d.]",
        lll : "YYYY [m.] MMMM D [d.], LT [val.]",
        llll : "YYYY [m.] MMMM D [d.], ddd, LT [val.]"
      },
      calendar : {
        sameDay : "[Å iandien] LT",
        nextDay : "[Rytoj] LT",
        nextWeek : "dddd LT",
        lastDay : "[Vakar] LT",
        lastWeek : "[PraÄ—jusÄ¯] dddd LT",
        sameElse : "L"
      },
      relativeTime : {
        future : "po %s",
        past : "prieÅ¡ %s",
        s : translateSeconds,
        m : translateSingular,
        mm : translate,
        h : translateSingular,
        hh : translate,
        d : translateSingular,
        dd : translate,
        M : translateSingular,
        MM : translate,
        y : translateSingular,
        yy : translate
      },
      ordinal : function (number) {
        return number + '-oji';
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : latvian (lv)
// author : Kristaps Karlsons : https://github.com/skakri

  (function (factory) {
    factory(moment);
  }(function (moment) {
    var units = {
      'mm': 'minÅ«ti_minÅ«tes_minÅ«te_minÅ«tes',
      'hh': 'stundu_stundas_stunda_stundas',
      'dd': 'dienu_dienas_diena_dienas',
      'MM': 'mÄ“nesi_mÄ“neÅ¡us_mÄ“nesis_mÄ“neÅ¡i',
      'yy': 'gadu_gadus_gads_gadi'
    };

    function format(word, number, withoutSuffix) {
      var forms = word.split('_');
      if (withoutSuffix) {
        return number % 10 === 1 && number !== 11 ? forms[2] : forms[3];
      } else {
        return number % 10 === 1 && number !== 11 ? forms[0] : forms[1];
      }
    }

    function relativeTimeWithPlural(number, withoutSuffix, key) {
      return number + ' ' + format(units[key], number, withoutSuffix);
    }

    return moment.lang('lv', {
      months : "janvÄris_februÄris_marts_aprÄ«lis_maijs_jÅ«nijs_jÅ«lijs_augusts_septembris_oktobris_novembris_decembris".split("_"),
      monthsShort : "jan_feb_mar_apr_mai_jÅ«n_jÅ«l_aug_sep_okt_nov_dec".split("_"),
      weekdays : "svÄ“tdiena_pirmdiena_otrdiena_treÅ¡diena_ceturtdiena_piektdiena_sestdiena".split("_"),
      weekdaysShort : "Sv_P_O_T_C_Pk_S".split("_"),
      weekdaysMin : "Sv_P_O_T_C_Pk_S".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD.MM.YYYY",
        LL : "YYYY. [gada] D. MMMM",
        LLL : "YYYY. [gada] D. MMMM, LT",
        LLLL : "YYYY. [gada] D. MMMM, dddd, LT"
      },
      calendar : {
        sameDay : '[Å odien pulksten] LT',
        nextDay : '[RÄ«t pulksten] LT',
        nextWeek : 'dddd [pulksten] LT',
        lastDay : '[Vakar pulksten] LT',
        lastWeek : '[PagÄjuÅ¡Ä] dddd [pulksten] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "%s vÄ“lÄk",
        past : "%s agrÄk",
        s : "daÅ¾as sekundes",
        m : "minÅ«ti",
        mm : relativeTimeWithPlural,
        h : "stundu",
        hh : relativeTimeWithPlural,
        d : "dienu",
        dd : relativeTimeWithPlural,
        M : "mÄ“nesi",
        MM : relativeTimeWithPlural,
        y : "gadu",
        yy : relativeTimeWithPlural
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : malayalam (ml)
// author : Floyd Pink : https://github.com/floydpink

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('ml', {
      months : 'à´œà´¨àµà´µà´°à´¿_à´«àµ†à´¬àµà´°àµà´µà´°à´¿_à´®à´¾àµ¼à´šàµà´šàµ_à´à´ªàµà´°à´¿àµ½_à´®àµ‡à´¯àµ_à´œàµ‚àµº_à´œàµ‚à´²àµˆ_à´“à´—à´¸àµà´±àµà´±àµ_à´¸àµ†à´ªàµà´±àµà´±à´‚à´¬àµ¼_à´’à´•àµà´Ÿàµ‹à´¬àµ¼_à´¨à´µà´‚à´¬àµ¼_à´¡à´¿à´¸à´‚à´¬àµ¼'.split("_"),
      monthsShort : 'à´œà´¨àµ._à´«àµ†à´¬àµà´°àµ._à´®à´¾àµ¼._à´à´ªàµà´°à´¿._à´®àµ‡à´¯àµ_à´œàµ‚àµº_à´œàµ‚à´²àµˆ._à´“à´—._à´¸àµ†à´ªàµà´±àµà´±._à´’à´•àµà´Ÿàµ‹._à´¨à´µà´‚._à´¡à´¿à´¸à´‚.'.split("_"),
      weekdays : 'à´žà´¾à´¯à´±à´¾à´´àµà´š_à´¤à´¿à´™àµà´•à´³à´¾à´´àµà´š_à´šàµŠà´µàµà´µà´¾à´´àµà´š_à´¬àµà´§à´¨à´¾à´´àµà´š_à´µàµà´¯à´¾à´´à´¾à´´àµà´š_à´µàµ†à´³àµà´³à´¿à´¯à´¾à´´àµà´š_à´¶à´¨à´¿à´¯à´¾à´´àµà´š'.split("_"),
      weekdaysShort : 'à´žà´¾à´¯àµ¼_à´¤à´¿à´™àµà´•àµ¾_à´šàµŠà´µàµà´µ_à´¬àµà´§àµ»_à´µàµà´¯à´¾à´´à´‚_à´µàµ†à´³àµà´³à´¿_à´¶à´¨à´¿'.split("_"),
      weekdaysMin : 'à´žà´¾_à´¤à´¿_à´šàµŠ_à´¬àµ_à´µàµà´¯à´¾_à´µàµ†_à´¶'.split("_"),
      longDateFormat : {
        LT : "A h:mm -à´¨àµ",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY, LT",
        LLLL : "dddd, D MMMM YYYY, LT"
      },
      calendar : {
        sameDay : '[à´‡à´¨àµà´¨àµ] LT',
        nextDay : '[à´¨à´¾à´³àµ†] LT',
        nextWeek : 'dddd, LT',
        lastDay : '[à´‡à´¨àµà´¨à´²àµ†] LT',
        lastWeek : '[à´•à´´à´¿à´žàµà´ž] dddd, LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "%s à´•à´´à´¿à´žàµà´žàµ",
        past : "%s à´®àµàµ»à´ªàµ",
        s : "à´…àµ½à´ª à´¨à´¿à´®à´¿à´·à´™àµà´™àµ¾",
        m : "à´’à´°àµ à´®à´¿à´¨à´¿à´±àµà´±àµ",
        mm : "%d à´®à´¿à´¨à´¿à´±àµà´±àµ",
        h : "à´’à´°àµ à´®à´£à´¿à´•àµà´•àµ‚àµ¼",
        hh : "%d à´®à´£à´¿à´•àµà´•àµ‚àµ¼",
        d : "à´’à´°àµ à´¦à´¿à´µà´¸à´‚",
        dd : "%d à´¦à´¿à´µà´¸à´‚",
        M : "à´’à´°àµ à´®à´¾à´¸à´‚",
        MM : "%d à´®à´¾à´¸à´‚",
        y : "à´’à´°àµ à´µàµ¼à´·à´‚",
        yy : "%d à´µàµ¼à´·à´‚"
      },
      meridiem : function (hour, minute, isLower) {
        if (hour < 4) {
          return "à´°à´¾à´¤àµà´°à´¿";
        } else if (hour < 12) {
          return "à´°à´¾à´µà´¿à´²àµ†";
        } else if (hour < 17) {
          return "à´‰à´šàµà´š à´•à´´à´¿à´žàµà´žàµ";
        } else if (hour < 20) {
          return "à´µàµˆà´•àµà´¨àµà´¨àµ‡à´°à´‚";
        } else {
          return "à´°à´¾à´¤àµà´°à´¿";
        }
      }
    });
  }));
// moment.js language configuration
// language : Marathi (mr)
// author : Harshad Kale : https://github.com/kalehv

  (function (factory) {
    factory(moment);
  }(function (moment) {
    var symbolMap = {
        '1': 'à¥§',
        '2': 'à¥¨',
        '3': 'à¥©',
        '4': 'à¥ª',
        '5': 'à¥«',
        '6': 'à¥¬',
        '7': 'à¥­',
        '8': 'à¥®',
        '9': 'à¥¯',
        '0': 'à¥¦'
      },
      numberMap = {
        'à¥§': '1',
        'à¥¨': '2',
        'à¥©': '3',
        'à¥ª': '4',
        'à¥«': '5',
        'à¥¬': '6',
        'à¥­': '7',
        'à¥®': '8',
        'à¥¯': '9',
        'à¥¦': '0'
      };

    return moment.lang('mr', {
      months : 'à¤œà¤¾à¤¨à¥‡à¤µà¤¾à¤°à¥€_à¤«à¥‡à¤¬à¥à¤°à¥à¤µà¤¾à¤°à¥€_à¤®à¤¾à¤°à¥à¤š_à¤à¤ªà¥à¤°à¤¿à¤²_à¤®à¥‡_à¤œà¥‚à¤¨_à¤œà¥à¤²à¥ˆ_à¤‘à¤—à¤¸à¥à¤Ÿ_à¤¸à¤ªà¥à¤Ÿà¥‡à¤‚à¤¬à¤°_à¤‘à¤•à¥à¤Ÿà¥‹à¤¬à¤°_à¤¨à¥‹à¤µà¥à¤¹à¥‡à¤‚à¤¬à¤°_à¤¡à¤¿à¤¸à¥‡à¤‚à¤¬à¤°'.split("_"),
      monthsShort: 'à¤œà¤¾à¤¨à¥‡._à¤«à¥‡à¤¬à¥à¤°à¥._à¤®à¤¾à¤°à¥à¤š._à¤à¤ªà¥à¤°à¤¿._à¤®à¥‡._à¤œà¥‚à¤¨._à¤œà¥à¤²à¥ˆ._à¤‘à¤—._à¤¸à¤ªà¥à¤Ÿà¥‡à¤‚._à¤‘à¤•à¥à¤Ÿà¥‹._à¤¨à¥‹à¤µà¥à¤¹à¥‡à¤‚._à¤¡à¤¿à¤¸à¥‡à¤‚.'.split("_"),
      weekdays : 'à¤°à¤µà¤¿à¤µà¤¾à¤°_à¤¸à¥‹à¤®à¤µà¤¾à¤°_à¤®à¤‚à¤—à¤³à¤µà¤¾à¤°_à¤¬à¥à¤§à¤µà¤¾à¤°_à¤—à¥à¤°à¥‚à¤µà¤¾à¤°_à¤¶à¥à¤•à¥à¤°à¤µà¤¾à¤°_à¤¶à¤¨à¤¿à¤µà¤¾à¤°'.split("_"),
      weekdaysShort : 'à¤°à¤µà¤¿_à¤¸à¥‹à¤®_à¤®à¤‚à¤—à¤³_à¤¬à¥à¤§_à¤—à¥à¤°à¥‚_à¤¶à¥à¤•à¥à¤°_à¤¶à¤¨à¤¿'.split("_"),
      weekdaysMin : 'à¤°_à¤¸à¥‹_à¤®à¤‚_à¤¬à¥_à¤—à¥_à¤¶à¥_à¤¶'.split("_"),
      longDateFormat : {
        LT : "A h:mm à¤µà¤¾à¤œà¤¤à¤¾",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY, LT",
        LLLL : "dddd, D MMMM YYYY, LT"
      },
      calendar : {
        sameDay : '[à¤†à¤œ] LT',
        nextDay : '[à¤‰à¤¦à¥à¤¯à¤¾] LT',
        nextWeek : 'dddd, LT',
        lastDay : '[à¤•à¤¾à¤²] LT',
        lastWeek: '[à¤®à¤¾à¤—à¥€à¤²] dddd, LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "%s à¤¨à¤‚à¤¤à¤°",
        past : "%s à¤ªà¥‚à¤°à¥à¤µà¥€",
        s : "à¤¸à¥‡à¤•à¤‚à¤¦",
        m: "à¤à¤• à¤®à¤¿à¤¨à¤¿à¤Ÿ",
        mm: "%d à¤®à¤¿à¤¨à¤¿à¤Ÿà¥‡",
        h : "à¤à¤• à¤¤à¤¾à¤¸",
        hh : "%d à¤¤à¤¾à¤¸",
        d : "à¤à¤• à¤¦à¤¿à¤µà¤¸",
        dd : "%d à¤¦à¤¿à¤µà¤¸",
        M : "à¤à¤• à¤®à¤¹à¤¿à¤¨à¤¾",
        MM : "%d à¤®à¤¹à¤¿à¤¨à¥‡",
        y : "à¤à¤• à¤µà¤°à¥à¤·",
        yy : "%d à¤µà¤°à¥à¤·à¥‡"
      },
      preparse: function (string) {
        return string.replace(/[à¥§à¥¨à¥©à¥ªà¥«à¥¬à¥­à¥®à¥¯à¥¦]/g, function (match) {
          return numberMap[match];
        });
      },
      postformat: function (string) {
        return string.replace(/\d/g, function (match) {
          return symbolMap[match];
        });
      },
      meridiem: function (hour, minute, isLower)
      {
        if (hour < 4) {
          return "à¤°à¤¾à¤¤à¥à¤°à¥€";
        } else if (hour < 10) {
          return "à¤¸à¤•à¤¾à¤³à¥€";
        } else if (hour < 17) {
          return "à¤¦à¥à¤ªà¤¾à¤°à¥€";
        } else if (hour < 20) {
          return "à¤¸à¤¾à¤¯à¤‚à¤•à¤¾à¤³à¥€";
        } else {
          return "à¤°à¤¾à¤¤à¥à¤°à¥€";
        }
      },
      week : {
        dow : 0, // Sunday is the first day of the week.
        doy : 6  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : Bahasa Malaysia (ms-MY)
// author : Weldan Jamili : https://github.com/weldan

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('ms-my', {
      months : "Januari_Februari_Mac_April_Mei_Jun_Julai_Ogos_September_Oktober_November_Disember".split("_"),
      monthsShort : "Jan_Feb_Mac_Apr_Mei_Jun_Jul_Ogs_Sep_Okt_Nov_Dis".split("_"),
      weekdays : "Ahad_Isnin_Selasa_Rabu_Khamis_Jumaat_Sabtu".split("_"),
      weekdaysShort : "Ahd_Isn_Sel_Rab_Kha_Jum_Sab".split("_"),
      weekdaysMin : "Ah_Is_Sl_Rb_Km_Jm_Sb".split("_"),
      longDateFormat : {
        LT : "HH.mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY [pukul] LT",
        LLLL : "dddd, D MMMM YYYY [pukul] LT"
      },
      meridiem : function (hours, minutes, isLower) {
        if (hours < 11) {
          return 'pagi';
        } else if (hours < 15) {
          return 'tengahari';
        } else if (hours < 19) {
          return 'petang';
        } else {
          return 'malam';
        }
      },
      calendar : {
        sameDay : '[Hari ini pukul] LT',
        nextDay : '[Esok pukul] LT',
        nextWeek : 'dddd [pukul] LT',
        lastDay : '[Kelmarin pukul] LT',
        lastWeek : 'dddd [lepas pukul] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "dalam %s",
        past : "%s yang lepas",
        s : "beberapa saat",
        m : "seminit",
        mm : "%d minit",
        h : "sejam",
        hh : "%d jam",
        d : "sehari",
        dd : "%d hari",
        M : "sebulan",
        MM : "%d bulan",
        y : "setahun",
        yy : "%d tahun"
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : norwegian bokmÃ¥l (nb)
// authors : Espen Hovlandsdal : https://github.com/rexxars
//           Sigurd Gartmann : https://github.com/sigurdga

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('nb', {
      months : "januar_februar_mars_april_mai_juni_juli_august_september_oktober_november_desember".split("_"),
      monthsShort : "jan._feb._mars_april_mai_juni_juli_aug._sep._okt._nov._des.".split("_"),
      weekdays : "sÃ¸ndag_mandag_tirsdag_onsdag_torsdag_fredag_lÃ¸rdag".split("_"),
      weekdaysShort : "sÃ¸._ma._ti._on._to._fr._lÃ¸.".split("_"),
      weekdaysMin : "sÃ¸_ma_ti_on_to_fr_lÃ¸".split("_"),
      longDateFormat : {
        LT : "H.mm",
        L : "DD.MM.YYYY",
        LL : "D. MMMM YYYY",
        LLL : "D. MMMM YYYY [kl.] LT",
        LLLL : "dddd D. MMMM YYYY [kl.] LT"
      },
      calendar : {
        sameDay: '[i dag kl.] LT',
        nextDay: '[i morgen kl.] LT',
        nextWeek: 'dddd [kl.] LT',
        lastDay: '[i gÃ¥r kl.] LT',
        lastWeek: '[forrige] dddd [kl.] LT',
        sameElse: 'L'
      },
      relativeTime : {
        future : "om %s",
        past : "for %s siden",
        s : "noen sekunder",
        m : "ett minutt",
        mm : "%d minutter",
        h : "en time",
        hh : "%d timer",
        d : "en dag",
        dd : "%d dager",
        M : "en mÃ¥ned",
        MM : "%d mÃ¥neder",
        y : "ett Ã¥r",
        yy : "%d Ã¥r"
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : nepali/nepalese
// author : suvash : https://github.com/suvash

  (function (factory) {
    factory(moment);
  }(function (moment) {
    var symbolMap = {
        '1': 'à¥§',
        '2': 'à¥¨',
        '3': 'à¥©',
        '4': 'à¥ª',
        '5': 'à¥«',
        '6': 'à¥¬',
        '7': 'à¥­',
        '8': 'à¥®',
        '9': 'à¥¯',
        '0': 'à¥¦'
      },
      numberMap = {
        'à¥§': '1',
        'à¥¨': '2',
        'à¥©': '3',
        'à¥ª': '4',
        'à¥«': '5',
        'à¥¬': '6',
        'à¥­': '7',
        'à¥®': '8',
        'à¥¯': '9',
        'à¥¦': '0'
      };

    return moment.lang('ne', {
      months : 'à¤œà¤¨à¤µà¤°à¥€_à¤«à¥‡à¤¬à¥à¤°à¥à¤µà¤°à¥€_à¤®à¤¾à¤°à¥à¤š_à¤…à¤ªà¥à¤°à¤¿à¤²_à¤®à¤ˆ_à¤œà¥à¤¨_à¤œà¥à¤²à¤¾à¤ˆ_à¤…à¤—à¤·à¥à¤Ÿ_à¤¸à¥‡à¤ªà¥à¤Ÿà¥‡à¤®à¥à¤¬à¤°_à¤…à¤•à¥à¤Ÿà¥‹à¤¬à¤°_à¤¨à¥‹à¤­à¥‡à¤®à¥à¤¬à¤°_à¤¡à¤¿à¤¸à¥‡à¤®à¥à¤¬à¤°'.split("_"),
      monthsShort : 'à¤œà¤¨._à¤«à¥‡à¤¬à¥à¤°à¥._à¤®à¤¾à¤°à¥à¤š_à¤…à¤ªà¥à¤°à¤¿._à¤®à¤ˆ_à¤œà¥à¤¨_à¤œà¥à¤²à¤¾à¤ˆ._à¤…à¤—._à¤¸à¥‡à¤ªà¥à¤Ÿ._à¤…à¤•à¥à¤Ÿà¥‹._à¤¨à¥‹à¤­à¥‡._à¤¡à¤¿à¤¸à¥‡.'.split("_"),
      weekdays : 'à¤†à¤‡à¤¤à¤¬à¤¾à¤°_à¤¸à¥‹à¤®à¤¬à¤¾à¤°_à¤®à¤™à¥à¤—à¤²à¤¬à¤¾à¤°_à¤¬à¥à¤§à¤¬à¤¾à¤°_à¤¬à¤¿à¤¹à¤¿à¤¬à¤¾à¤°_à¤¶à¥à¤•à¥à¤°à¤¬à¤¾à¤°_à¤¶à¤¨à¤¿à¤¬à¤¾à¤°'.split("_"),
      weekdaysShort : 'à¤†à¤‡à¤¤._à¤¸à¥‹à¤®._à¤®à¤™à¥à¤—à¤²._à¤¬à¥à¤§._à¤¬à¤¿à¤¹à¤¿._à¤¶à¥à¤•à¥à¤°._à¤¶à¤¨à¤¿.'.split("_"),
      weekdaysMin : 'à¤†à¤‡._à¤¸à¥‹._à¤®à¤™à¥_à¤¬à¥._à¤¬à¤¿._à¤¶à¥._à¤¶.'.split("_"),
      longDateFormat : {
        LT : "Aà¤•à¥‹ h:mm à¤¬à¤œà¥‡",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY, LT",
        LLLL : "dddd, D MMMM YYYY, LT"
      },
      preparse: function (string) {
        return string.replace(/[à¥§à¥¨à¥©à¥ªà¥«à¥¬à¥­à¥®à¥¯à¥¦]/g, function (match) {
          return numberMap[match];
        });
      },
      postformat: function (string) {
        return string.replace(/\d/g, function (match) {
          return symbolMap[match];
        });
      },
      meridiem : function (hour, minute, isLower) {
        if (hour < 3) {
          return "à¤°à¤¾à¤¤à¥€";
        } else if (hour < 10) {
          return "à¤¬à¤¿à¤¹à¤¾à¤¨";
        } else if (hour < 15) {
          return "à¤¦à¤¿à¤‰à¤à¤¸à¥‹";
        } else if (hour < 18) {
          return "à¤¬à¥‡à¤²à¥à¤•à¤¾";
        } else if (hour < 20) {
          return "à¤¸à¤¾à¤à¤";
        } else {
          return "à¤°à¤¾à¤¤à¥€";
        }
      },
      calendar : {
        sameDay : '[à¤†à¤œ] LT',
        nextDay : '[à¤­à¥‹à¤²à¥€] LT',
        nextWeek : '[à¤†à¤‰à¤à¤¦à¥‹] dddd[,] LT',
        lastDay : '[à¤¹à¤¿à¤œà¥‹] LT',
        lastWeek : '[à¤—à¤à¤•à¥‹] dddd[,] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "%sà¤®à¤¾",
        past : "%s à¤…à¤—à¤¾à¤¡à¥€",
        s : "à¤•à¥‡à¤¹à¥€ à¤¸à¤®à¤¯",
        m : "à¤à¤• à¤®à¤¿à¤¨à¥‡à¤Ÿ",
        mm : "%d à¤®à¤¿à¤¨à¥‡à¤Ÿ",
        h : "à¤à¤• à¤˜à¤£à¥à¤Ÿà¤¾",
        hh : "%d à¤˜à¤£à¥à¤Ÿà¤¾",
        d : "à¤à¤• à¤¦à¤¿à¤¨",
        dd : "%d à¤¦à¤¿à¤¨",
        M : "à¤à¤• à¤®à¤¹à¤¿à¤¨à¤¾",
        MM : "%d à¤®à¤¹à¤¿à¤¨à¤¾",
        y : "à¤à¤• à¤¬à¤°à¥à¤·",
        yy : "%d à¤¬à¤°à¥à¤·"
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : dutch (nl)
// author : Joris RÃ¶ling : https://github.com/jjupiter

  (function (factory) {
    factory(moment);
  }(function (moment) {
    var monthsShortWithDots = "jan._feb._mrt._apr._mei_jun._jul._aug._sep._okt._nov._dec.".split("_"),
      monthsShortWithoutDots = "jan_feb_mrt_apr_mei_jun_jul_aug_sep_okt_nov_dec".split("_");

    return moment.lang('nl', {
      months : "januari_februari_maart_april_mei_juni_juli_augustus_september_oktober_november_december".split("_"),
      monthsShort : function (m, format) {
        if (/-MMM-/.test(format)) {
          return monthsShortWithoutDots[m.month()];
        } else {
          return monthsShortWithDots[m.month()];
        }
      },
      weekdays : "zondag_maandag_dinsdag_woensdag_donderdag_vrijdag_zaterdag".split("_"),
      weekdaysShort : "zo._ma._di._wo._do._vr._za.".split("_"),
      weekdaysMin : "Zo_Ma_Di_Wo_Do_Vr_Za".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD-MM-YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd D MMMM YYYY LT"
      },
      calendar : {
        sameDay: '[vandaag om] LT',
        nextDay: '[morgen om] LT',
        nextWeek: 'dddd [om] LT',
        lastDay: '[gisteren om] LT',
        lastWeek: '[afgelopen] dddd [om] LT',
        sameElse: 'L'
      },
      relativeTime : {
        future : "over %s",
        past : "%s geleden",
        s : "een paar seconden",
        m : "Ã©Ã©n minuut",
        mm : "%d minuten",
        h : "Ã©Ã©n uur",
        hh : "%d uur",
        d : "Ã©Ã©n dag",
        dd : "%d dagen",
        M : "Ã©Ã©n maand",
        MM : "%d maanden",
        y : "Ã©Ã©n jaar",
        yy : "%d jaar"
      },
      ordinal : function (number) {
        return number + ((number === 1 || number === 8 || number >= 20) ? 'ste' : 'de');
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : norwegian nynorsk (nn)
// author : https://github.com/mechuwind

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('nn', {
      months : "januar_februar_mars_april_mai_juni_juli_august_september_oktober_november_desember".split("_"),
      monthsShort : "jan_feb_mar_apr_mai_jun_jul_aug_sep_okt_nov_des".split("_"),
      weekdays : "sundag_mÃ¥ndag_tysdag_onsdag_torsdag_fredag_laurdag".split("_"),
      weekdaysShort : "sun_mÃ¥n_tys_ons_tor_fre_lau".split("_"),
      weekdaysMin : "su_mÃ¥_ty_on_to_fr_lÃ¸".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD.MM.YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd D MMMM YYYY LT"
      },
      calendar : {
        sameDay: '[I dag klokka] LT',
        nextDay: '[I morgon klokka] LT',
        nextWeek: 'dddd [klokka] LT',
        lastDay: '[I gÃ¥r klokka] LT',
        lastWeek: '[FÃ¸regÃ¥ende] dddd [klokka] LT',
        sameElse: 'L'
      },
      relativeTime : {
        future : "om %s",
        past : "for %s siden",
        s : "noen sekund",
        m : "ett minutt",
        mm : "%d minutt",
        h : "en time",
        hh : "%d timar",
        d : "en dag",
        dd : "%d dagar",
        M : "en mÃ¥nad",
        MM : "%d mÃ¥nader",
        y : "ett Ã¥r",
        yy : "%d Ã¥r"
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : polish (pl)
// author : Rafal Hirsz : https://github.com/evoL

  (function (factory) {
    factory(moment);
  }(function (moment) {
    var monthsNominative = "styczeÅ„_luty_marzec_kwiecieÅ„_maj_czerwiec_lipiec_sierpieÅ„_wrzesieÅ„_paÅºdziernik_listopad_grudzieÅ„".split("_"),
      monthsSubjective = "stycznia_lutego_marca_kwietnia_maja_czerwca_lipca_sierpnia_wrzeÅ›nia_paÅºdziernika_listopada_grudnia".split("_");

    function plural(n) {
      return (n % 10 < 5) && (n % 10 > 1) && (~~(n / 10) !== 1);
    }

    function translate(number, withoutSuffix, key) {
      var result = number + " ";
      switch (key) {
        case 'm':
          return withoutSuffix ? 'minuta' : 'minutÄ™';
        case 'mm':
          return result + (plural(number) ? 'minuty' : 'minut');
        case 'h':
          return withoutSuffix  ? 'godzina'  : 'godzinÄ™';
        case 'hh':
          return result + (plural(number) ? 'godziny' : 'godzin');
        case 'MM':
          return result + (plural(number) ? 'miesiÄ…ce' : 'miesiÄ™cy');
        case 'yy':
          return result + (plural(number) ? 'lata' : 'lat');
      }
    }

    return moment.lang('pl', {
      months : function (momentToFormat, format) {
        if (/D MMMM/.test(format)) {
          return monthsSubjective[momentToFormat.month()];
        } else {
          return monthsNominative[momentToFormat.month()];
        }
      },
      monthsShort : "sty_lut_mar_kwi_maj_cze_lip_sie_wrz_paÅº_lis_gru".split("_"),
      weekdays : "niedziela_poniedziaÅ‚ek_wtorek_Å›roda_czwartek_piÄ…tek_sobota".split("_"),
      weekdaysShort : "nie_pon_wt_Å›r_czw_pt_sb".split("_"),
      weekdaysMin : "N_Pn_Wt_Åšr_Cz_Pt_So".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD.MM.YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd, D MMMM YYYY LT"
      },
      calendar : {
        sameDay: '[DziÅ› o] LT',
        nextDay: '[Jutro o] LT',
        nextWeek: '[W] dddd [o] LT',
        lastDay: '[Wczoraj o] LT',
        lastWeek: function () {
          switch (this.day()) {
            case 0:
              return '[W zeszÅ‚Ä… niedzielÄ™ o] LT';
            case 3:
              return '[W zeszÅ‚Ä… Å›rodÄ™ o] LT';
            case 6:
              return '[W zeszÅ‚Ä… sobotÄ™ o] LT';
            default:
              return '[W zeszÅ‚y] dddd [o] LT';
          }
        },
        sameElse: 'L'
      },
      relativeTime : {
        future : "za %s",
        past : "%s temu",
        s : "kilka sekund",
        m : translate,
        mm : translate,
        h : translate,
        hh : translate,
        d : "1 dzieÅ„",
        dd : '%d dni',
        M : "miesiÄ…c",
        MM : translate,
        y : "rok",
        yy : translate
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : brazilian portuguese (pt-br)
// author : Caio Ribeiro Pereira : https://github.com/caio-ribeiro-pereira

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('pt-br', {
      months : "Janeiro_Fevereiro_MarÃ§o_Abril_Maio_Junho_Julho_Agosto_Setembro_Outubro_Novembro_Dezembro".split("_"),
      monthsShort : "Jan_Fev_Mar_Abr_Mai_Jun_Jul_Ago_Set_Out_Nov_Dez".split("_"),
      weekdays : "Domingo_Segunda-feira_TerÃ§a-feira_Quarta-feira_Quinta-feira_Sexta-feira_SÃ¡bado".split("_"),
      weekdaysShort : "Dom_Seg_Ter_Qua_Qui_Sex_SÃ¡b".split("_"),
      weekdaysMin : "Dom_2Âª_3Âª_4Âª_5Âª_6Âª_SÃ¡b".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D [de] MMMM [de] YYYY",
        LLL : "D [de] MMMM [de] YYYY LT",
        LLLL : "dddd, D [de] MMMM [de] YYYY LT"
      },
      calendar : {
        sameDay: '[Hoje Ã s] LT',
        nextDay: '[AmanhÃ£ Ã s] LT',
        nextWeek: 'dddd [Ã s] LT',
        lastDay: '[Ontem Ã s] LT',
        lastWeek: function () {
          return (this.day() === 0 || this.day() === 6) ?
            '[Ãšltimo] dddd [Ã s] LT' : // Saturday + Sunday
            '[Ãšltima] dddd [Ã s] LT'; // Monday - Friday
        },
        sameElse: 'L'
      },
      relativeTime : {
        future : "em %s",
        past : "%s atrÃ¡s",
        s : "segundos",
        m : "um minuto",
        mm : "%d minutos",
        h : "uma hora",
        hh : "%d horas",
        d : "um dia",
        dd : "%d dias",
        M : "um mÃªs",
        MM : "%d meses",
        y : "um ano",
        yy : "%d anos"
      },
      ordinal : '%dÂº'
    });
  }));
// moment.js language configuration
// language : portuguese (pt)
// author : Jefferson : https://github.com/jalex79

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('pt', {
      months : "Janeiro_Fevereiro_MarÃ§o_Abril_Maio_Junho_Julho_Agosto_Setembro_Outubro_Novembro_Dezembro".split("_"),
      monthsShort : "Jan_Fev_Mar_Abr_Mai_Jun_Jul_Ago_Set_Out_Nov_Dez".split("_"),
      weekdays : "Domingo_Segunda-feira_TerÃ§a-feira_Quarta-feira_Quinta-feira_Sexta-feira_SÃ¡bado".split("_"),
      weekdaysShort : "Dom_Seg_Ter_Qua_Qui_Sex_SÃ¡b".split("_"),
      weekdaysMin : "Dom_2Âª_3Âª_4Âª_5Âª_6Âª_SÃ¡b".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D [de] MMMM [de] YYYY",
        LLL : "D [de] MMMM [de] YYYY LT",
        LLLL : "dddd, D [de] MMMM [de] YYYY LT"
      },
      calendar : {
        sameDay: '[Hoje Ã s] LT',
        nextDay: '[AmanhÃ£ Ã s] LT',
        nextWeek: 'dddd [Ã s] LT',
        lastDay: '[Ontem Ã s] LT',
        lastWeek: function () {
          return (this.day() === 0 || this.day() === 6) ?
            '[Ãšltimo] dddd [Ã s] LT' : // Saturday + Sunday
            '[Ãšltima] dddd [Ã s] LT'; // Monday - Friday
        },
        sameElse: 'L'
      },
      relativeTime : {
        future : "em %s",
        past : "%s atrÃ¡s",
        s : "segundos",
        m : "um minuto",
        mm : "%d minutos",
        h : "uma hora",
        hh : "%d horas",
        d : "um dia",
        dd : "%d dias",
        M : "um mÃªs",
        MM : "%d meses",
        y : "um ano",
        yy : "%d anos"
      },
      ordinal : '%dÂº',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : romanian (ro)
// author : Vlad Gurdiga : https://github.com/gurdiga
// author : Valentin Agachi : https://github.com/avaly

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('ro', {
      months : "Ianuarie_Februarie_Martie_Aprilie_Mai_Iunie_Iulie_August_Septembrie_Octombrie_Noiembrie_Decembrie".split("_"),
      monthsShort : "Ian_Feb_Mar_Apr_Mai_Iun_Iul_Aug_Sep_Oct_Noi_Dec".split("_"),
      weekdays : "DuminicÄƒ_Luni_MarÅ£i_Miercuri_Joi_Vineri_SÃ¢mbÄƒtÄƒ".split("_"),
      weekdaysShort : "Dum_Lun_Mar_Mie_Joi_Vin_SÃ¢m".split("_"),
      weekdaysMin : "Du_Lu_Ma_Mi_Jo_Vi_SÃ¢".split("_"),
      longDateFormat : {
        LT : "H:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY H:mm",
        LLLL : "dddd, D MMMM YYYY H:mm"
      },
      calendar : {
        sameDay: "[azi la] LT",
        nextDay: '[mÃ¢ine la] LT',
        nextWeek: 'dddd [la] LT',
        lastDay: '[ieri la] LT',
        lastWeek: '[fosta] dddd [la] LT',
        sameElse: 'L'
      },
      relativeTime : {
        future : "peste %s",
        past : "%s Ã®n urmÄƒ",
        s : "cÃ¢teva secunde",
        m : "un minut",
        mm : "%d minute",
        h : "o orÄƒ",
        hh : "%d ore",
        d : "o zi",
        dd : "%d zile",
        M : "o lunÄƒ",
        MM : "%d luni",
        y : "un an",
        yy : "%d ani"
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : russian (ru)
// author : Viktorminator : https://github.com/Viktorminator
// Author : Menelion ElensÃºle : https://github.com/Oire

  (function (factory) {
    factory(moment);
  }(function (moment) {
    function plural(word, num) {
      var forms = word.split('_');
      return num % 10 === 1 && num % 100 !== 11 ? forms[0] : (num % 10 >= 2 && num % 10 <= 4 && (num % 100 < 10 || num % 100 >= 20) ? forms[1] : forms[2]);
    }

    function relativeTimeWithPlural(number, withoutSuffix, key) {
      var format = {
        'mm': 'Ð¼Ð¸Ð½ÑƒÑ‚Ð°_Ð¼Ð¸Ð½ÑƒÑ‚Ñ‹_Ð¼Ð¸Ð½ÑƒÑ‚',
        'hh': 'Ñ‡Ð°Ñ_Ñ‡Ð°ÑÐ°_Ñ‡Ð°ÑÐ¾Ð²',
        'dd': 'Ð´ÐµÐ½ÑŒ_Ð´Ð½Ñ_Ð´Ð½ÐµÐ¹',
        'MM': 'Ð¼ÐµÑÑÑ†_Ð¼ÐµÑÑÑ†Ð°_Ð¼ÐµÑÑÑ†ÐµÐ²',
        'yy': 'Ð³Ð¾Ð´_Ð³Ð¾Ð´Ð°_Ð»ÐµÑ‚'
      };
      if (key === 'm') {
        return withoutSuffix ? 'Ð¼Ð¸Ð½ÑƒÑ‚Ð°' : 'Ð¼Ð¸Ð½ÑƒÑ‚Ñƒ';
      }
      else {
        return number + ' ' + plural(format[key], +number);
      }
    }

    function monthsCaseReplace(m, format) {
      var months = {
          'nominative': 'ÑÐ½Ð²Ð°Ñ€ÑŒ_Ñ„ÐµÐ²Ñ€Ð°Ð»ÑŒ_Ð¼Ð°Ñ€Ñ‚_Ð°Ð¿Ñ€ÐµÐ»ÑŒ_Ð¼Ð°Ð¹_Ð¸ÑŽÐ½ÑŒ_Ð¸ÑŽÐ»ÑŒ_Ð°Ð²Ð³ÑƒÑÑ‚_ÑÐµÐ½Ñ‚ÑÐ±Ñ€ÑŒ_Ð¾ÐºÑ‚ÑÐ±Ñ€ÑŒ_Ð½Ð¾ÑÐ±Ñ€ÑŒ_Ð´ÐµÐºÐ°Ð±Ñ€ÑŒ'.split('_'),
          'accusative': 'ÑÐ½Ð²Ð°Ñ€Ñ_Ñ„ÐµÐ²Ñ€Ð°Ð»Ñ_Ð¼Ð°Ñ€Ñ‚Ð°_Ð°Ð¿Ñ€ÐµÐ»Ñ_Ð¼Ð°Ñ_Ð¸ÑŽÐ½Ñ_Ð¸ÑŽÐ»Ñ_Ð°Ð²Ð³ÑƒÑÑ‚Ð°_ÑÐµÐ½Ñ‚ÑÐ±Ñ€Ñ_Ð¾ÐºÑ‚ÑÐ±Ñ€Ñ_Ð½Ð¾ÑÐ±Ñ€Ñ_Ð´ÐµÐºÐ°Ð±Ñ€Ñ'.split('_')
        },

        nounCase = (/D[oD]?(\[[^\[\]]*\]|\s+)+MMMM?/).test(format) ?
          'accusative' :
          'nominative';

      return months[nounCase][m.month()];
    }

    function monthsShortCaseReplace(m, format) {
      var monthsShort = {
          'nominative': 'ÑÐ½Ð²_Ñ„ÐµÐ²_Ð¼Ð°Ñ€_Ð°Ð¿Ñ€_Ð¼Ð°Ð¹_Ð¸ÑŽÐ½ÑŒ_Ð¸ÑŽÐ»ÑŒ_Ð°Ð²Ð³_ÑÐµÐ½_Ð¾ÐºÑ‚_Ð½Ð¾Ñ_Ð´ÐµÐº'.split('_'),
          'accusative': 'ÑÐ½Ð²_Ñ„ÐµÐ²_Ð¼Ð°Ñ€_Ð°Ð¿Ñ€_Ð¼Ð°Ñ_Ð¸ÑŽÐ½Ñ_Ð¸ÑŽÐ»Ñ_Ð°Ð²Ð³_ÑÐµÐ½_Ð¾ÐºÑ‚_Ð½Ð¾Ñ_Ð´ÐµÐº'.split('_')
        },

        nounCase = (/D[oD]?(\[[^\[\]]*\]|\s+)+MMMM?/).test(format) ?
          'accusative' :
          'nominative';

      return monthsShort[nounCase][m.month()];
    }

    function weekdaysCaseReplace(m, format) {
      var weekdays = {
          'nominative': 'Ð²Ð¾ÑÐºÑ€ÐµÑÐµÐ½ÑŒÐµ_Ð¿Ð¾Ð½ÐµÐ´ÐµÐ»ÑŒÐ½Ð¸Ðº_Ð²Ñ‚Ð¾Ñ€Ð½Ð¸Ðº_ÑÑ€ÐµÐ´Ð°_Ñ‡ÐµÑ‚Ð²ÐµÑ€Ð³_Ð¿ÑÑ‚Ð½Ð¸Ñ†Ð°_ÑÑƒÐ±Ð±Ð¾Ñ‚Ð°'.split('_'),
          'accusative': 'Ð²Ð¾ÑÐºÑ€ÐµÑÐµÐ½ÑŒÐµ_Ð¿Ð¾Ð½ÐµÐ´ÐµÐ»ÑŒÐ½Ð¸Ðº_Ð²Ñ‚Ð¾Ñ€Ð½Ð¸Ðº_ÑÑ€ÐµÐ´Ñƒ_Ñ‡ÐµÑ‚Ð²ÐµÑ€Ð³_Ð¿ÑÑ‚Ð½Ð¸Ñ†Ñƒ_ÑÑƒÐ±Ð±Ð¾Ñ‚Ñƒ'.split('_')
        },

        nounCase = (/\[ ?[Ð’Ð²] ?(?:Ð¿Ñ€Ð¾ÑˆÐ»ÑƒÑŽ|ÑÐ»ÐµÐ´ÑƒÑŽÑ‰ÑƒÑŽ)? ?\] ?dddd/).test(format) ?
          'accusative' :
          'nominative';

      return weekdays[nounCase][m.day()];
    }

    return moment.lang('ru', {
      months : monthsCaseReplace,
      monthsShort : monthsShortCaseReplace,
      weekdays : weekdaysCaseReplace,
      weekdaysShort : "Ð²Ñ_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),
      weekdaysMin : "Ð²Ñ_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),
      monthsParse : [/^ÑÐ½Ð²/i, /^Ñ„ÐµÐ²/i, /^Ð¼Ð°Ñ€/i, /^Ð°Ð¿Ñ€/i, /^Ð¼Ð°[Ð¹|Ñ]/i, /^Ð¸ÑŽÐ½/i, /^Ð¸ÑŽÐ»/i, /^Ð°Ð²Ð³/i, /^ÑÐµÐ½/i, /^Ð¾ÐºÑ‚/i, /^Ð½Ð¾Ñ/i, /^Ð´ÐµÐº/i],
      longDateFormat : {
        LT : "HH:mm",
        L : "DD.MM.YYYY",
        LL : "D MMMM YYYY Ð³.",
        LLL : "D MMMM YYYY Ð³., LT",
        LLLL : "dddd, D MMMM YYYY Ð³., LT"
      },
      calendar : {
        sameDay: '[Ð¡ÐµÐ³Ð¾Ð´Ð½Ñ Ð²] LT',
        nextDay: '[Ð—Ð°Ð²Ñ‚Ñ€Ð° Ð²] LT',
        lastDay: '[Ð’Ñ‡ÐµÑ€Ð° Ð²] LT',
        nextWeek: function () {
          return this.day() === 2 ? '[Ð’Ð¾] dddd [Ð²] LT' : '[Ð’] dddd [Ð²] LT';
        },
        lastWeek: function () {
          switch (this.day()) {
            case 0:
              return '[Ð’ Ð¿Ñ€Ð¾ÑˆÐ»Ð¾Ðµ] dddd [Ð²] LT';
            case 1:
            case 2:
            case 4:
              return '[Ð’ Ð¿Ñ€Ð¾ÑˆÐ»Ñ‹Ð¹] dddd [Ð²] LT';
            case 3:
            case 5:
            case 6:
              return '[Ð’ Ð¿Ñ€Ð¾ÑˆÐ»ÑƒÑŽ] dddd [Ð²] LT';
          }
        },
        sameElse: 'L'
      },
      relativeTime : {
        future : "Ñ‡ÐµÑ€ÐµÐ· %s",
        past : "%s Ð½Ð°Ð·Ð°Ð´",
        s : "Ð½ÐµÑÐºÐ¾Ð»ÑŒÐºÐ¾ ÑÐµÐºÑƒÐ½Ð´",
        m : relativeTimeWithPlural,
        mm : relativeTimeWithPlural,
        h : "Ñ‡Ð°Ñ",
        hh : relativeTimeWithPlural,
        d : "Ð´ÐµÐ½ÑŒ",
        dd : relativeTimeWithPlural,
        M : "Ð¼ÐµÑÑÑ†",
        MM : relativeTimeWithPlural,
        y : "Ð³Ð¾Ð´",
        yy : relativeTimeWithPlural
      },

      // M. E.: those two are virtually unused but a user might want to implement them for his/her website for some reason

      meridiem : function (hour, minute, isLower) {
        if (hour < 4) {
          return "Ð½Ð¾Ñ‡Ð¸";
        } else if (hour < 12) {
          return "ÑƒÑ‚Ñ€Ð°";
        } else if (hour < 17) {
          return "Ð´Ð½Ñ";
        } else {
          return "Ð²ÐµÑ‡ÐµÑ€Ð°";
        }
      },

      ordinal: function (number, period) {
        switch (period) {
          case 'M':
          case 'd':
          case 'DDD':
            return number + '-Ð¹';
          case 'D':
            return number + '-Ð³Ð¾';
          case 'w':
          case 'W':
            return number + '-Ñ';
          default:
            return number;
        }
      },

      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : slovak (sk)
// author : Martin Minka : https://github.com/k2s
// based on work of petrbela : https://github.com/petrbela

  (function (factory) {
    factory(moment);
  }(function (moment) {
    var months = "januÃ¡r_februÃ¡r_marec_aprÃ­l_mÃ¡j_jÃºn_jÃºl_august_september_oktÃ³ber_november_december".split("_"),
      monthsShort = "jan_feb_mar_apr_mÃ¡j_jÃºn_jÃºl_aug_sep_okt_nov_dec".split("_");

    function plural(n) {
      return (n > 1) && (n < 5);
    }

    function translate(number, withoutSuffix, key, isFuture) {
      var result = number + " ";
      switch (key) {
        case 's':  // a few seconds / in a few seconds / a few seconds ago
          return (withoutSuffix || isFuture) ? 'pÃ¡r sekÃºnd' : 'pÃ¡r sekundami';
        case 'm':  // a minute / in a minute / a minute ago
          return withoutSuffix ? 'minÃºta' : (isFuture ? 'minÃºtu' : 'minÃºtou');
        case 'mm': // 9 minutes / in 9 minutes / 9 minutes ago
          if (withoutSuffix || isFuture) {
            return result + (plural(number) ? 'minÃºty' : 'minÃºt');
          } else {
            return result + 'minÃºtami';
          }
          break;
        case 'h':  // an hour / in an hour / an hour ago
          return withoutSuffix ? 'hodina' : (isFuture ? 'hodinu' : 'hodinou');
        case 'hh': // 9 hours / in 9 hours / 9 hours ago
          if (withoutSuffix || isFuture) {
            return result + (plural(number) ? 'hodiny' : 'hodÃ­n');
          } else {
            return result + 'hodinami';
          }
          break;
        case 'd':  // a day / in a day / a day ago
          return (withoutSuffix || isFuture) ? 'deÅˆ' : 'dÅˆom';
        case 'dd': // 9 days / in 9 days / 9 days ago
          if (withoutSuffix || isFuture) {
            return result + (plural(number) ? 'dni' : 'dnÃ­');
          } else {
            return result + 'dÅˆami';
          }
          break;
        case 'M':  // a month / in a month / a month ago
          return (withoutSuffix || isFuture) ? 'mesiac' : 'mesiacom';
        case 'MM': // 9 months / in 9 months / 9 months ago
          if (withoutSuffix || isFuture) {
            return result + (plural(number) ? 'mesiace' : 'mesiacov');
          } else {
            return result + 'mesiacmi';
          }
          break;
        case 'y':  // a year / in a year / a year ago
          return (withoutSuffix || isFuture) ? 'rok' : 'rokom';
        case 'yy': // 9 years / in 9 years / 9 years ago
          if (withoutSuffix || isFuture) {
            return result + (plural(number) ? 'roky' : 'rokov');
          } else {
            return result + 'rokmi';
          }
          break;
      }
    }

    return moment.lang('sk', {
      months : months,
      monthsShort : monthsShort,
      monthsParse : (function (months, monthsShort) {
        var i, _monthsParse = [];
        for (i = 0; i < 12; i++) {
          // use custom parser to solve problem with July (Äervenec)
          _monthsParse[i] = new RegExp('^' + months[i] + '$|^' + monthsShort[i] + '$', 'i');
        }
        return _monthsParse;
      }(months, monthsShort)),
      weekdays : "nedeÄ¾a_pondelok_utorok_streda_Å¡tvrtok_piatok_sobota".split("_"),
      weekdaysShort : "ne_po_ut_st_Å¡t_pi_so".split("_"),
      weekdaysMin : "ne_po_ut_st_Å¡t_pi_so".split("_"),
      longDateFormat : {
        LT: "H:mm",
        L : "DD.MM.YYYY",
        LL : "D. MMMM YYYY",
        LLL : "D. MMMM YYYY LT",
        LLLL : "dddd D. MMMM YYYY LT"
      },
      calendar : {
        sameDay: "[dnes o] LT",
        nextDay: '[zajtra o] LT',
        nextWeek: function () {
          switch (this.day()) {
            case 0:
              return '[v nedeÄ¾u o] LT';
            case 1:
            case 2:
              return '[v] dddd [o] LT';
            case 3:
              return '[v stredu o] LT';
            case 4:
              return '[vo Å¡tvrtok o] LT';
            case 5:
              return '[v piatok o] LT';
            case 6:
              return '[v sobotu o] LT';
          }
        },
        lastDay: '[vÄera o] LT',
        lastWeek: function () {
          switch (this.day()) {
            case 0:
              return '[minulÃº nedeÄ¾u o] LT';
            case 1:
            case 2:
              return '[minulÃ½] dddd [o] LT';
            case 3:
              return '[minulÃº stredu o] LT';
            case 4:
            case 5:
              return '[minulÃ½] dddd [o] LT';
            case 6:
              return '[minulÃº sobotu o] LT';
          }
        },
        sameElse: "L"
      },
      relativeTime : {
        future : "za %s",
        past : "pred %s",
        s : translate,
        m : translate,
        mm : translate,
        h : translate,
        hh : translate,
        d : translate,
        dd : translate,
        M : translate,
        MM : translate,
        y : translate,
        yy : translate
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : slovenian (sl)
// author : Robert SedovÅ¡ek : https://github.com/sedovsek

  (function (factory) {
    factory(moment);
  }(function (moment) {
    function translate(number, withoutSuffix, key) {
      var result = number + " ";
      switch (key) {
        case 'm':
          return withoutSuffix ? 'ena minuta' : 'eno minuto';
        case 'mm':
          if (number === 1) {
            result += 'minuta';
          } else if (number === 2) {
            result += 'minuti';
          } else if (number === 3 || number === 4) {
            result += 'minute';
          } else {
            result += 'minut';
          }
          return result;
        case 'h':
          return withoutSuffix ? 'ena ura' : 'eno uro';
        case 'hh':
          if (number === 1) {
            result += 'ura';
          } else if (number === 2) {
            result += 'uri';
          } else if (number === 3 || number === 4) {
            result += 'ure';
          } else {
            result += 'ur';
          }
          return result;
        case 'dd':
          if (number === 1) {
            result += 'dan';
          } else {
            result += 'dni';
          }
          return result;
        case 'MM':
          if (number === 1) {
            result += 'mesec';
          } else if (number === 2) {
            result += 'meseca';
          } else if (number === 3 || number === 4) {
            result += 'mesece';
          } else {
            result += 'mesecev';
          }
          return result;
        case 'yy':
          if (number === 1) {
            result += 'leto';
          } else if (number === 2) {
            result += 'leti';
          } else if (number === 3 || number === 4) {
            result += 'leta';
          } else {
            result += 'let';
          }
          return result;
      }
    }

    return moment.lang('sl', {
      months : "januar_februar_marec_april_maj_junij_julij_avgust_september_oktober_november_december".split("_"),
      monthsShort : "jan._feb._mar._apr._maj._jun._jul._avg._sep._okt._nov._dec.".split("_"),
      weekdays : "nedelja_ponedeljek_torek_sreda_Äetrtek_petek_sobota".split("_"),
      weekdaysShort : "ned._pon._tor._sre._Äet._pet._sob.".split("_"),
      weekdaysMin : "ne_po_to_sr_Äe_pe_so".split("_"),
      longDateFormat : {
        LT : "H:mm",
        L : "DD. MM. YYYY",
        LL : "D. MMMM YYYY",
        LLL : "D. MMMM YYYY LT",
        LLLL : "dddd, D. MMMM YYYY LT"
      },
      calendar : {
        sameDay  : '[danes ob] LT',
        nextDay  : '[jutri ob] LT',

        nextWeek : function () {
          switch (this.day()) {
            case 0:
              return '[v] [nedeljo] [ob] LT';
            case 3:
              return '[v] [sredo] [ob] LT';
            case 6:
              return '[v] [soboto] [ob] LT';
            case 1:
            case 2:
            case 4:
            case 5:
              return '[v] dddd [ob] LT';
          }
        },
        lastDay  : '[vÄeraj ob] LT',
        lastWeek : function () {
          switch (this.day()) {
            case 0:
            case 3:
            case 6:
              return '[prejÅ¡nja] dddd [ob] LT';
            case 1:
            case 2:
            case 4:
            case 5:
              return '[prejÅ¡nji] dddd [ob] LT';
          }
        },
        sameElse : 'L'
      },
      relativeTime : {
        future : "Äez %s",
        past   : "%s nazaj",
        s      : "nekaj sekund",
        m      : translate,
        mm     : translate,
        h      : translate,
        hh     : translate,
        d      : "en dan",
        dd     : translate,
        M      : "en mesec",
        MM     : translate,
        y      : "eno leto",
        yy     : translate
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : Albanian (sq)
// author : FlakÃ«rim Ismani : https://github.com/flakerimi
// author: Menelion ElensÃºle: https://github.com/Oire (tests)

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('sq', {
      months : "Janar_Shkurt_Mars_Prill_Maj_Qershor_Korrik_Gusht_Shtator_Tetor_NÃ«ntor_Dhjetor".split("_"),
      monthsShort : "Jan_Shk_Mar_Pri_Maj_Qer_Kor_Gus_Sht_Tet_NÃ«n_Dhj".split("_"),
      weekdays : "E Diel_E HÃ«nÃ«_E Marte_E MÃ«rkure_E Enjte_E Premte_E ShtunÃ«".split("_"),
      weekdaysShort : "Die_HÃ«n_Mar_MÃ«r_Enj_Pre_Sht".split("_"),
      weekdaysMin : "D_H_Ma_MÃ«_E_P_Sh".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd, D MMMM YYYY LT"
      },
      calendar : {
        sameDay : '[Sot nÃ«] LT',
        nextDay : '[Neser nÃ«] LT',
        nextWeek : 'dddd [nÃ«] LT',
        lastDay : '[Dje nÃ«] LT',
        lastWeek : 'dddd [e kaluar nÃ«] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "nÃ« %s",
        past : "%s me parÃ«",
        s : "disa seconda",
        m : "njÃ« minut",
        mm : "%d minutea",
        h : "njÃ« orÃ«",
        hh : "%d orÃ«",
        d : "njÃ« ditÃ«",
        dd : "%d ditÃ«",
        M : "njÃ« muaj",
        MM : "%d muaj",
        y : "njÃ« vit",
        yy : "%d vite"
      },
      ordinal : '%d.',
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : swedish (sv)
// author : Jens Alm : https://github.com/ulmus

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('sv', {
      months : "januari_februari_mars_april_maj_juni_juli_augusti_september_oktober_november_december".split("_"),
      monthsShort : "jan_feb_mar_apr_maj_jun_jul_aug_sep_okt_nov_dec".split("_"),
      weekdays : "sÃ¶ndag_mÃ¥ndag_tisdag_onsdag_torsdag_fredag_lÃ¶rdag".split("_"),
      weekdaysShort : "sÃ¶n_mÃ¥n_tis_ons_tor_fre_lÃ¶r".split("_"),
      weekdaysMin : "sÃ¶_mÃ¥_ti_on_to_fr_lÃ¶".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "YYYY-MM-DD",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd D MMMM YYYY LT"
      },
      calendar : {
        sameDay: '[Idag] LT',
        nextDay: '[Imorgon] LT',
        lastDay: '[IgÃ¥r] LT',
        nextWeek: 'dddd LT',
        lastWeek: '[FÃ¶rra] dddd[en] LT',
        sameElse: 'L'
      },
      relativeTime : {
        future : "om %s",
        past : "fÃ¶r %s sedan",
        s : "nÃ¥gra sekunder",
        m : "en minut",
        mm : "%d minuter",
        h : "en timme",
        hh : "%d timmar",
        d : "en dag",
        dd : "%d dagar",
        M : "en mÃ¥nad",
        MM : "%d mÃ¥nader",
        y : "ett Ã¥r",
        yy : "%d Ã¥r"
      },
      ordinal : function (number) {
        var b = number % 10,
          output = (~~ (number % 100 / 10) === 1) ? 'e' :
            (b === 1) ? 'a' :
              (b === 2) ? 'a' :
                (b === 3) ? 'e' : 'e';
        return number + output;
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : thai (th)
// author : Kridsada Thanabulpong : https://github.com/sirn

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('th', {
      months : "à¸¡à¸à¸£à¸²à¸„à¸¡_à¸à¸¸à¸¡à¸ à¸²à¸žà¸±à¸™à¸˜à¹Œ_à¸¡à¸µà¸™à¸²à¸„à¸¡_à¹€à¸¡à¸©à¸²à¸¢à¸™_à¸žà¸¤à¸©à¸ à¸²à¸„à¸¡_à¸¡à¸´à¸–à¸¸à¸™à¸²à¸¢à¸™_à¸à¸£à¸à¸Žà¸²à¸„à¸¡_à¸ªà¸´à¸‡à¸«à¸²à¸„à¸¡_à¸à¸±à¸™à¸¢à¸²à¸¢à¸™_à¸•à¸¸à¸¥à¸²à¸„à¸¡_à¸žà¸¤à¸¨à¸ˆà¸´à¸à¸²à¸¢à¸™_à¸˜à¸±à¸™à¸§à¸²à¸„à¸¡".split("_"),
      monthsShort : "à¸¡à¸à¸£à¸²_à¸à¸¸à¸¡à¸ à¸²_à¸¡à¸µà¸™à¸²_à¹€à¸¡à¸©à¸²_à¸žà¸¤à¸©à¸ à¸²_à¸¡à¸´à¸–à¸¸à¸™à¸²_à¸à¸£à¸à¸Žà¸²_à¸ªà¸´à¸‡à¸«à¸²_à¸à¸±à¸™à¸¢à¸²_à¸•à¸¸à¸¥à¸²_à¸žà¸¤à¸¨à¸ˆà¸´à¸à¸²_à¸˜à¸±à¸™à¸§à¸²".split("_"),
      weekdays : "à¸­à¸²à¸—à¸´à¸•à¸¢à¹Œ_à¸ˆà¸±à¸™à¸—à¸£à¹Œ_à¸­à¸±à¸‡à¸„à¸²à¸£_à¸žà¸¸à¸˜_à¸žà¸¤à¸«à¸±à¸ªà¸šà¸”à¸µ_à¸¨à¸¸à¸à¸£à¹Œ_à¹€à¸ªà¸²à¸£à¹Œ".split("_"),
      weekdaysShort : "à¸­à¸²à¸—à¸´à¸•à¸¢à¹Œ_à¸ˆà¸±à¸™à¸—à¸£à¹Œ_à¸­à¸±à¸‡à¸„à¸²à¸£_à¸žà¸¸à¸˜_à¸žà¸¤à¸«à¸±à¸ª_à¸¨à¸¸à¸à¸£à¹Œ_à¹€à¸ªà¸²à¸£à¹Œ".split("_"), // yes, three characters difference
      weekdaysMin : "à¸­à¸²._à¸ˆ._à¸­._à¸ž._à¸žà¸¤._à¸¨._à¸ª.".split("_"),
      longDateFormat : {
        LT : "H à¸™à¸²à¸¬à¸´à¸à¸² m à¸™à¸²à¸—à¸µ",
        L : "YYYY/MM/DD",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY à¹€à¸§à¸¥à¸² LT",
        LLLL : "à¸§à¸±à¸™ddddà¸—à¸µà¹ˆ D MMMM YYYY à¹€à¸§à¸¥à¸² LT"
      },
      meridiem : function (hour, minute, isLower) {
        if (hour < 12) {
          return "à¸à¹ˆà¸­à¸™à¹€à¸—à¸µà¹ˆà¸¢à¸‡";
        } else {
          return "à¸«à¸¥à¸±à¸‡à¹€à¸—à¸µà¹ˆà¸¢à¸‡";
        }
      },
      calendar : {
        sameDay : '[à¸§à¸±à¸™à¸™à¸µà¹‰ à¹€à¸§à¸¥à¸²] LT',
        nextDay : '[à¸žà¸£à¸¸à¹ˆà¸‡à¸™à¸µà¹‰ à¹€à¸§à¸¥à¸²] LT',
        nextWeek : 'dddd[à¸«à¸™à¹‰à¸² à¹€à¸§à¸¥à¸²] LT',
        lastDay : '[à¹€à¸¡à¸·à¹ˆà¸­à¸§à¸²à¸™à¸™à¸µà¹‰ à¹€à¸§à¸¥à¸²] LT',
        lastWeek : '[à¸§à¸±à¸™]dddd[à¸—à¸µà¹ˆà¹à¸¥à¹‰à¸§ à¹€à¸§à¸¥à¸²] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "à¸­à¸µà¸ %s",
        past : "%sà¸—à¸µà¹ˆà¹à¸¥à¹‰à¸§",
        s : "à¹„à¸¡à¹ˆà¸à¸µà¹ˆà¸§à¸´à¸™à¸²à¸—à¸µ",
        m : "1 à¸™à¸²à¸—à¸µ",
        mm : "%d à¸™à¸²à¸—à¸µ",
        h : "1 à¸Šà¸±à¹ˆà¸§à¹‚à¸¡à¸‡",
        hh : "%d à¸Šà¸±à¹ˆà¸§à¹‚à¸¡à¸‡",
        d : "1 à¸§à¸±à¸™",
        dd : "%d à¸§à¸±à¸™",
        M : "1 à¹€à¸”à¸·à¸­à¸™",
        MM : "%d à¹€à¸”à¸·à¸­à¸™",
        y : "1 à¸›à¸µ",
        yy : "%d à¸›à¸µ"
      }
    });
  }));
// moment.js language configuration
// language : Tagalog/Filipino (tl-ph)
// author : Dan Hagman

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('tl-ph', {
      months : "Enero_Pebrero_Marso_Abril_Mayo_Hunyo_Hulyo_Agosto_Setyembre_Oktubre_Nobyembre_Disyembre".split("_"),
      monthsShort : "Ene_Peb_Mar_Abr_May_Hun_Hul_Ago_Set_Okt_Nob_Dis".split("_"),
      weekdays : "Linggo_Lunes_Martes_Miyerkules_Huwebes_Biyernes_Sabado".split("_"),
      weekdaysShort : "Lin_Lun_Mar_Miy_Huw_Biy_Sab".split("_"),
      weekdaysMin : "Li_Lu_Ma_Mi_Hu_Bi_Sab".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "MM/D/YYYY",
        LL : "MMMM D, YYYY",
        LLL : "MMMM D, YYYY LT",
        LLLL : "dddd, MMMM DD, YYYY LT"
      },
      calendar : {
        sameDay: "[Ngayon sa] LT",
        nextDay: '[Bukas sa] LT',
        nextWeek: 'dddd [sa] LT',
        lastDay: '[Kahapon sa] LT',
        lastWeek: 'dddd [huling linggo] LT',
        sameElse: 'L'
      },
      relativeTime : {
        future : "sa loob ng %s",
        past : "%s ang nakalipas",
        s : "ilang segundo",
        m : "isang minuto",
        mm : "%d minuto",
        h : "isang oras",
        hh : "%d oras",
        d : "isang araw",
        dd : "%d araw",
        M : "isang buwan",
        MM : "%d buwan",
        y : "isang taon",
        yy : "%d taon"
      },
      ordinal : function (number) {
        return number;
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : turkish (tr)
// authors : Erhan Gundogan : https://github.com/erhangundogan,
//           Burak YiÄŸit Kaya: https://github.com/BYK

  (function (factory) {
    factory(moment);
  }(function (moment) {

    var suffixes = {
      1: "'inci",
      5: "'inci",
      8: "'inci",
      70: "'inci",
      80: "'inci",

      2: "'nci",
      7: "'nci",
      20: "'nci",
      50: "'nci",

      3: "'Ã¼ncÃ¼",
      4: "'Ã¼ncÃ¼",
      100: "'Ã¼ncÃ¼",

      6: "'ncÄ±",

      9: "'uncu",
      10: "'uncu",
      30: "'uncu",

      60: "'Ä±ncÄ±",
      90: "'Ä±ncÄ±"
    };

    return moment.lang('tr', {
      months : "Ocak_Åžubat_Mart_Nisan_MayÄ±s_Haziran_Temmuz_AÄŸustos_EylÃ¼l_Ekim_KasÄ±m_AralÄ±k".split("_"),
      monthsShort : "Oca_Åžub_Mar_Nis_May_Haz_Tem_AÄŸu_Eyl_Eki_Kas_Ara".split("_"),
      weekdays : "Pazar_Pazartesi_SalÄ±_Ã‡arÅŸamba_PerÅŸembe_Cuma_Cumartesi".split("_"),
      weekdaysShort : "Paz_Pts_Sal_Ã‡ar_Per_Cum_Cts".split("_"),
      weekdaysMin : "Pz_Pt_Sa_Ã‡a_Pe_Cu_Ct".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD.MM.YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd, D MMMM YYYY LT"
      },
      calendar : {
        sameDay : '[bugÃ¼n saat] LT',
        nextDay : '[yarÄ±n saat] LT',
        nextWeek : '[haftaya] dddd [saat] LT',
        lastDay : '[dÃ¼n] LT',
        lastWeek : '[geÃ§en hafta] dddd [saat] LT',
        sameElse : 'L'
      },
      relativeTime : {
        future : "%s sonra",
        past : "%s Ã¶nce",
        s : "birkaÃ§ saniye",
        m : "bir dakika",
        mm : "%d dakika",
        h : "bir saat",
        hh : "%d saat",
        d : "bir gÃ¼n",
        dd : "%d gÃ¼n",
        M : "bir ay",
        MM : "%d ay",
        y : "bir yÄ±l",
        yy : "%d yÄ±l"
      },
      ordinal : function (number) {
        if (number === 0) {  // special case for zero
          return number + "'Ä±ncÄ±";
        }
        var a = number % 10,
          b = number % 100 - a,
          c = number >= 100 ? 100 : null;

        return number + (suffixes[a] || suffixes[b] || suffixes[c]);
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : Morocco Central Atlas TamaziÉ£t in Latin (tzm-la)
// author : Abdel Said : https://github.com/abdelsaid

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('tzm-la', {
      months : "innayr_brË¤ayrË¤_marË¤sË¤_ibrir_mayyw_ywnyw_ywlywz_É£wÅ¡t_Å¡wtanbir_ktË¤wbrË¤_nwwanbir_dwjnbir".split("_"),
      monthsShort : "innayr_brË¤ayrË¤_marË¤sË¤_ibrir_mayyw_ywnyw_ywlywz_É£wÅ¡t_Å¡wtanbir_ktË¤wbrË¤_nwwanbir_dwjnbir".split("_"),
      weekdays : "asamas_aynas_asinas_akras_akwas_asimwas_asiá¸yas".split("_"),
      weekdaysShort : "asamas_aynas_asinas_akras_akwas_asimwas_asiá¸yas".split("_"),
      weekdaysMin : "asamas_aynas_asinas_akras_akwas_asimwas_asiá¸yas".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd D MMMM YYYY LT"
      },
      calendar : {
        sameDay: "[asdkh g] LT",
        nextDay: '[aska g] LT',
        nextWeek: 'dddd [g] LT',
        lastDay: '[assant g] LT',
        lastWeek: 'dddd [g] LT',
        sameElse: 'L'
      },
      relativeTime : {
        future : "dadkh s yan %s",
        past : "yan %s",
        s : "imik",
        m : "minuá¸",
        mm : "%d minuá¸",
        h : "saÉ›a",
        hh : "%d tassaÉ›in",
        d : "ass",
        dd : "%d ossan",
        M : "ayowr",
        MM : "%d iyyirn",
        y : "asgas",
        yy : "%d isgasn"
      },
      week : {
        dow : 6, // Saturday is the first day of the week.
        doy : 12  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : Morocco Central Atlas TamaziÉ£t (tzm)
// author : Abdel Said : https://github.com/abdelsaid

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('tzm', {
      months : "âµ‰âµâµâ´°âµ¢âµ”_â´±âµ•â´°âµ¢âµ•_âµŽâ´°âµ•âµš_âµ‰â´±âµ”âµ‰âµ”_âµŽâ´°âµ¢âµ¢âµ“_âµ¢âµ“âµâµ¢âµ“_âµ¢âµ“âµâµ¢âµ“âµ£_âµ–âµ“âµ›âµœ_âµ›âµ“âµœâ´°âµâ´±âµ‰âµ”_â´½âµŸâµ“â´±âµ•_âµâµ“âµ¡â´°âµâ´±âµ‰âµ”_â´·âµ“âµŠâµâ´±âµ‰âµ”".split("_"),
      monthsShort : "âµ‰âµâµâ´°âµ¢âµ”_â´±âµ•â´°âµ¢âµ•_âµŽâ´°âµ•âµš_âµ‰â´±âµ”âµ‰âµ”_âµŽâ´°âµ¢âµ¢âµ“_âµ¢âµ“âµâµ¢âµ“_âµ¢âµ“âµâµ¢âµ“âµ£_âµ–âµ“âµ›âµœ_âµ›âµ“âµœâ´°âµâ´±âµ‰âµ”_â´½âµŸâµ“â´±âµ•_âµâµ“âµ¡â´°âµâ´±âµ‰âµ”_â´·âµ“âµŠâµâ´±âµ‰âµ”".split("_"),
      weekdays : "â´°âµ™â´°âµŽâ´°âµ™_â´°âµ¢âµâ´°âµ™_â´°âµ™âµ‰âµâ´°âµ™_â´°â´½âµ”â´°âµ™_â´°â´½âµ¡â´°âµ™_â´°âµ™âµ‰âµŽâµ¡â´°âµ™_â´°âµ™âµ‰â´¹âµ¢â´°âµ™".split("_"),
      weekdaysShort : "â´°âµ™â´°âµŽâ´°âµ™_â´°âµ¢âµâ´°âµ™_â´°âµ™âµ‰âµâ´°âµ™_â´°â´½âµ”â´°âµ™_â´°â´½âµ¡â´°âµ™_â´°âµ™âµ‰âµŽâµ¡â´°âµ™_â´°âµ™âµ‰â´¹âµ¢â´°âµ™".split("_"),
      weekdaysMin : "â´°âµ™â´°âµŽâ´°âµ™_â´°âµ¢âµâ´°âµ™_â´°âµ™âµ‰âµâ´°âµ™_â´°â´½âµ”â´°âµ™_â´°â´½âµ¡â´°âµ™_â´°âµ™âµ‰âµŽâµ¡â´°âµ™_â´°âµ™âµ‰â´¹âµ¢â´°âµ™".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "dddd D MMMM YYYY LT"
      },
      calendar : {
        sameDay: "[â´°âµ™â´·âµ… â´´] LT",
        nextDay: '[â´°âµ™â´½â´° â´´] LT',
        nextWeek: 'dddd [â´´] LT',
        lastDay: '[â´°âµšâ´°âµâµœ â´´] LT',
        lastWeek: 'dddd [â´´] LT',
        sameElse: 'L'
      },
      relativeTime : {
        future : "â´·â´°â´·âµ… âµ™ âµ¢â´°âµ %s",
        past : "âµ¢â´°âµ %s",
        s : "âµ‰âµŽâµ‰â´½",
        m : "âµŽâµ‰âµâµ“â´º",
        mm : "%d âµŽâµ‰âµâµ“â´º",
        h : "âµ™â´°âµ„â´°",
        hh : "%d âµœâ´°âµ™âµ™â´°âµ„âµ‰âµ",
        d : "â´°âµ™âµ™",
        dd : "%d oâµ™âµ™â´°âµ",
        M : "â´°âµ¢oâµ“âµ”",
        MM : "%d âµ‰âµ¢âµ¢âµ‰âµ”âµ",
        y : "â´°âµ™â´³â´°âµ™",
        yy : "%d âµ‰âµ™â´³â´°âµ™âµ"
      },
      week : {
        dow : 6, // Saturday is the first day of the week.
        doy : 12  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : ukrainian (uk)
// author : zemlanin : https://github.com/zemlanin
// Author : Menelion ElensÃºle : https://github.com/Oire

  (function (factory) {
    factory(moment);
  }(function (moment) {
    function plural(word, num) {
      var forms = word.split('_');
      return num % 10 === 1 && num % 100 !== 11 ? forms[0] : (num % 10 >= 2 && num % 10 <= 4 && (num % 100 < 10 || num % 100 >= 20) ? forms[1] : forms[2]);
    }

    function relativeTimeWithPlural(number, withoutSuffix, key) {
      var format = {
        'mm': 'Ñ…Ð²Ð¸Ð»Ð¸Ð½Ð°_Ñ…Ð²Ð¸Ð»Ð¸Ð½Ð¸_Ñ…Ð²Ð¸Ð»Ð¸Ð½',
        'hh': 'Ð³Ð¾Ð´Ð¸Ð½Ð°_Ð³Ð¾Ð´Ð¸Ð½Ð¸_Ð³Ð¾Ð´Ð¸Ð½',
        'dd': 'Ð´ÐµÐ½ÑŒ_Ð´Ð½Ñ–_Ð´Ð½Ñ–Ð²',
        'MM': 'Ð¼Ñ–ÑÑÑ†ÑŒ_Ð¼Ñ–ÑÑÑ†Ñ–_Ð¼Ñ–ÑÑÑ†Ñ–Ð²',
        'yy': 'Ñ€Ñ–Ðº_Ñ€Ð¾ÐºÐ¸_Ñ€Ð¾ÐºÑ–Ð²'
      };
      if (key === 'm') {
        return withoutSuffix ? 'Ñ…Ð²Ð¸Ð»Ð¸Ð½Ð°' : 'Ñ…Ð²Ð¸Ð»Ð¸Ð½Ñƒ';
      }
      else if (key === 'h') {
        return withoutSuffix ? 'Ð³Ð¾Ð´Ð¸Ð½Ð°' : 'Ð³Ð¾Ð´Ð¸Ð½Ñƒ';
      }
      else {
        return number + ' ' + plural(format[key], +number);
      }
    }

    function monthsCaseReplace(m, format) {
      var months = {
          'nominative': 'ÑÑ–Ñ‡ÐµÐ½ÑŒ_Ð»ÑŽÑ‚Ð¸Ð¹_Ð±ÐµÑ€ÐµÐ·ÐµÐ½ÑŒ_ÐºÐ²Ñ–Ñ‚ÐµÐ½ÑŒ_Ñ‚Ñ€Ð°Ð²ÐµÐ½ÑŒ_Ñ‡ÐµÑ€Ð²ÐµÐ½ÑŒ_Ð»Ð¸Ð¿ÐµÐ½ÑŒ_ÑÐµÑ€Ð¿ÐµÐ½ÑŒ_Ð²ÐµÑ€ÐµÑÐµÐ½ÑŒ_Ð¶Ð¾Ð²Ñ‚ÐµÐ½ÑŒ_Ð»Ð¸ÑÑ‚Ð¾Ð¿Ð°Ð´_Ð³Ñ€ÑƒÐ´ÐµÐ½ÑŒ'.split('_'),
          'accusative': 'ÑÑ–Ñ‡Ð½Ñ_Ð»ÑŽÑ‚Ð¾Ð³Ð¾_Ð±ÐµÑ€ÐµÐ·Ð½Ñ_ÐºÐ²Ñ–Ñ‚Ð½Ñ_Ñ‚Ñ€Ð°Ð²Ð½Ñ_Ñ‡ÐµÑ€Ð²Ð½Ñ_Ð»Ð¸Ð¿Ð½Ñ_ÑÐµÑ€Ð¿Ð½Ñ_Ð²ÐµÑ€ÐµÑÐ½Ñ_Ð¶Ð¾Ð²Ñ‚Ð½Ñ_Ð»Ð¸ÑÑ‚Ð¾Ð¿Ð°Ð´Ð°_Ð³Ñ€ÑƒÐ´Ð½Ñ'.split('_')
        },

        nounCase = (/D[oD]? *MMMM?/).test(format) ?
          'accusative' :
          'nominative';

      return months[nounCase][m.month()];
    }

    function weekdaysCaseReplace(m, format) {
      var weekdays = {
          'nominative': 'Ð½ÐµÐ´Ñ–Ð»Ñ_Ð¿Ð¾Ð½ÐµÐ´Ñ–Ð»Ð¾Ðº_Ð²Ñ–Ð²Ñ‚Ð¾Ñ€Ð¾Ðº_ÑÐµÑ€ÐµÐ´Ð°_Ñ‡ÐµÑ‚Ð²ÐµÑ€_Ð¿â€™ÑÑ‚Ð½Ð¸Ñ†Ñ_ÑÑƒÐ±Ð¾Ñ‚Ð°'.split('_'),
          'accusative': 'Ð½ÐµÐ´Ñ–Ð»ÑŽ_Ð¿Ð¾Ð½ÐµÐ´Ñ–Ð»Ð¾Ðº_Ð²Ñ–Ð²Ñ‚Ð¾Ñ€Ð¾Ðº_ÑÐµÑ€ÐµÐ´Ñƒ_Ñ‡ÐµÑ‚Ð²ÐµÑ€_Ð¿â€™ÑÑ‚Ð½Ð¸Ñ†ÑŽ_ÑÑƒÐ±Ð¾Ñ‚Ñƒ'.split('_'),
          'genitive': 'Ð½ÐµÐ´Ñ–Ð»Ñ–_Ð¿Ð¾Ð½ÐµÐ´Ñ–Ð»ÐºÐ°_Ð²Ñ–Ð²Ñ‚Ð¾Ñ€ÐºÐ°_ÑÐµÑ€ÐµÐ´Ð¸_Ñ‡ÐµÑ‚Ð²ÐµÑ€Ð³Ð°_Ð¿â€™ÑÑ‚Ð½Ð¸Ñ†Ñ–_ÑÑƒÐ±Ð¾Ñ‚Ð¸'.split('_')
        },

        nounCase = (/(\[[Ð’Ð²Ð£Ñƒ]\]) ?dddd/).test(format) ?
          'accusative' :
          ((/\[?(?:Ð¼Ð¸Ð½ÑƒÐ»Ð¾Ñ—|Ð½Ð°ÑÑ‚ÑƒÐ¿Ð½Ð¾Ñ—)? ?\] ?dddd/).test(format) ?
            'genitive' :
            'nominative');

      return weekdays[nounCase][m.day()];
    }

    function processHoursFunction(str) {
      return function () {
        return str + 'Ð¾' + (this.hours() === 11 ? 'Ð±' : '') + '] LT';
      };
    }

    return moment.lang('uk', {
      months : monthsCaseReplace,
      monthsShort : "ÑÑ–Ñ‡_Ð»ÑŽÑ‚_Ð±ÐµÑ€_ÐºÐ²Ñ–Ñ‚_Ñ‚Ñ€Ð°Ð²_Ñ‡ÐµÑ€Ð²_Ð»Ð¸Ð¿_ÑÐµÑ€Ð¿_Ð²ÐµÑ€_Ð¶Ð¾Ð²Ñ‚_Ð»Ð¸ÑÑ‚_Ð³Ñ€ÑƒÐ´".split("_"),
      weekdays : weekdaysCaseReplace,
      weekdaysShort : "Ð½Ð´_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),
      weekdaysMin : "Ð½Ð´_Ð¿Ð½_Ð²Ñ‚_ÑÑ€_Ñ‡Ñ‚_Ð¿Ñ‚_ÑÐ±".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD.MM.YYYY",
        LL : "D MMMM YYYY Ñ€.",
        LLL : "D MMMM YYYY Ñ€., LT",
        LLLL : "dddd, D MMMM YYYY Ñ€., LT"
      },
      calendar : {
        sameDay: processHoursFunction('[Ð¡ÑŒÐ¾Ð³Ð¾Ð´Ð½Ñ– '),
        nextDay: processHoursFunction('[Ð—Ð°Ð²Ñ‚Ñ€Ð° '),
        lastDay: processHoursFunction('[Ð’Ñ‡Ð¾Ñ€Ð° '),
        nextWeek: processHoursFunction('[Ð£] dddd ['),
        lastWeek: function () {
          switch (this.day()) {
            case 0:
            case 3:
            case 5:
            case 6:
              return processHoursFunction('[ÐœÐ¸Ð½ÑƒÐ»Ð¾Ñ—] dddd [').call(this);
            case 1:
            case 2:
            case 4:
              return processHoursFunction('[ÐœÐ¸Ð½ÑƒÐ»Ð¾Ð³Ð¾] dddd [').call(this);
          }
        },
        sameElse: 'L'
      },
      relativeTime : {
        future : "Ð·Ð° %s",
        past : "%s Ñ‚Ð¾Ð¼Ñƒ",
        s : "Ð´ÐµÐºÑ–Ð»ÑŒÐºÐ° ÑÐµÐºÑƒÐ½Ð´",
        m : relativeTimeWithPlural,
        mm : relativeTimeWithPlural,
        h : "Ð³Ð¾Ð´Ð¸Ð½Ñƒ",
        hh : relativeTimeWithPlural,
        d : "Ð´ÐµÐ½ÑŒ",
        dd : relativeTimeWithPlural,
        M : "Ð¼Ñ–ÑÑÑ†ÑŒ",
        MM : relativeTimeWithPlural,
        y : "Ñ€Ñ–Ðº",
        yy : relativeTimeWithPlural
      },

      // M. E.: those two are virtually unused but a user might want to implement them for his/her website for some reason

      meridiem : function (hour, minute, isLower) {
        if (hour < 4) {
          return "Ð½Ð¾Ñ‡Ñ–";
        } else if (hour < 12) {
          return "Ñ€Ð°Ð½ÐºÑƒ";
        } else if (hour < 17) {
          return "Ð´Ð½Ñ";
        } else {
          return "Ð²ÐµÑ‡Ð¾Ñ€Ð°";
        }
      },

      ordinal: function (number, period) {
        switch (period) {
          case 'M':
          case 'd':
          case 'DDD':
          case 'w':
          case 'W':
            return number + '-Ð¹';
          case 'D':
            return number + '-Ð³Ð¾';
          default:
            return number;
        }
      },

      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 1st is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : uzbek
// author : Sardor Muminov : https://github.com/muminoff

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('uz', {
      months : "ÑÐ½Ð²Ð°Ñ€ÑŒ_Ñ„ÐµÐ²Ñ€Ð°Ð»ÑŒ_Ð¼Ð°Ñ€Ñ‚_Ð°Ð¿Ñ€ÐµÐ»ÑŒ_Ð¼Ð°Ð¹_Ð¸ÑŽÐ½ÑŒ_Ð¸ÑŽÐ»ÑŒ_Ð°Ð²Ð³ÑƒÑÑ‚_ÑÐµÐ½Ñ‚ÑÐ±Ñ€ÑŒ_Ð¾ÐºÑ‚ÑÐ±Ñ€ÑŒ_Ð½Ð¾ÑÐ±Ñ€ÑŒ_Ð´ÐµÐºÐ°Ð±Ñ€ÑŒ".split("_"),
      monthsShort : "ÑÐ½Ð²_Ñ„ÐµÐ²_Ð¼Ð°Ñ€_Ð°Ð¿Ñ€_Ð¼Ð°Ð¹_Ð¸ÑŽÐ½_Ð¸ÑŽÐ»_Ð°Ð²Ð³_ÑÐµÐ½_Ð¾ÐºÑ‚_Ð½Ð¾Ñ_Ð´ÐµÐº".split("_"),
      weekdays : "Ð¯ÐºÑˆÐ°Ð½Ð±Ð°_Ð”ÑƒÑˆÐ°Ð½Ð±Ð°_Ð¡ÐµÑˆÐ°Ð½Ð±Ð°_Ð§Ð¾Ñ€ÑˆÐ°Ð½Ð±Ð°_ÐŸÐ°Ð¹ÑˆÐ°Ð½Ð±Ð°_Ð–ÑƒÐ¼Ð°_Ð¨Ð°Ð½Ð±Ð°".split("_"),
      weekdaysShort : "Ð¯ÐºÑˆ_Ð”ÑƒÑˆ_Ð¡ÐµÑˆ_Ð§Ð¾Ñ€_ÐŸÐ°Ð¹_Ð–ÑƒÐ¼_Ð¨Ð°Ð½".split("_"),
      weekdaysMin : "Ð¯Ðº_Ð”Ñƒ_Ð¡Ðµ_Ð§Ð¾_ÐŸÐ°_Ð–Ñƒ_Ð¨Ð°".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM YYYY",
        LLL : "D MMMM YYYY LT",
        LLLL : "D MMMM YYYY, dddd LT"
      },
      calendar : {
        sameDay : '[Ð‘ÑƒÐ³ÑƒÐ½ ÑÐ¾Ð°Ñ‚] LT [Ð´Ð°]',
        nextDay : '[Ð­Ñ€Ñ‚Ð°Ð³Ð°] LT [Ð´Ð°]',
        nextWeek : 'dddd [ÐºÑƒÐ½Ð¸ ÑÐ¾Ð°Ñ‚] LT [Ð´Ð°]',
        lastDay : '[ÐšÐµÑ‡Ð° ÑÐ¾Ð°Ñ‚] LT [Ð´Ð°]',
        lastWeek : '[Ð£Ñ‚Ð³Ð°Ð½] dddd [ÐºÑƒÐ½Ð¸ ÑÐ¾Ð°Ñ‚] LT [Ð´Ð°]',
        sameElse : 'L'
      },
      relativeTime : {
        future : "Ð¯ÐºÐ¸Ð½ %s Ð¸Ñ‡Ð¸Ð´Ð°",
        past : "Ð‘Ð¸Ñ€ Ð½ÐµÑ‡Ð° %s Ð¾Ð»Ð´Ð¸Ð½",
        s : "Ñ„ÑƒÑ€ÑÐ°Ñ‚",
        m : "Ð±Ð¸Ñ€ Ð´Ð°ÐºÐ¸ÐºÐ°",
        mm : "%d Ð´Ð°ÐºÐ¸ÐºÐ°",
        h : "Ð±Ð¸Ñ€ ÑÐ¾Ð°Ñ‚",
        hh : "%d ÑÐ¾Ð°Ñ‚",
        d : "Ð±Ð¸Ñ€ ÐºÑƒÐ½",
        dd : "%d ÐºÑƒÐ½",
        M : "Ð±Ð¸Ñ€ Ð¾Ð¹",
        MM : "%d Ð¾Ð¹",
        y : "Ð±Ð¸Ñ€ Ð¹Ð¸Ð»",
        yy : "%d Ð¹Ð¸Ð»"
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 7  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : vietnamese (vn)
// author : Bang Nguyen : https://github.com/bangnk

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('vn', {
      months : "thÃ¡ng 1_thÃ¡ng 2_thÃ¡ng 3_thÃ¡ng 4_thÃ¡ng 5_thÃ¡ng 6_thÃ¡ng 7_thÃ¡ng 8_thÃ¡ng 9_thÃ¡ng 10_thÃ¡ng 11_thÃ¡ng 12".split("_"),
      monthsShort : "Th01_Th02_Th03_Th04_Th05_Th06_Th07_Th08_Th09_Th10_Th11_Th12".split("_"),
      weekdays : "chá»§ nháº­t_thá»© hai_thá»© ba_thá»© tÆ°_thá»© nÄƒm_thá»© sÃ¡u_thá»© báº£y".split("_"),
      weekdaysShort : "CN_T2_T3_T4_T5_T6_T7".split("_"),
      weekdaysMin : "CN_T2_T3_T4_T5_T6_T7".split("_"),
      longDateFormat : {
        LT : "HH:mm",
        L : "DD/MM/YYYY",
        LL : "D MMMM [nÄƒm] YYYY",
        LLL : "D MMMM [nÄƒm] YYYY LT",
        LLLL : "dddd, D MMMM [nÄƒm] YYYY LT",
        l : "DD/M/YYYY",
        ll : "D MMM YYYY",
        lll : "D MMM YYYY LT",
        llll : "ddd, D MMM YYYY LT"
      },
      calendar : {
        sameDay: "[HÃ´m nay lÃºc] LT",
        nextDay: '[NgÃ y mai lÃºc] LT',
        nextWeek: 'dddd [tuáº§n tá»›i lÃºc] LT',
        lastDay: '[HÃ´m qua lÃºc] LT',
        lastWeek: 'dddd [tuáº§n rá»“i lÃºc] LT',
        sameElse: 'L'
      },
      relativeTime : {
        future : "%s tá»›i",
        past : "%s trÆ°á»›c",
        s : "vÃ i giÃ¢y",
        m : "má»™t phÃºt",
        mm : "%d phÃºt",
        h : "má»™t giá»",
        hh : "%d giá»",
        d : "má»™t ngÃ y",
        dd : "%d ngÃ y",
        M : "má»™t thÃ¡ng",
        MM : "%d thÃ¡ng",
        y : "má»™t nÄƒm",
        yy : "%d nÄƒm"
      },
      ordinal : function (number) {
        return number;
      },
      week : {
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : chinese
// author : suupic : https://github.com/suupic
// author : Zeno Zeng : https://github.com/zenozeng

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('zh-cn', {
      months : "ä¸€æœˆ_äºŒæœˆ_ä¸‰æœˆ_å››æœˆ_äº”æœˆ_å…­æœˆ_ä¸ƒæœˆ_å…«æœˆ_ä¹æœˆ_åæœˆ_åä¸€æœˆ_åäºŒæœˆ".split("_"),
      monthsShort : "1æœˆ_2æœˆ_3æœˆ_4æœˆ_5æœˆ_6æœˆ_7æœˆ_8æœˆ_9æœˆ_10æœˆ_11æœˆ_12æœˆ".split("_"),
      weekdays : "æ˜ŸæœŸæ—¥_æ˜ŸæœŸä¸€_æ˜ŸæœŸäºŒ_æ˜ŸæœŸä¸‰_æ˜ŸæœŸå››_æ˜ŸæœŸäº”_æ˜ŸæœŸå…­".split("_"),
      weekdaysShort : "å‘¨æ—¥_å‘¨ä¸€_å‘¨äºŒ_å‘¨ä¸‰_å‘¨å››_å‘¨äº”_å‘¨å…­".split("_"),
      weekdaysMin : "æ—¥_ä¸€_äºŒ_ä¸‰_å››_äº”_å…­".split("_"),
      longDateFormat : {
        LT : "Ahç‚¹mm",
        L : "YYYYå¹´MMMDæ—¥",
        LL : "YYYYå¹´MMMDæ—¥",
        LLL : "YYYYå¹´MMMDæ—¥LT",
        LLLL : "YYYYå¹´MMMDæ—¥ddddLT",
        l : "YYYYå¹´MMMDæ—¥",
        ll : "YYYYå¹´MMMDæ—¥",
        lll : "YYYYå¹´MMMDæ—¥LT",
        llll : "YYYYå¹´MMMDæ—¥ddddLT"
      },
      meridiem : function (hour, minute, isLower) {
        var hm = hour * 100 + minute;
        if (hm < 600) {
          return "å‡Œæ™¨";
        } else if (hm < 900) {
          return "æ—©ä¸Š";
        } else if (hm < 1130) {
          return "ä¸Šåˆ";
        } else if (hm < 1230) {
          return "ä¸­åˆ";
        } else if (hm < 1800) {
          return "ä¸‹åˆ";
        } else {
          return "æ™šä¸Š";
        }
      },
      calendar : {
        sameDay : function () {
          return this.minutes() === 0 ? "[ä»Šå¤©]Ah[ç‚¹æ•´]" : "[ä»Šå¤©]LT";
        },
        nextDay : function () {
          return this.minutes() === 0 ? "[æ˜Žå¤©]Ah[ç‚¹æ•´]" : "[æ˜Žå¤©]LT";
        },
        lastDay : function () {
          return this.minutes() === 0 ? "[æ˜¨å¤©]Ah[ç‚¹æ•´]" : "[æ˜¨å¤©]LT";
        },
        nextWeek : function () {
          var startOfWeek, prefix;
          startOfWeek = moment().startOf('week');
          prefix = this.unix() - startOfWeek.unix() >= 7 * 24 * 3600 ? '[ä¸‹]' : '[æœ¬]';
          return this.minutes() === 0 ? prefix + "dddAhç‚¹æ•´" : prefix + "dddAhç‚¹mm";
        },
        lastWeek : function () {
          var startOfWeek, prefix;
          startOfWeek = moment().startOf('week');
          prefix = this.unix() < startOfWeek.unix()  ? '[ä¸Š]' : '[æœ¬]';
          return this.minutes() === 0 ? prefix + "dddAhç‚¹æ•´" : prefix + "dddAhç‚¹mm";
        },
        sameElse : 'L'
      },
      ordinal : function (number, period) {
        switch (period) {
          case "d":
          case "D":
          case "DDD":
            return number + "æ—¥";
          case "M":
            return number + "æœˆ";
          case "w":
          case "W":
            return number + "å‘¨";
          default:
            return number;
        }
      },
      relativeTime : {
        future : "%så†…",
        past : "%så‰",
        s : "å‡ ç§’",
        m : "1åˆ†é’Ÿ",
        mm : "%dåˆ†é’Ÿ",
        h : "1å°æ—¶",
        hh : "%då°æ—¶",
        d : "1å¤©",
        dd : "%då¤©",
        M : "1ä¸ªæœˆ",
        MM : "%dä¸ªæœˆ",
        y : "1å¹´",
        yy : "%då¹´"
      },
      week : {
        // GB/T 7408-1994ã€Šæ•°æ®å…ƒå’Œäº¤æ¢æ ¼å¼Â·ä¿¡æ¯äº¤æ¢Â·æ—¥æœŸå’Œæ—¶é—´è¡¨ç¤ºæ³•ã€‹ä¸ŽISO 8601:1988ç­‰æ•ˆ
        dow : 1, // Monday is the first day of the week.
        doy : 4  // The week that contains Jan 4th is the first week of the year.
      }
    });
  }));
// moment.js language configuration
// language : traditional chinese (zh-tw)
// author : Ben : https://github.com/ben-lin

  (function (factory) {
    factory(moment);
  }(function (moment) {
    return moment.lang('zh-tw', {
      months : "ä¸€æœˆ_äºŒæœˆ_ä¸‰æœˆ_å››æœˆ_äº”æœˆ_å…­æœˆ_ä¸ƒæœˆ_å…«æœˆ_ä¹æœˆ_åæœˆ_åä¸€æœˆ_åäºŒæœˆ".split("_"),
      monthsShort : "1æœˆ_2æœˆ_3æœˆ_4æœˆ_5æœˆ_6æœˆ_7æœˆ_8æœˆ_9æœˆ_10æœˆ_11æœˆ_12æœˆ".split("_"),
      weekdays : "æ˜ŸæœŸæ—¥_æ˜ŸæœŸä¸€_æ˜ŸæœŸäºŒ_æ˜ŸæœŸä¸‰_æ˜ŸæœŸå››_æ˜ŸæœŸäº”_æ˜ŸæœŸå…­".split("_"),
      weekdaysShort : "é€±æ—¥_é€±ä¸€_é€±äºŒ_é€±ä¸‰_é€±å››_é€±äº”_é€±å…­".split("_"),
      weekdaysMin : "æ—¥_ä¸€_äºŒ_ä¸‰_å››_äº”_å…­".split("_"),
      longDateFormat : {
        LT : "Ahé»žmm",
        L : "YYYYå¹´MMMDæ—¥",
        LL : "YYYYå¹´MMMDæ—¥",
        LLL : "YYYYå¹´MMMDæ—¥LT",
        LLLL : "YYYYå¹´MMMDæ—¥ddddLT",
        l : "YYYYå¹´MMMDæ—¥",
        ll : "YYYYå¹´MMMDæ—¥",
        lll : "YYYYå¹´MMMDæ—¥LT",
        llll : "YYYYå¹´MMMDæ—¥ddddLT"
      },
      meridiem : function (hour, minute, isLower) {
        var hm = hour * 100 + minute;
        if (hm < 900) {
          return "æ—©ä¸Š";
        } else if (hm < 1130) {
          return "ä¸Šåˆ";
        } else if (hm < 1230) {
          return "ä¸­åˆ";
        } else if (hm < 1800) {
          return "ä¸‹åˆ";
        } else {
          return "æ™šä¸Š";
        }
      },
      calendar : {
        sameDay : '[ä»Šå¤©]LT',
        nextDay : '[æ˜Žå¤©]LT',
        nextWeek : '[ä¸‹]ddddLT',
        lastDay : '[æ˜¨å¤©]LT',
        lastWeek : '[ä¸Š]ddddLT',
        sameElse : 'L'
      },
      ordinal : function (number, period) {
        switch (period) {
          case "d" :
          case "D" :
          case "DDD" :
            return number + "æ—¥";
          case "M" :
            return number + "æœˆ";
          case "w" :
          case "W" :
            return number + "é€±";
          default :
            return number;
        }
      },
      relativeTime : {
        future : "%så…§",
        past : "%så‰",
        s : "å¹¾ç§’",
        m : "ä¸€åˆ†é˜",
        mm : "%dåˆ†é˜",
        h : "ä¸€å°æ™‚",
        hh : "%då°æ™‚",
        d : "ä¸€å¤©",
        dd : "%då¤©",
        M : "ä¸€å€‹æœˆ",
        MM : "%då€‹æœˆ",
        y : "ä¸€å¹´",
        yy : "%då¹´"
      }
    });
  }));

  moment.lang('en');


  /************************************
   Exposing Moment
   ************************************/

  function makeGlobal(deprecate) {
    var warned = false, local_moment = moment;
    /*global ender:false */
    if (typeof ender !== 'undefined') {
      return;
    }
    // here, `this` means `window` in the browser, or `global` on the server
    // add `moment` as a global object via a string identifier,
    // for Closure Compiler "advanced" mode
    if (deprecate) {
      this.moment = function () {
        if (!warned && console && console.warn) {
          warned = true;
          console.warn(
            "Accessing Moment through the global scope is " +
              "deprecated, and will be removed in an upcoming " +
              "release.");
        }
        return local_moment.apply(null, arguments);
      };
    } else {
      this['moment'] = moment;
    }
  }

  // CommonJS module is defined
  if (hasModule) {
    module.exports = moment;
    makeGlobal(true);
  } else if (typeof define === "function" && define.amd) {
    define("vendor/moment", function (require, exports, module) {
      if (module.config().noGlobal !== true) {
        // If user provided noGlobal, he is aware of global
        makeGlobal(module.config().noGlobal === undefined);
      }

      return moment;
    });
  } else {
    makeGlobal();
  }
}).call(this);


/*!

 handlebars v1.1.2

 Copyright (C) 2011 by Yehuda Katz

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.

 @license
 */
define('vendor/handlebars', function() {
// handlebars/safe-string.js
  var __module4__ = (function() {
    "use strict";
    var __exports__;
    // Build out our basic SafeString type
    function SafeString(string) {
      this.string = string;
    }

    SafeString.prototype.toString = function() {
      return "" + this.string;
    };

    __exports__ = SafeString;
    return __exports__;
  })();

// handlebars/utils.js
  var __module3__ = (function(__dependency1__) {
    "use strict";
    var __exports__ = {};
    var SafeString = __dependency1__;

    var escape = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#x27;",
      "`": "&#x60;"
    };

    var badChars = /[&<>"'`]/g;
    var possible = /[&<>"'`]/;

    function escapeChar(chr) {
      return escape[chr] || "&amp;";
    }

    function extend(obj, value) {
      for(var key in value) {
        if(value.hasOwnProperty(key)) {
          obj[key] = value[key];
        }
      }
    }

    __exports__.extend = extend;var toString = Object.prototype.toString;
    __exports__.toString = toString;
    // Sourced from lodash
    // https://github.com/bestiejs/lodash/blob/master/LICENSE.txt
    var isFunction = function(value) {
      return typeof value === 'function';
    };
    // fallback for older versions of Chrome and Safari
    if (isFunction(/x/)) {
      isFunction = function(value) {
        return typeof value === 'function' && toString.call(value) === '[object Function]';
      };
    }
    var isFunction;
    __exports__.isFunction = isFunction;
    var isArray = Array.isArray || function(value) {
      return (value && typeof value === 'object') ? toString.call(value) === '[object Array]' : false;
    };
    __exports__.isArray = isArray;

    function escapeExpression(string) {
      // don't escape SafeStrings, since they're already safe
      if (string instanceof SafeString) {
        return string.toString();
      } else if (!string && string !== 0) {
        return "";
      }

      // Force a string conversion as this will be done by the append regardless and
      // the regex test will do this transparently behind the scenes, causing issues if
      // an object's to string has escaped characters in it.
      string = "" + string;

      if(!possible.test(string)) { return string; }
      return string.replace(badChars, escapeChar);
    }

    __exports__.escapeExpression = escapeExpression;function isEmpty(value) {
      if (!value && value !== 0) {
        return true;
      } else if (isArray(value) && value.length === 0) {
        return true;
      } else {
        return false;
      }
    }

    __exports__.isEmpty = isEmpty;
    return __exports__;
  })(__module4__);

// handlebars/exception.js
  var __module5__ = (function() {
    "use strict";
    var __exports__;

    var errorProps = ['description', 'fileName', 'lineNumber', 'message', 'name', 'number', 'stack'];

    function Exception(/* message */) {
      var tmp = Error.prototype.constructor.apply(this, arguments);

      // Unfortunately errors are not enumerable in Chrome (at least), so `for prop in tmp` doesn't work.
      for (var idx = 0; idx < errorProps.length; idx++) {
        this[errorProps[idx]] = tmp[errorProps[idx]];
      }
    }

    Exception.prototype = new Error();

    __exports__ = Exception;
    return __exports__;
  })();

// handlebars/base.js
  var __module2__ = (function(__dependency1__, __dependency2__) {
    "use strict";
    var __exports__ = {};
    /*globals Exception, Utils */
    var Utils = __dependency1__;
    var Exception = __dependency2__;

    var VERSION = "1.1.2";
    __exports__.VERSION = VERSION;var COMPILER_REVISION = 4;
    __exports__.COMPILER_REVISION = COMPILER_REVISION;
    var REVISION_CHANGES = {
      1: '<= 1.0.rc.2', // 1.0.rc.2 is actually rev2 but doesn't report it
      2: '== 1.0.0-rc.3',
      3: '== 1.0.0-rc.4',
      4: '>= 1.0.0'
    };
    __exports__.REVISION_CHANGES = REVISION_CHANGES;
    var isArray = Utils.isArray,
      isFunction = Utils.isFunction,
      toString = Utils.toString,
      objectType = '[object Object]';

    function HandlebarsEnvironment(helpers, partials) {
      this.helpers = helpers || {};
      this.partials = partials || {};

      registerDefaultHelpers(this);
    }

    __exports__.HandlebarsEnvironment = HandlebarsEnvironment;HandlebarsEnvironment.prototype = {
      constructor: HandlebarsEnvironment,

      logger: logger,
      log: log,

      registerHelper: function(name, fn, inverse) {
        if (toString.call(name) === objectType) {
          if (inverse || fn) { throw new Exception('Arg not supported with multiple helpers'); }
          Utils.extend(this.helpers, name);
        } else {
          if (inverse) { fn.not = inverse; }
          this.helpers[name] = fn;
        }
      },

      registerPartial: function(name, str) {
        if (toString.call(name) === objectType) {
          Utils.extend(this.partials,  name);
        } else {
          this.partials[name] = str;
        }
      }
    };

    function registerDefaultHelpers(instance) {
      instance.registerHelper('helperMissing', function(arg) {
        if(arguments.length === 2) {
          return undefined;
        } else {
          throw new Error("Missing helper: '" + arg + "'");
        }
      });

      instance.registerHelper('blockHelperMissing', function(context, options) {
        var inverse = options.inverse || function() {}, fn = options.fn;

        if (isFunction(context)) { context = context.call(this); }

        if(context === true) {
          return fn(this);
        } else if(context === false || context == null) {
          return inverse(this);
        } else if (isArray(context)) {
          if(context.length > 0) {
            return instance.helpers.each(context, options);
          } else {
            return inverse(this);
          }
        } else {
          return fn(context);
        }
      });

      instance.registerHelper('each', function(context, options) {
        var fn = options.fn, inverse = options.inverse;
        var i = 0, ret = "", data;

        if (isFunction(context)) { context = context.call(this); }

        if (options.data) {
          data = createFrame(options.data);
        }

        if(context && typeof context === 'object') {
          if (isArray(context)) {
            for(var j = context.length; i<j; i++) {
              if (data) {
                data.index = i;
                data.first = (i === 0)
                data.last  = (i === (context.length-1));
              }
              ret = ret + fn(context[i], { data: data });
            }
          } else {
            for(var key in context) {
              if(context.hasOwnProperty(key)) {
                if(data) { data.key = key; }
                ret = ret + fn(context[key], {data: data});
                i++;
              }
            }
          }
        }

        if(i === 0){
          ret = inverse(this);
        }

        return ret;
      });

      instance.registerHelper('if', function(conditional, options) {
        if (isFunction(conditional)) { conditional = conditional.call(this); }

        // Default behavior is to render the positive path if the value is truthy and not empty.
        // The `includeZero` option may be set to treat the condtional as purely not empty based on the
        // behavior of isEmpty. Effectively this determines if 0 is handled by the positive path or negative.
        if ((!options.hash.includeZero && !conditional) || Utils.isEmpty(conditional)) {
          return options.inverse(this);
        } else {
          return options.fn(this);
        }
      });

      instance.registerHelper('unless', function(conditional, options) {
        return instance.helpers['if'].call(this, conditional, {fn: options.inverse, inverse: options.fn, hash: options.hash});
      });

      instance.registerHelper('with', function(context, options) {
        if (isFunction(context)) { context = context.call(this); }

        if (!Utils.isEmpty(context)) return options.fn(context);
      });

      instance.registerHelper('log', function(context, options) {
        var level = options.data && options.data.level != null ? parseInt(options.data.level, 10) : 1;
        instance.log(level, context);
      });
    }

    var logger = {
      methodMap: { 0: 'debug', 1: 'info', 2: 'warn', 3: 'error' },

      // State enum
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
      level: 3,

      // can be overridden in the host environment
      log: function(level, obj) {
        if (logger.level <= level) {
          var method = logger.methodMap[level];
          if (typeof console !== 'undefined' && console[method]) {
            console[method].call(console, obj);
          }
        }
      }
    };
    __exports__.logger = logger;
    function log(level, obj) { logger.log(level, obj); }

    __exports__.log = log;var createFrame = function(object) {
      var obj = {};
      Utils.extend(obj, object);
      return obj;
    };
    __exports__.createFrame = createFrame;
    return __exports__;
  })(__module3__, __module5__);

// handlebars/runtime.js
  var __module6__ = (function(__dependency1__, __dependency2__, __dependency3__) {
    "use strict";
    var __exports__ = {};
    /*global Utils */
    var Utils = __dependency1__;
    var Exception = __dependency2__;
    var COMPILER_REVISION = __dependency3__.COMPILER_REVISION;
    var REVISION_CHANGES = __dependency3__.REVISION_CHANGES;

    function checkRevision(compilerInfo) {
      var compilerRevision = compilerInfo && compilerInfo[0] || 1,
        currentRevision = COMPILER_REVISION;

      if (compilerRevision !== currentRevision) {
        if (compilerRevision < currentRevision) {
          var runtimeVersions = REVISION_CHANGES[currentRevision],
            compilerVersions = REVISION_CHANGES[compilerRevision];
          throw new Error("Template was precompiled with an older version of Handlebars than the current runtime. "+
            "Please update your precompiler to a newer version ("+runtimeVersions+") or downgrade your runtime to an older version ("+compilerVersions+").");
        } else {
          // Use the embedded version info since the runtime doesn't know about this revision yet
          throw new Error("Template was precompiled with a newer version of Handlebars than the current runtime. "+
            "Please update your runtime to a newer version ("+compilerInfo[1]+").");
        }
      }
    }

    // TODO: Remove this line and break up compilePartial

    function template(templateSpec, env) {
      if (!env) {
        throw new Error("No environment passed to template");
      }

      var invokePartialWrapper;
      if (env.compile) {
        invokePartialWrapper = function(partial, name, context, helpers, partials, data) {
          // TODO : Check this for all inputs and the options handling (partial flag, etc). This feels
          // like there should be a common exec path
          var result = invokePartial.apply(this, arguments);
          if (result) { return result; }

          var options = { helpers: helpers, partials: partials, data: data };
          partials[name] = env.compile(partial, { data: data !== undefined }, env);
          return partials[name](context, options);
        };
      } else {
        invokePartialWrapper = function(partial, name /* , context, helpers, partials, data */) {
          var result = invokePartial.apply(this, arguments);
          if (result) { return result; }
          throw new Exception("The partial " + name + " could not be compiled when running in runtime-only mode");
        };
      }

      // Just add water
      var container = {
        escapeExpression: Utils.escapeExpression,
        invokePartial: invokePartialWrapper,
        programs: [],
        program: function(i, fn, data) {
          var programWrapper = this.programs[i];
          if(data) {
            programWrapper = program(i, fn, data);
          } else if (!programWrapper) {
            programWrapper = this.programs[i] = program(i, fn);
          }
          return programWrapper;
        },
        merge: function(param, common) {
          var ret = param || common;

          if (param && common && (param !== common)) {
            ret = {};
            Utils.extend(ret, common);
            Utils.extend(ret, param);
          }
          return ret;
        },
        programWithDepth: programWithDepth,
        noop: noop,
        compilerInfo: null
      };

      return function(context, options) {
        options = options || {};
        var namespace = options.partial ? options : env,
          helpers,
          partials;

        if (!options.partial) {
          helpers = options.helpers;
          partials = options.partials;
        }
        var result = templateSpec.call(
          container,
          namespace, context,
          helpers,
          partials,
          options.data);

        if (!options.partial) {
          checkRevision(container.compilerInfo);
        }

        return result;
      };
    }

    __exports__.template = template;function programWithDepth(i, fn, data /*, $depth */) {
      var args = Array.prototype.slice.call(arguments, 3);

      var prog = function(context, options) {
        options = options || {};

        return fn.apply(this, [context, options.data || data].concat(args));
      };
      prog.program = i;
      prog.depth = args.length;
      return prog;
    }

    __exports__.programWithDepth = programWithDepth;function program(i, fn, data) {
      var prog = function(context, options) {
        options = options || {};

        return fn(context, options.data || data);
      };
      prog.program = i;
      prog.depth = 0;
      return prog;
    }

    __exports__.program = program;function invokePartial(partial, name, context, helpers, partials, data) {
      var options = { partial: true, helpers: helpers, partials: partials, data: data };

      if(partial === undefined) {
        throw new Exception("The partial " + name + " could not be found");
      } else if(partial instanceof Function) {
        return partial(context, options);
      }
    }

    __exports__.invokePartial = invokePartial;function noop() { return ""; }

    __exports__.noop = noop;
    return __exports__;
  })(__module3__, __module5__, __module2__);

// handlebars.runtime.js
  var __module1__ = (function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __dependency5__) {
    "use strict";
    var __exports__;
    var base = __dependency1__;

    // Each of these augment the Handlebars object. No need to setup here.
    // (This is done to easily share code between commonjs and browse envs)
    var SafeString = __dependency2__;
    var Exception = __dependency3__;
    var Utils = __dependency4__;
    var runtime = __dependency5__;

    // For compatibility and usage outside of module systems, make the Handlebars object a namespace
    var create = function() {
      var hb = new base.HandlebarsEnvironment();

      Utils.extend(hb, base);
      hb.SafeString = SafeString;
      hb.Exception = Exception;
      hb.Utils = Utils;

      hb.VM = runtime;
      hb.template = function(spec) {
        return runtime.template(spec, hb);
      };

      return hb;
    };

    var Handlebars = create();
    Handlebars.create = create;

    __exports__ = Handlebars;
    return __exports__;
  })(__module2__, __module4__, __module5__, __module3__, __module6__);

// handlebars/compiler/ast.js
  var __module7__ = (function(__dependency1__) {
    "use strict";
    var __exports__ = {};
    var Exception = __dependency1__;

    function ProgramNode(statements, inverseStrip, inverse) {
      this.type = "program";
      this.statements = statements;
      this.strip = {};

      if(inverse) {
        this.inverse = new ProgramNode(inverse, inverseStrip);
        this.strip.right = inverseStrip.left;
      } else if (inverseStrip) {
        this.strip.left = inverseStrip.right;
      }
    }

    __exports__.ProgramNode = ProgramNode;function MustacheNode(rawParams, hash, open, strip) {
      this.type = "mustache";
      this.hash = hash;
      this.strip = strip;

      var escapeFlag = open[3] || open[2];
      this.escaped = escapeFlag !== '{' && escapeFlag !== '&';

      var id = this.id = rawParams[0];
      var params = this.params = rawParams.slice(1);

      // a mustache is an eligible helper if:
      // * its id is simple (a single part, not `this` or `..`)
      var eligibleHelper = this.eligibleHelper = id.isSimple;

      // a mustache is definitely a helper if:
      // * it is an eligible helper, and
      // * it has at least one parameter or hash segment
      this.isHelper = eligibleHelper && (params.length || hash);

      // if a mustache is an eligible helper but not a definite
      // helper, it is ambiguous, and will be resolved in a later
      // pass or at runtime.
    }

    __exports__.MustacheNode = MustacheNode;function PartialNode(partialName, context, strip) {
      this.type         = "partial";
      this.partialName  = partialName;
      this.context      = context;
      this.strip = strip;
    }

    __exports__.PartialNode = PartialNode;function BlockNode(mustache, program, inverse, close) {
      if(mustache.id.original !== close.path.original) {
        throw new Exception(mustache.id.original + " doesn't match " + close.path.original);
      }

      this.type = "block";
      this.mustache = mustache;
      this.program  = program;
      this.inverse  = inverse;

      this.strip = {
        left: mustache.strip.left,
        right: close.strip.right
      };

      (program || inverse).strip.left = mustache.strip.right;
      (inverse || program).strip.right = close.strip.left;

      if (inverse && !program) {
        this.isInverse = true;
      }
    }

    __exports__.BlockNode = BlockNode;function ContentNode(string) {
      this.type = "content";
      this.string = string;
    }

    __exports__.ContentNode = ContentNode;function HashNode(pairs) {
      this.type = "hash";
      this.pairs = pairs;
    }

    __exports__.HashNode = HashNode;function IdNode(parts) {
      this.type = "ID";

      var original = "",
        dig = [],
        depth = 0;

      for(var i=0,l=parts.length; i<l; i++) {
        var part = parts[i].part;
        original += (parts[i].separator || '') + part;

        if (part === ".." || part === "." || part === "this") {
          if (dig.length > 0) { throw new Exception("Invalid path: " + original); }
          else if (part === "..") { depth++; }
          else { this.isScoped = true; }
        }
        else { dig.push(part); }
      }

      this.original = original;
      this.parts    = dig;
      this.string   = dig.join('.');
      this.depth    = depth;

      // an ID is simple if it only has one part, and that part is not
      // `..` or `this`.
      this.isSimple = parts.length === 1 && !this.isScoped && depth === 0;

      this.stringModeValue = this.string;
    }

    __exports__.IdNode = IdNode;function PartialNameNode(name) {
      this.type = "PARTIAL_NAME";
      this.name = name.original;
    }

    __exports__.PartialNameNode = PartialNameNode;function DataNode(id) {
      this.type = "DATA";
      this.id = id;
    }

    __exports__.DataNode = DataNode;function StringNode(string) {
      this.type = "STRING";
      this.original =
        this.string =
          this.stringModeValue = string;
    }

    __exports__.StringNode = StringNode;function IntegerNode(integer) {
      this.type = "INTEGER";
      this.original =
        this.integer = integer;
      this.stringModeValue = Number(integer);
    }

    __exports__.IntegerNode = IntegerNode;function BooleanNode(bool) {
      this.type = "BOOLEAN";
      this.bool = bool;
      this.stringModeValue = bool === "true";
    }

    __exports__.BooleanNode = BooleanNode;function CommentNode(comment) {
      this.type = "comment";
      this.comment = comment;
    }

    __exports__.CommentNode = CommentNode;
    return __exports__;
  })(__module5__);

// handlebars/compiler/parser.js
  var __module9__ = (function() {
    "use strict";
    var __exports__;
    /* Jison generated parser */
    var handlebars = (function(){
      var parser = {trace: function trace() { },
        yy: {},
        symbols_: {"error":2,"root":3,"statements":4,"EOF":5,"program":6,"simpleInverse":7,"statement":8,"openInverse":9,"closeBlock":10,"openBlock":11,"mustache":12,"partial":13,"CONTENT":14,"COMMENT":15,"OPEN_BLOCK":16,"inMustache":17,"CLOSE":18,"OPEN_INVERSE":19,"OPEN_ENDBLOCK":20,"path":21,"OPEN":22,"OPEN_UNESCAPED":23,"CLOSE_UNESCAPED":24,"OPEN_PARTIAL":25,"partialName":26,"partial_option0":27,"inMustache_repetition0":28,"inMustache_option0":29,"dataName":30,"param":31,"STRING":32,"INTEGER":33,"BOOLEAN":34,"hash":35,"hash_repetition_plus0":36,"hashSegment":37,"ID":38,"EQUALS":39,"DATA":40,"pathSegments":41,"SEP":42,"$accept":0,"$end":1},
        terminals_: {2:"error",5:"EOF",14:"CONTENT",15:"COMMENT",16:"OPEN_BLOCK",18:"CLOSE",19:"OPEN_INVERSE",20:"OPEN_ENDBLOCK",22:"OPEN",23:"OPEN_UNESCAPED",24:"CLOSE_UNESCAPED",25:"OPEN_PARTIAL",32:"STRING",33:"INTEGER",34:"BOOLEAN",38:"ID",39:"EQUALS",40:"DATA",42:"SEP"},
        productions_: [0,[3,2],[3,1],[6,2],[6,3],[6,2],[6,1],[6,1],[6,0],[4,1],[4,2],[8,3],[8,3],[8,1],[8,1],[8,1],[8,1],[11,3],[9,3],[10,3],[12,3],[12,3],[13,4],[7,2],[17,3],[17,1],[31,1],[31,1],[31,1],[31,1],[31,1],[35,1],[37,3],[26,1],[26,1],[26,1],[30,2],[21,1],[41,3],[41,1],[27,0],[27,1],[28,0],[28,2],[29,0],[29,1],[36,1],[36,2]],
        performAction: function anonymous(yytext,yyleng,yylineno,yy,yystate,$$,_$) {

          var $0 = $$.length - 1;
          switch (yystate) {
            case 1: return new yy.ProgramNode($$[$0-1]);
              break;
            case 2: return new yy.ProgramNode([]);
              break;
            case 3:this.$ = new yy.ProgramNode([], $$[$0-1], $$[$0]);
              break;
            case 4:this.$ = new yy.ProgramNode($$[$0-2], $$[$0-1], $$[$0]);
              break;
            case 5:this.$ = new yy.ProgramNode($$[$0-1], $$[$0], []);
              break;
            case 6:this.$ = new yy.ProgramNode($$[$0]);
              break;
            case 7:this.$ = new yy.ProgramNode([]);
              break;
            case 8:this.$ = new yy.ProgramNode([]);
              break;
            case 9:this.$ = [$$[$0]];
              break;
            case 10: $$[$0-1].push($$[$0]); this.$ = $$[$0-1];
              break;
            case 11:this.$ = new yy.BlockNode($$[$0-2], $$[$0-1].inverse, $$[$0-1], $$[$0]);
              break;
            case 12:this.$ = new yy.BlockNode($$[$0-2], $$[$0-1], $$[$0-1].inverse, $$[$0]);
              break;
            case 13:this.$ = $$[$0];
              break;
            case 14:this.$ = $$[$0];
              break;
            case 15:this.$ = new yy.ContentNode($$[$0]);
              break;
            case 16:this.$ = new yy.CommentNode($$[$0]);
              break;
            case 17:this.$ = new yy.MustacheNode($$[$0-1][0], $$[$0-1][1], $$[$0-2], stripFlags($$[$0-2], $$[$0]));
              break;
            case 18:this.$ = new yy.MustacheNode($$[$0-1][0], $$[$0-1][1], $$[$0-2], stripFlags($$[$0-2], $$[$0]));
              break;
            case 19:this.$ = {path: $$[$0-1], strip: stripFlags($$[$0-2], $$[$0])};
              break;
            case 20:this.$ = new yy.MustacheNode($$[$0-1][0], $$[$0-1][1], $$[$0-2], stripFlags($$[$0-2], $$[$0]));
              break;
            case 21:this.$ = new yy.MustacheNode($$[$0-1][0], $$[$0-1][1], $$[$0-2], stripFlags($$[$0-2], $$[$0]));
              break;
            case 22:this.$ = new yy.PartialNode($$[$0-2], $$[$0-1], stripFlags($$[$0-3], $$[$0]));
              break;
            case 23:this.$ = stripFlags($$[$0-1], $$[$0]);
              break;
            case 24:this.$ = [[$$[$0-2]].concat($$[$0-1]), $$[$0]];
              break;
            case 25:this.$ = [[$$[$0]], null];
              break;
            case 26:this.$ = $$[$0];
              break;
            case 27:this.$ = new yy.StringNode($$[$0]);
              break;
            case 28:this.$ = new yy.IntegerNode($$[$0]);
              break;
            case 29:this.$ = new yy.BooleanNode($$[$0]);
              break;
            case 30:this.$ = $$[$0];
              break;
            case 31:this.$ = new yy.HashNode($$[$0]);
              break;
            case 32:this.$ = [$$[$0-2], $$[$0]];
              break;
            case 33:this.$ = new yy.PartialNameNode($$[$0]);
              break;
            case 34:this.$ = new yy.PartialNameNode(new yy.StringNode($$[$0]));
              break;
            case 35:this.$ = new yy.PartialNameNode(new yy.IntegerNode($$[$0]));
              break;
            case 36:this.$ = new yy.DataNode($$[$0]);
              break;
            case 37:this.$ = new yy.IdNode($$[$0]);
              break;
            case 38: $$[$0-2].push({part: $$[$0], separator: $$[$0-1]}); this.$ = $$[$0-2];
              break;
            case 39:this.$ = [{part: $$[$0]}];
              break;
            case 42:this.$ = [];
              break;
            case 43:$$[$0-1].push($$[$0]);
              break;
            case 46:this.$ = [$$[$0]];
              break;
            case 47:$$[$0-1].push($$[$0]);
              break;
          }
        },
        table: [{3:1,4:2,5:[1,3],8:4,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],22:[1,13],23:[1,14],25:[1,15]},{1:[3]},{5:[1,16],8:17,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],22:[1,13],23:[1,14],25:[1,15]},{1:[2,2]},{5:[2,9],14:[2,9],15:[2,9],16:[2,9],19:[2,9],20:[2,9],22:[2,9],23:[2,9],25:[2,9]},{4:20,6:18,7:19,8:4,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,21],20:[2,8],22:[1,13],23:[1,14],25:[1,15]},{4:20,6:22,7:19,8:4,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,21],20:[2,8],22:[1,13],23:[1,14],25:[1,15]},{5:[2,13],14:[2,13],15:[2,13],16:[2,13],19:[2,13],20:[2,13],22:[2,13],23:[2,13],25:[2,13]},{5:[2,14],14:[2,14],15:[2,14],16:[2,14],19:[2,14],20:[2,14],22:[2,14],23:[2,14],25:[2,14]},{5:[2,15],14:[2,15],15:[2,15],16:[2,15],19:[2,15],20:[2,15],22:[2,15],23:[2,15],25:[2,15]},{5:[2,16],14:[2,16],15:[2,16],16:[2,16],19:[2,16],20:[2,16],22:[2,16],23:[2,16],25:[2,16]},{17:23,21:24,30:25,38:[1,28],40:[1,27],41:26},{17:29,21:24,30:25,38:[1,28],40:[1,27],41:26},{17:30,21:24,30:25,38:[1,28],40:[1,27],41:26},{17:31,21:24,30:25,38:[1,28],40:[1,27],41:26},{21:33,26:32,32:[1,34],33:[1,35],38:[1,28],41:26},{1:[2,1]},{5:[2,10],14:[2,10],15:[2,10],16:[2,10],19:[2,10],20:[2,10],22:[2,10],23:[2,10],25:[2,10]},{10:36,20:[1,37]},{4:38,8:4,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],20:[2,7],22:[1,13],23:[1,14],25:[1,15]},{7:39,8:17,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,21],20:[2,6],22:[1,13],23:[1,14],25:[1,15]},{17:23,18:[1,40],21:24,30:25,38:[1,28],40:[1,27],41:26},{10:41,20:[1,37]},{18:[1,42]},{18:[2,42],24:[2,42],28:43,32:[2,42],33:[2,42],34:[2,42],38:[2,42],40:[2,42]},{18:[2,25],24:[2,25]},{18:[2,37],24:[2,37],32:[2,37],33:[2,37],34:[2,37],38:[2,37],40:[2,37],42:[1,44]},{21:45,38:[1,28],41:26},{18:[2,39],24:[2,39],32:[2,39],33:[2,39],34:[2,39],38:[2,39],40:[2,39],42:[2,39]},{18:[1,46]},{18:[1,47]},{24:[1,48]},{18:[2,40],21:50,27:49,38:[1,28],41:26},{18:[2,33],38:[2,33]},{18:[2,34],38:[2,34]},{18:[2,35],38:[2,35]},{5:[2,11],14:[2,11],15:[2,11],16:[2,11],19:[2,11],20:[2,11],22:[2,11],23:[2,11],25:[2,11]},{21:51,38:[1,28],41:26},{8:17,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],20:[2,3],22:[1,13],23:[1,14],25:[1,15]},{4:52,8:4,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],20:[2,5],22:[1,13],23:[1,14],25:[1,15]},{14:[2,23],15:[2,23],16:[2,23],19:[2,23],20:[2,23],22:[2,23],23:[2,23],25:[2,23]},{5:[2,12],14:[2,12],15:[2,12],16:[2,12],19:[2,12],20:[2,12],22:[2,12],23:[2,12],25:[2,12]},{14:[2,18],15:[2,18],16:[2,18],19:[2,18],20:[2,18],22:[2,18],23:[2,18],25:[2,18]},{18:[2,44],21:56,24:[2,44],29:53,30:60,31:54,32:[1,57],33:[1,58],34:[1,59],35:55,36:61,37:62,38:[1,63],40:[1,27],41:26},{38:[1,64]},{18:[2,36],24:[2,36],32:[2,36],33:[2,36],34:[2,36],38:[2,36],40:[2,36]},{14:[2,17],15:[2,17],16:[2,17],19:[2,17],20:[2,17],22:[2,17],23:[2,17],25:[2,17]},{5:[2,20],14:[2,20],15:[2,20],16:[2,20],19:[2,20],20:[2,20],22:[2,20],23:[2,20],25:[2,20]},{5:[2,21],14:[2,21],15:[2,21],16:[2,21],19:[2,21],20:[2,21],22:[2,21],23:[2,21],25:[2,21]},{18:[1,65]},{18:[2,41]},{18:[1,66]},{8:17,9:5,11:6,12:7,13:8,14:[1,9],15:[1,10],16:[1,12],19:[1,11],20:[2,4],22:[1,13],23:[1,14],25:[1,15]},{18:[2,24],24:[2,24]},{18:[2,43],24:[2,43],32:[2,43],33:[2,43],34:[2,43],38:[2,43],40:[2,43]},{18:[2,45],24:[2,45]},{18:[2,26],24:[2,26],32:[2,26],33:[2,26],34:[2,26],38:[2,26],40:[2,26]},{18:[2,27],24:[2,27],32:[2,27],33:[2,27],34:[2,27],38:[2,27],40:[2,27]},{18:[2,28],24:[2,28],32:[2,28],33:[2,28],34:[2,28],38:[2,28],40:[2,28]},{18:[2,29],24:[2,29],32:[2,29],33:[2,29],34:[2,29],38:[2,29],40:[2,29]},{18:[2,30],24:[2,30],32:[2,30],33:[2,30],34:[2,30],38:[2,30],40:[2,30]},{18:[2,31],24:[2,31],37:67,38:[1,68]},{18:[2,46],24:[2,46],38:[2,46]},{18:[2,39],24:[2,39],32:[2,39],33:[2,39],34:[2,39],38:[2,39],39:[1,69],40:[2,39],42:[2,39]},{18:[2,38],24:[2,38],32:[2,38],33:[2,38],34:[2,38],38:[2,38],40:[2,38],42:[2,38]},{5:[2,22],14:[2,22],15:[2,22],16:[2,22],19:[2,22],20:[2,22],22:[2,22],23:[2,22],25:[2,22]},{5:[2,19],14:[2,19],15:[2,19],16:[2,19],19:[2,19],20:[2,19],22:[2,19],23:[2,19],25:[2,19]},{18:[2,47],24:[2,47],38:[2,47]},{39:[1,69]},{21:56,30:60,31:70,32:[1,57],33:[1,58],34:[1,59],38:[1,28],40:[1,27],41:26},{18:[2,32],24:[2,32],38:[2,32]}],
        defaultActions: {3:[2,2],16:[2,1],50:[2,41]},
        parseError: function parseError(str, hash) {
          throw new Error(str);
        },
        parse: function parse(input) {
          var self = this, stack = [0], vstack = [null], lstack = [], table = this.table, yytext = "", yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;
          this.lexer.setInput(input);
          this.lexer.yy = this.yy;
          this.yy.lexer = this.lexer;
          this.yy.parser = this;
          if (typeof this.lexer.yylloc == "undefined")
            this.lexer.yylloc = {};
          var yyloc = this.lexer.yylloc;
          lstack.push(yyloc);
          var ranges = this.lexer.options && this.lexer.options.ranges;
          if (typeof this.yy.parseError === "function")
            this.parseError = this.yy.parseError;
          function popStack(n) {
            stack.length = stack.length - 2 * n;
            vstack.length = vstack.length - n;
            lstack.length = lstack.length - n;
          }
          function lex() {
            var token;
            token = self.lexer.lex() || 1;
            if (typeof token !== "number") {
              token = self.symbols_[token] || token;
            }
            return token;
          }
          var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
          while (true) {
            state = stack[stack.length - 1];
            if (this.defaultActions[state]) {
              action = this.defaultActions[state];
            } else {
              if (symbol === null || typeof symbol == "undefined") {
                symbol = lex();
              }
              action = table[state] && table[state][symbol];
            }
            if (typeof action === "undefined" || !action.length || !action[0]) {
              var errStr = "";
              if (!recovering) {
                expected = [];
                for (p in table[state])
                  if (this.terminals_[p] && p > 2) {
                    expected.push("'" + this.terminals_[p] + "'");
                  }
                if (this.lexer.showPosition) {
                  errStr = "Parse error on line " + (yylineno + 1) + ":\n" + this.lexer.showPosition() + "\nExpecting " + expected.join(", ") + ", got '" + (this.terminals_[symbol] || symbol) + "'";
                } else {
                  errStr = "Parse error on line " + (yylineno + 1) + ": Unexpected " + (symbol == 1?"end of input":"'" + (this.terminals_[symbol] || symbol) + "'");
                }
                this.parseError(errStr, {text: this.lexer.match, token: this.terminals_[symbol] || symbol, line: this.lexer.yylineno, loc: yyloc, expected: expected});
              }
            }
            if (action[0] instanceof Array && action.length > 1) {
              throw new Error("Parse Error: multiple actions possible at state: " + state + ", token: " + symbol);
            }
            switch (action[0]) {
              case 1:
                stack.push(symbol);
                vstack.push(this.lexer.yytext);
                lstack.push(this.lexer.yylloc);
                stack.push(action[1]);
                symbol = null;
                if (!preErrorSymbol) {
                  yyleng = this.lexer.yyleng;
                  yytext = this.lexer.yytext;
                  yylineno = this.lexer.yylineno;
                  yyloc = this.lexer.yylloc;
                  if (recovering > 0)
                    recovering--;
                } else {
                  symbol = preErrorSymbol;
                  preErrorSymbol = null;
                }
                break;
              case 2:
                len = this.productions_[action[1]][1];
                yyval.$ = vstack[vstack.length - len];
                yyval._$ = {first_line: lstack[lstack.length - (len || 1)].first_line, last_line: lstack[lstack.length - 1].last_line, first_column: lstack[lstack.length - (len || 1)].first_column, last_column: lstack[lstack.length - 1].last_column};
                if (ranges) {
                  yyval._$.range = [lstack[lstack.length - (len || 1)].range[0], lstack[lstack.length - 1].range[1]];
                }
                r = this.performAction.call(yyval, yytext, yyleng, yylineno, this.yy, action[1], vstack, lstack);
                if (typeof r !== "undefined") {
                  return r;
                }
                if (len) {
                  stack = stack.slice(0, -1 * len * 2);
                  vstack = vstack.slice(0, -1 * len);
                  lstack = lstack.slice(0, -1 * len);
                }
                stack.push(this.productions_[action[1]][0]);
                vstack.push(yyval.$);
                lstack.push(yyval._$);
                newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
                stack.push(newState);
                break;
              case 3:
                return true;
            }
          }
          return true;
        }
      };


      function stripFlags(open, close) {
        return {
          left: open[2] === '~',
          right: close[0] === '~' || close[1] === '~'
        };
      }

      /* Jison generated lexer */
      var lexer = (function(){
        var lexer = ({EOF:1,
          parseError:function parseError(str, hash) {
            if (this.yy.parser) {
              this.yy.parser.parseError(str, hash);
            } else {
              throw new Error(str);
            }
          },
          setInput:function (input) {
            this._input = input;
            this._more = this._less = this.done = false;
            this.yylineno = this.yyleng = 0;
            this.yytext = this.matched = this.match = '';
            this.conditionStack = ['INITIAL'];
            this.yylloc = {first_line:1,first_column:0,last_line:1,last_column:0};
            if (this.options.ranges) this.yylloc.range = [0,0];
            this.offset = 0;
            return this;
          },
          input:function () {
            var ch = this._input[0];
            this.yytext += ch;
            this.yyleng++;
            this.offset++;
            this.match += ch;
            this.matched += ch;
            var lines = ch.match(/(?:\r\n?|\n).*/g);
            if (lines) {
              this.yylineno++;
              this.yylloc.last_line++;
            } else {
              this.yylloc.last_column++;
            }
            if (this.options.ranges) this.yylloc.range[1]++;

            this._input = this._input.slice(1);
            return ch;
          },
          unput:function (ch) {
            var len = ch.length;
            var lines = ch.split(/(?:\r\n?|\n)/g);

            this._input = ch + this._input;
            this.yytext = this.yytext.substr(0, this.yytext.length-len-1);
            //this.yyleng -= len;
            this.offset -= len;
            var oldLines = this.match.split(/(?:\r\n?|\n)/g);
            this.match = this.match.substr(0, this.match.length-1);
            this.matched = this.matched.substr(0, this.matched.length-1);

            if (lines.length-1) this.yylineno -= lines.length-1;
            var r = this.yylloc.range;

            this.yylloc = {first_line: this.yylloc.first_line,
              last_line: this.yylineno+1,
              first_column: this.yylloc.first_column,
              last_column: lines ?
                (lines.length === oldLines.length ? this.yylloc.first_column : 0) + oldLines[oldLines.length - lines.length].length - lines[0].length:
                this.yylloc.first_column - len
            };

            if (this.options.ranges) {
              this.yylloc.range = [r[0], r[0] + this.yyleng - len];
            }
            return this;
          },
          more:function () {
            this._more = true;
            return this;
          },
          less:function (n) {
            this.unput(this.match.slice(n));
          },
          pastInput:function () {
            var past = this.matched.substr(0, this.matched.length - this.match.length);
            return (past.length > 20 ? '...':'') + past.substr(-20).replace(/\n/g, "");
          },
          upcomingInput:function () {
            var next = this.match;
            if (next.length < 20) {
              next += this._input.substr(0, 20-next.length);
            }
            return (next.substr(0,20)+(next.length > 20 ? '...':'')).replace(/\n/g, "");
          },
          showPosition:function () {
            var pre = this.pastInput();
            var c = new Array(pre.length + 1).join("-");
            return pre + this.upcomingInput() + "\n" + c+"^";
          },
          next:function () {
            if (this.done) {
              return this.EOF;
            }
            if (!this._input) this.done = true;

            var token,
              match,
              tempMatch,
              index,
              col,
              lines;
            if (!this._more) {
              this.yytext = '';
              this.match = '';
            }
            var rules = this._currentRules();
            for (var i=0;i < rules.length; i++) {
              tempMatch = this._input.match(this.rules[rules[i]]);
              if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
                match = tempMatch;
                index = i;
                if (!this.options.flex) break;
              }
            }
            if (match) {
              lines = match[0].match(/(?:\r\n?|\n).*/g);
              if (lines) this.yylineno += lines.length;
              this.yylloc = {first_line: this.yylloc.last_line,
                last_line: this.yylineno+1,
                first_column: this.yylloc.last_column,
                last_column: lines ? lines[lines.length-1].length-lines[lines.length-1].match(/\r?\n?/)[0].length : this.yylloc.last_column + match[0].length};
              this.yytext += match[0];
              this.match += match[0];
              this.matches = match;
              this.yyleng = this.yytext.length;
              if (this.options.ranges) {
                this.yylloc.range = [this.offset, this.offset += this.yyleng];
              }
              this._more = false;
              this._input = this._input.slice(match[0].length);
              this.matched += match[0];
              token = this.performAction.call(this, this.yy, this, rules[index],this.conditionStack[this.conditionStack.length-1]);
              if (this.done && this._input) this.done = false;
              if (token) return token;
              else return;
            }
            if (this._input === "") {
              return this.EOF;
            } else {
              return this.parseError('Lexical error on line '+(this.yylineno+1)+'. Unrecognized text.\n'+this.showPosition(),
                {text: "", token: null, line: this.yylineno});
            }
          },
          lex:function lex() {
            var r = this.next();
            if (typeof r !== 'undefined') {
              return r;
            } else {
              return this.lex();
            }
          },
          begin:function begin(condition) {
            this.conditionStack.push(condition);
          },
          popState:function popState() {
            return this.conditionStack.pop();
          },
          _currentRules:function _currentRules() {
            return this.conditions[this.conditionStack[this.conditionStack.length-1]].rules;
          },
          topState:function () {
            return this.conditionStack[this.conditionStack.length-2];
          },
          pushState:function begin(condition) {
            this.begin(condition);
          }});
        lexer.options = {};
        lexer.performAction = function anonymous(yy,yy_,$avoiding_name_collisions,YY_START) {


          function strip(start, end) {
            return yy_.yytext = yy_.yytext.substr(start, yy_.yyleng-end);
          }


          var YYSTATE=YY_START
          switch($avoiding_name_collisions) {
            case 0:
              if(yy_.yytext.slice(-2) === "\\\\") {
                strip(0,1);
                this.begin("mu");
              } else if(yy_.yytext.slice(-1) === "\\") {
                strip(0,1);
                this.begin("emu");
              } else {
                this.begin("mu");
              }
              if(yy_.yytext) return 14;

              break;
            case 1:return 14;
              break;
            case 2:
              if(yy_.yytext.slice(-1) !== "\\") this.popState();
              if(yy_.yytext.slice(-1) === "\\") strip(0,1);
              return 14;

              break;
            case 3:strip(0,4); this.popState(); return 15;
              break;
            case 4:return 25;
              break;
            case 5:return 16;
              break;
            case 6:return 20;
              break;
            case 7:return 19;
              break;
            case 8:return 19;
              break;
            case 9:return 23;
              break;
            case 10:return 22;
              break;
            case 11:this.popState(); this.begin('com');
              break;
            case 12:strip(3,5); this.popState(); return 15;
              break;
            case 13:return 22;
              break;
            case 14:return 39;
              break;
            case 15:return 38;
              break;
            case 16:return 38;
              break;
            case 17:return 42;
              break;
            case 18:/*ignore whitespace*/
              break;
            case 19:this.popState(); return 24;
              break;
            case 20:this.popState(); return 18;
              break;
            case 21:yy_.yytext = strip(1,2).replace(/\\"/g,'"'); return 32;
              break;
            case 22:yy_.yytext = strip(1,2).replace(/\\'/g,"'"); return 32;
              break;
            case 23:return 40;
              break;
            case 24:return 34;
              break;
            case 25:return 34;
              break;
            case 26:return 33;
              break;
            case 27:return 38;
              break;
            case 28:yy_.yytext = strip(1,2); return 38;
              break;
            case 29:return 'INVALID';
              break;
            case 30:return 5;
              break;
          }
        };
        lexer.rules = [/^(?:[^\x00]*?(?=(\{\{)))/,/^(?:[^\x00]+)/,/^(?:[^\x00]{2,}?(?=(\{\{|$)))/,/^(?:[\s\S]*?--\}\})/,/^(?:\{\{(~)?>)/,/^(?:\{\{(~)?#)/,/^(?:\{\{(~)?\/)/,/^(?:\{\{(~)?\^)/,/^(?:\{\{(~)?\s*else\b)/,/^(?:\{\{(~)?\{)/,/^(?:\{\{(~)?&)/,/^(?:\{\{!--)/,/^(?:\{\{![\s\S]*?\}\})/,/^(?:\{\{(~)?)/,/^(?:=)/,/^(?:\.\.)/,/^(?:\.(?=([=~}\s\/.])))/,/^(?:[\/.])/,/^(?:\s+)/,/^(?:\}(~)?\}\})/,/^(?:(~)?\}\})/,/^(?:"(\\["]|[^"])*")/,/^(?:'(\\[']|[^'])*')/,/^(?:@)/,/^(?:true(?=([~}\s])))/,/^(?:false(?=([~}\s])))/,/^(?:-?[0-9]+(?=([~}\s])))/,/^(?:([^\s!"#%-,\.\/;->@\[-\^`\{-~]+(?=([=~}\s\/.]))))/,/^(?:\[[^\]]*\])/,/^(?:.)/,/^(?:$)/];
        lexer.conditions = {"mu":{"rules":[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"inclusive":false},"emu":{"rules":[2],"inclusive":false},"com":{"rules":[3],"inclusive":false},"INITIAL":{"rules":[0,1,30],"inclusive":true}};
        return lexer;})()
      parser.lexer = lexer;
      function Parser () { this.yy = {}; }Parser.prototype = parser;parser.Parser = Parser;
      return new Parser;
    })();__exports__ = handlebars;
    return __exports__;
  })();

// handlebars/compiler/base.js
  var __module8__ = (function(__dependency1__, __dependency2__) {
    "use strict";
    var __exports__ = {};
    var parser = __dependency1__;
    var AST = __dependency2__;

    __exports__.parser = parser;

    function parse(input) {
      // Just return if an already-compile AST was passed in.
      if(input.constructor === AST.ProgramNode) { return input; }

      parser.yy = AST;
      return parser.parse(input);
    }

    __exports__.parse = parse;
    return __exports__;
  })(__module9__, __module7__);

// handlebars/compiler/javascript-compiler.js
  var __module11__ = (function(__dependency1__) {
    "use strict";
    var __exports__;
    var COMPILER_REVISION = __dependency1__.COMPILER_REVISION;
    var REVISION_CHANGES = __dependency1__.REVISION_CHANGES;
    var log = __dependency1__.log;

    function Literal(value) {
      this.value = value;
    }

    function JavaScriptCompiler() {}

    JavaScriptCompiler.prototype = {
      // PUBLIC API: You can override these methods in a subclass to provide
      // alternative compiled forms for name lookup and buffering semantics
      nameLookup: function(parent, name /* , type*/) {
        var wrap,
          ret;
        if (parent.indexOf('depth') === 0) {
          wrap = true;
        }

        if (/^[0-9]+$/.test(name)) {
          ret = parent + "[" + name + "]";
        } else if (JavaScriptCompiler.isValidJavaScriptVariableName(name)) {
          ret = parent + "." + name;
        }
        else {
          ret = parent + "['" + name + "']";
        }

        if (wrap) {
          return '(' + parent + ' && ' + ret + ')';
        } else {
          return ret;
        }
      },

      appendToBuffer: function(string) {
        if (this.environment.isSimple) {
          return "return " + string + ";";
        } else {
          return {
            appendToBuffer: true,
            content: string,
            toString: function() { return "buffer += " + string + ";"; }
          };
        }
      },

      initializeBuffer: function() {
        return this.quotedString("");
      },

      namespace: "Handlebars",
      // END PUBLIC API

      compile: function(environment, options, context, asObject) {
        this.environment = environment;
        this.options = options || {};

        log('debug', this.environment.disassemble() + "\n\n");

        this.name = this.environment.name;
        this.isChild = !!context;
        this.context = context || {
          programs: [],
          environments: [],
          aliases: { }
        };

        this.preamble();

        this.stackSlot = 0;
        this.stackVars = [];
        this.registers = { list: [] };
        this.compileStack = [];
        this.inlineStack = [];

        this.compileChildren(environment, options);

        var opcodes = environment.opcodes, opcode;

        this.i = 0;

        for(var l=opcodes.length; this.i<l; this.i++) {
          opcode = opcodes[this.i];

          if(opcode.opcode === 'DECLARE') {
            this[opcode.name] = opcode.value;
          } else {
            this[opcode.opcode].apply(this, opcode.args);
          }

          // Reset the stripNext flag if it was not set by this operation.
          if (opcode.opcode !== this.stripNext) {
            this.stripNext = false;
          }
        }

        // Flush any trailing content that might be pending.
        this.pushSource('');

        return this.createFunctionContext(asObject);
      },

      preamble: function() {
        var out = [];

        if (!this.isChild) {
          var namespace = this.namespace;

          var copies = "helpers = this.merge(helpers, " + namespace + ".helpers);";
          if (this.environment.usePartial) { copies = copies + " partials = this.merge(partials, " + namespace + ".partials);"; }
          if (this.options.data) { copies = copies + " data = data || {};"; }
          out.push(copies);
        } else {
          out.push('');
        }

        if (!this.environment.isSimple) {
          out.push(", buffer = " + this.initializeBuffer());
        } else {
          out.push("");
        }

        // track the last context pushed into place to allow skipping the
        // getContext opcode when it would be a noop
        this.lastContext = 0;
        this.source = out;
      },

      createFunctionContext: function(asObject) {
        var locals = this.stackVars.concat(this.registers.list);

        if(locals.length > 0) {
          this.source[1] = this.source[1] + ", " + locals.join(", ");
        }

        // Generate minimizer alias mappings
        if (!this.isChild) {
          for (var alias in this.context.aliases) {
            if (this.context.aliases.hasOwnProperty(alias)) {
              this.source[1] = this.source[1] + ', ' + alias + '=' + this.context.aliases[alias];
            }
          }
        }

        if (this.source[1]) {
          this.source[1] = "var " + this.source[1].substring(2) + ";";
        }

        // Merge children
        if (!this.isChild) {
          this.source[1] += '\n' + this.context.programs.join('\n') + '\n';
        }

        if (!this.environment.isSimple) {
          this.pushSource("return buffer;");
        }

        var params = this.isChild ? ["depth0", "data"] : ["Handlebars", "depth0", "helpers", "partials", "data"];

        for(var i=0, l=this.environment.depths.list.length; i<l; i++) {
          params.push("depth" + this.environment.depths.list[i]);
        }

        // Perform a second pass over the output to merge content when possible
        var source = this.mergeSource();

        if (!this.isChild) {
          var revision = COMPILER_REVISION,
            versions = REVISION_CHANGES[revision];
          source = "this.compilerInfo = ["+revision+",'"+versions+"'];\n"+source;
        }

        if (asObject) {
          params.push(source);

          return Function.apply(this, params);
        } else {
          var functionSource = 'function ' + (this.name || '') + '(' + params.join(',') + ') {\n  ' + source + '}';
          log('debug', functionSource + "\n\n");
          return functionSource;
        }
      },
      mergeSource: function() {
        // WARN: We are not handling the case where buffer is still populated as the source should
        // not have buffer append operations as their final action.
        var source = '',
          buffer;
        for (var i = 0, len = this.source.length; i < len; i++) {
          var line = this.source[i];
          if (line.appendToBuffer) {
            if (buffer) {
              buffer = buffer + '\n    + ' + line.content;
            } else {
              buffer = line.content;
            }
          } else {
            if (buffer) {
              source += 'buffer += ' + buffer + ';\n  ';
              buffer = undefined;
            }
            source += line + '\n  ';
          }
        }
        return source;
      },

      // [blockValue]
      //
      // On stack, before: hash, inverse, program, value
      // On stack, after: return value of blockHelperMissing
      //
      // The purpose of this opcode is to take a block of the form
      // `{{#foo}}...{{/foo}}`, resolve the value of `foo`, and
      // replace it on the stack with the result of properly
      // invoking blockHelperMissing.
      blockValue: function() {
        this.context.aliases.blockHelperMissing = 'helpers.blockHelperMissing';

        var params = ["depth0"];
        this.setupParams(0, params);

        this.replaceStack(function(current) {
          params.splice(1, 0, current);
          return "blockHelperMissing.call(" + params.join(", ") + ")";
        });
      },

      // [ambiguousBlockValue]
      //
      // On stack, before: hash, inverse, program, value
      // Compiler value, before: lastHelper=value of last found helper, if any
      // On stack, after, if no lastHelper: same as [blockValue]
      // On stack, after, if lastHelper: value
      ambiguousBlockValue: function() {
        this.context.aliases.blockHelperMissing = 'helpers.blockHelperMissing';

        var params = ["depth0"];
        this.setupParams(0, params);

        var current = this.topStack();
        params.splice(1, 0, current);

        // Use the options value generated from the invocation
        params[params.length-1] = 'options';

        this.pushSource("if (!" + this.lastHelper + ") { " + current + " = blockHelperMissing.call(" + params.join(", ") + "); }");
      },

      // [appendContent]
      //
      // On stack, before: ...
      // On stack, after: ...
      //
      // Appends the string value of `content` to the current buffer
      appendContent: function(content) {
        if (this.pendingContent) {
          content = this.pendingContent + content;
        }
        if (this.stripNext) {
          content = content.replace(/^\s+/, '');
        }

        this.pendingContent = content;
      },

      // [strip]
      //
      // On stack, before: ...
      // On stack, after: ...
      //
      // Removes any trailing whitespace from the prior content node and flags
      // the next operation for stripping if it is a content node.
      strip: function() {
        if (this.pendingContent) {
          this.pendingContent = this.pendingContent.replace(/\s+$/, '');
        }
        this.stripNext = 'strip';
      },

      // [append]
      //
      // On stack, before: value, ...
      // On stack, after: ...
      //
      // Coerces `value` to a String and appends it to the current buffer.
      //
      // If `value` is truthy, or 0, it is coerced into a string and appended
      // Otherwise, the empty string is appended
      append: function() {
        // Force anything that is inlined onto the stack so we don't have duplication
        // when we examine local
        this.flushInline();
        var local = this.popStack();
        this.pushSource("if(" + local + " || " + local + " === 0) { " + this.appendToBuffer(local) + " }");
        if (this.environment.isSimple) {
          this.pushSource("else { " + this.appendToBuffer("''") + " }");
        }
      },

      // [appendEscaped]
      //
      // On stack, before: value, ...
      // On stack, after: ...
      //
      // Escape `value` and append it to the buffer
      appendEscaped: function() {
        this.context.aliases.escapeExpression = 'this.escapeExpression';

        this.pushSource(this.appendToBuffer("escapeExpression(" + this.popStack() + ")"));
      },

      // [getContext]
      //
      // On stack, before: ...
      // On stack, after: ...
      // Compiler value, after: lastContext=depth
      //
      // Set the value of the `lastContext` compiler value to the depth
      getContext: function(depth) {
        if(this.lastContext !== depth) {
          this.lastContext = depth;
        }
      },

      // [lookupOnContext]
      //
      // On stack, before: ...
      // On stack, after: currentContext[name], ...
      //
      // Looks up the value of `name` on the current context and pushes
      // it onto the stack.
      lookupOnContext: function(name) {
        this.push(this.nameLookup('depth' + this.lastContext, name, 'context'));
      },

      // [pushContext]
      //
      // On stack, before: ...
      // On stack, after: currentContext, ...
      //
      // Pushes the value of the current context onto the stack.
      pushContext: function() {
        this.pushStackLiteral('depth' + this.lastContext);
      },

      // [resolvePossibleLambda]
      //
      // On stack, before: value, ...
      // On stack, after: resolved value, ...
      //
      // If the `value` is a lambda, replace it on the stack by
      // the return value of the lambda
      resolvePossibleLambda: function() {
        this.context.aliases.functionType = '"function"';

        this.replaceStack(function(current) {
          return "typeof " + current + " === functionType ? " + current + ".apply(depth0) : " + current;
        });
      },

      // [lookup]
      //
      // On stack, before: value, ...
      // On stack, after: value[name], ...
      //
      // Replace the value on the stack with the result of looking
      // up `name` on `value`
      lookup: function(name) {
        this.replaceStack(function(current) {
          return current + " == null || " + current + " === false ? " + current + " : " + this.nameLookup(current, name, 'context');
        });
      },

      // [lookupData]
      //
      // On stack, before: ...
      // On stack, after: data, ...
      //
      // Push the data lookup operator
      lookupData: function() {
        this.push('data');
      },

      // [pushStringParam]
      //
      // On stack, before: ...
      // On stack, after: string, currentContext, ...
      //
      // This opcode is designed for use in string mode, which
      // provides the string value of a parameter along with its
      // depth rather than resolving it immediately.
      pushStringParam: function(string, type) {
        this.pushStackLiteral('depth' + this.lastContext);

        this.pushString(type);

        if (typeof string === 'string') {
          this.pushString(string);
        } else {
          this.pushStackLiteral(string);
        }
      },

      emptyHash: function() {
        this.pushStackLiteral('{}');

        if (this.options.stringParams) {
          this.register('hashTypes', '{}');
          this.register('hashContexts', '{}');
        }
      },
      pushHash: function() {
        this.hash = {values: [], types: [], contexts: []};
      },
      popHash: function() {
        var hash = this.hash;
        this.hash = undefined;

        if (this.options.stringParams) {
          this.register('hashContexts', '{' + hash.contexts.join(',') + '}');
          this.register('hashTypes', '{' + hash.types.join(',') + '}');
        }
        this.push('{\n    ' + hash.values.join(',\n    ') + '\n  }');
      },

      // [pushString]
      //
      // On stack, before: ...
      // On stack, after: quotedString(string), ...
      //
      // Push a quoted version of `string` onto the stack
      pushString: function(string) {
        this.pushStackLiteral(this.quotedString(string));
      },

      // [push]
      //
      // On stack, before: ...
      // On stack, after: expr, ...
      //
      // Push an expression onto the stack
      push: function(expr) {
        this.inlineStack.push(expr);
        return expr;
      },

      // [pushLiteral]
      //
      // On stack, before: ...
      // On stack, after: value, ...
      //
      // Pushes a value onto the stack. This operation prevents
      // the compiler from creating a temporary variable to hold
      // it.
      pushLiteral: function(value) {
        this.pushStackLiteral(value);
      },

      // [pushProgram]
      //
      // On stack, before: ...
      // On stack, after: program(guid), ...
      //
      // Push a program expression onto the stack. This takes
      // a compile-time guid and converts it into a runtime-accessible
      // expression.
      pushProgram: function(guid) {
        if (guid != null) {
          this.pushStackLiteral(this.programExpression(guid));
        } else {
          this.pushStackLiteral(null);
        }
      },

      // [invokeHelper]
      //
      // On stack, before: hash, inverse, program, params..., ...
      // On stack, after: result of helper invocation
      //
      // Pops off the helper's parameters, invokes the helper,
      // and pushes the helper's return value onto the stack.
      //
      // If the helper is not found, `helperMissing` is called.
      invokeHelper: function(paramSize, name) {
        this.context.aliases.helperMissing = 'helpers.helperMissing';

        var helper = this.lastHelper = this.setupHelper(paramSize, name, true);
        var nonHelper = this.nameLookup('depth' + this.lastContext, name, 'context');

        this.push(helper.name + ' || ' + nonHelper);
        this.replaceStack(function(name) {
          return name + ' ? ' + name + '.call(' +
            helper.callParams + ") " + ": helperMissing.call(" +
            helper.helperMissingParams + ")";
        });
      },

      // [invokeKnownHelper]
      //
      // On stack, before: hash, inverse, program, params..., ...
      // On stack, after: result of helper invocation
      //
      // This operation is used when the helper is known to exist,
      // so a `helperMissing` fallback is not required.
      invokeKnownHelper: function(paramSize, name) {
        var helper = this.setupHelper(paramSize, name);
        this.push(helper.name + ".call(" + helper.callParams + ")");
      },

      // [invokeAmbiguous]
      //
      // On stack, before: hash, inverse, program, params..., ...
      // On stack, after: result of disambiguation
      //
      // This operation is used when an expression like `{{foo}}`
      // is provided, but we don't know at compile-time whether it
      // is a helper or a path.
      //
      // This operation emits more code than the other options,
      // and can be avoided by passing the `knownHelpers` and
      // `knownHelpersOnly` flags at compile-time.
      invokeAmbiguous: function(name, helperCall) {
        this.context.aliases.functionType = '"function"';

        this.pushStackLiteral('{}');    // Hash value
        var helper = this.setupHelper(0, name, helperCall);

        var helperName = this.lastHelper = this.nameLookup('helpers', name, 'helper');

        var nonHelper = this.nameLookup('depth' + this.lastContext, name, 'context');
        var nextStack = this.nextStack();

        this.pushSource('if (' + nextStack + ' = ' + helperName + ') { ' + nextStack + ' = ' + nextStack + '.call(' + helper.callParams + '); }');
        this.pushSource('else { ' + nextStack + ' = ' + nonHelper + '; ' + nextStack + ' = typeof ' + nextStack + ' === functionType ? ' + nextStack + '.call(' + helper.callParams + ') : ' + nextStack + '; }');
      },

      // [invokePartial]
      //
      // On stack, before: context, ...
      // On stack after: result of partial invocation
      //
      // This operation pops off a context, invokes a partial with that context,
      // and pushes the result of the invocation back.
      invokePartial: function(name) {
        var params = [this.nameLookup('partials', name, 'partial'), "'" + name + "'", this.popStack(), "helpers", "partials"];

        if (this.options.data) {
          params.push("data");
        }

        this.context.aliases.self = "this";
        this.push("self.invokePartial(" + params.join(", ") + ")");
      },

      // [assignToHash]
      //
      // On stack, before: value, hash, ...
      // On stack, after: hash, ...
      //
      // Pops a value and hash off the stack, assigns `hash[key] = value`
      // and pushes the hash back onto the stack.
      assignToHash: function(key) {
        var value = this.popStack(),
          context,
          type;

        if (this.options.stringParams) {
          type = this.popStack();
          context = this.popStack();
        }

        var hash = this.hash;
        if (context) {
          hash.contexts.push("'" + key + "': " + context);
        }
        if (type) {
          hash.types.push("'" + key + "': " + type);
        }
        hash.values.push("'" + key + "': (" + value + ")");
      },

      // HELPERS

      compiler: JavaScriptCompiler,

      compileChildren: function(environment, options) {
        var children = environment.children, child, compiler;

        for(var i=0, l=children.length; i<l; i++) {
          child = children[i];
          compiler = new this.compiler();

          var index = this.matchExistingProgram(child);

          if (index == null) {
            this.context.programs.push('');     // Placeholder to prevent name conflicts for nested children
            index = this.context.programs.length;
            child.index = index;
            child.name = 'program' + index;
            this.context.programs[index] = compiler.compile(child, options, this.context);
            this.context.environments[index] = child;
          } else {
            child.index = index;
            child.name = 'program' + index;
          }
        }
      },
      matchExistingProgram: function(child) {
        for (var i = 0, len = this.context.environments.length; i < len; i++) {
          var environment = this.context.environments[i];
          if (environment && environment.equals(child)) {
            return i;
          }
        }
      },

      programExpression: function(guid) {
        this.context.aliases.self = "this";

        if(guid == null) {
          return "self.noop";
        }

        var child = this.environment.children[guid],
          depths = child.depths.list, depth;

        var programParams = [child.index, child.name, "data"];

        for(var i=0, l = depths.length; i<l; i++) {
          depth = depths[i];

          if(depth === 1) { programParams.push("depth0"); }
          else { programParams.push("depth" + (depth - 1)); }
        }

        return (depths.length === 0 ? "self.program(" : "self.programWithDepth(") + programParams.join(", ") + ")";
      },

      register: function(name, val) {
        this.useRegister(name);
        this.pushSource(name + " = " + val + ";");
      },

      useRegister: function(name) {
        if(!this.registers[name]) {
          this.registers[name] = true;
          this.registers.list.push(name);
        }
      },

      pushStackLiteral: function(item) {
        return this.push(new Literal(item));
      },

      pushSource: function(source) {
        if (this.pendingContent) {
          this.source.push(this.appendToBuffer(this.quotedString(this.pendingContent)));
          this.pendingContent = undefined;
        }

        if (source) {
          this.source.push(source);
        }
      },

      pushStack: function(item) {
        this.flushInline();

        var stack = this.incrStack();
        if (item) {
          this.pushSource(stack + " = " + item + ";");
        }
        this.compileStack.push(stack);
        return stack;
      },

      replaceStack: function(callback) {
        var prefix = '',
          inline = this.isInline(),
          stack;

        // If we are currently inline then we want to merge the inline statement into the
        // replacement statement via ','
        if (inline) {
          var top = this.popStack(true);

          if (top instanceof Literal) {
            // Literals do not need to be inlined
            stack = top.value;
          } else {
            // Get or create the current stack name for use by the inline
            var name = this.stackSlot ? this.topStackName() : this.incrStack();

            prefix = '(' + this.push(name) + ' = ' + top + '),';
            stack = this.topStack();
          }
        } else {
          stack = this.topStack();
        }

        var item = callback.call(this, stack);

        if (inline) {
          if (this.inlineStack.length || this.compileStack.length) {
            this.popStack();
          }
          this.push('(' + prefix + item + ')');
        } else {
          // Prevent modification of the context depth variable. Through replaceStack
          if (!/^stack/.test(stack)) {
            stack = this.nextStack();
          }

          this.pushSource(stack + " = (" + prefix + item + ");");
        }
        return stack;
      },

      nextStack: function() {
        return this.pushStack();
      },

      incrStack: function() {
        this.stackSlot++;
        if(this.stackSlot > this.stackVars.length) { this.stackVars.push("stack" + this.stackSlot); }
        return this.topStackName();
      },
      topStackName: function() {
        return "stack" + this.stackSlot;
      },
      flushInline: function() {
        var inlineStack = this.inlineStack;
        if (inlineStack.length) {
          this.inlineStack = [];
          for (var i = 0, len = inlineStack.length; i < len; i++) {
            var entry = inlineStack[i];
            if (entry instanceof Literal) {
              this.compileStack.push(entry);
            } else {
              this.pushStack(entry);
            }
          }
        }
      },
      isInline: function() {
        return this.inlineStack.length;
      },

      popStack: function(wrapped) {
        var inline = this.isInline(),
          item = (inline ? this.inlineStack : this.compileStack).pop();

        if (!wrapped && (item instanceof Literal)) {
          return item.value;
        } else {
          if (!inline) {
            this.stackSlot--;
          }
          return item;
        }
      },

      topStack: function(wrapped) {
        var stack = (this.isInline() ? this.inlineStack : this.compileStack),
          item = stack[stack.length - 1];

        if (!wrapped && (item instanceof Literal)) {
          return item.value;
        } else {
          return item;
        }
      },

      quotedString: function(str) {
        return '"' + str
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\u2028/g, '\\u2028')   // Per Ecma-262 7.3 + 7.8.4
          .replace(/\u2029/g, '\\u2029') + '"';
      },

      setupHelper: function(paramSize, name, missingParams) {
        var params = [];
        this.setupParams(paramSize, params, missingParams);
        var foundHelper = this.nameLookup('helpers', name, 'helper');

        return {
          params: params,
          name: foundHelper,
          callParams: ["depth0"].concat(params).join(", "),
          helperMissingParams: missingParams && ["depth0", this.quotedString(name)].concat(params).join(", ")
        };
      },

      // the params and contexts arguments are passed in arrays
      // to fill in
      setupParams: function(paramSize, params, useRegister) {
        var options = [], contexts = [], types = [], param, inverse, program;

        options.push("hash:" + this.popStack());

        inverse = this.popStack();
        program = this.popStack();

        // Avoid setting fn and inverse if neither are set. This allows
        // helpers to do a check for `if (options.fn)`
        if (program || inverse) {
          if (!program) {
            this.context.aliases.self = "this";
            program = "self.noop";
          }

          if (!inverse) {
            this.context.aliases.self = "this";
            inverse = "self.noop";
          }

          options.push("inverse:" + inverse);
          options.push("fn:" + program);
        }

        for(var i=0; i<paramSize; i++) {
          param = this.popStack();
          params.push(param);

          if(this.options.stringParams) {
            types.push(this.popStack());
            contexts.push(this.popStack());
          }
        }

        if (this.options.stringParams) {
          options.push("contexts:[" + contexts.join(",") + "]");
          options.push("types:[" + types.join(",") + "]");
          options.push("hashContexts:hashContexts");
          options.push("hashTypes:hashTypes");
        }

        if(this.options.data) {
          options.push("data:data");
        }

        options = "{" + options.join(",") + "}";
        if (useRegister) {
          this.register('options', options);
          params.push('options');
        } else {
          params.push(options);
        }
        return params.join(", ");
      }
    };

    var reservedWords = (
      "break else new var" +
        " case finally return void" +
        " catch for switch while" +
        " continue function this with" +
        " default if throw" +
        " delete in try" +
        " do instanceof typeof" +
        " abstract enum int short" +
        " boolean export interface static" +
        " byte extends long super" +
        " char final native synchronized" +
        " class float package throws" +
        " const goto private transient" +
        " debugger implements protected volatile" +
        " double import public let yield"
      ).split(" ");

    var compilerWords = JavaScriptCompiler.RESERVED_WORDS = {};

    for(var i=0, l=reservedWords.length; i<l; i++) {
      compilerWords[reservedWords[i]] = true;
    }

    JavaScriptCompiler.isValidJavaScriptVariableName = function(name) {
      if(!JavaScriptCompiler.RESERVED_WORDS[name] && /^[a-zA-Z_$][0-9a-zA-Z_$]+$/.test(name)) {
        return true;
      }
      return false;
    };

    __exports__ = JavaScriptCompiler;
    return __exports__;
  })(__module2__);

// handlebars/compiler/compiler.js
  var __module10__ = (function(__dependency1__, __dependency2__, __dependency3__, __dependency4__) {
    "use strict";
    var __exports__ = {};
    var Exception = __dependency1__;
    var parse = __dependency2__.parse;
    var JavaScriptCompiler = __dependency3__;
    var AST = __dependency4__;

    function Compiler() {}

    __exports__.Compiler = Compiler;// the foundHelper register will disambiguate helper lookup from finding a
    // function in a context. This is necessary for mustache compatibility, which
    // requires that context functions in blocks are evaluated by blockHelperMissing,
    // and then proceed as if the resulting value was provided to blockHelperMissing.

    Compiler.prototype = {
      compiler: Compiler,

      disassemble: function() {
        var opcodes = this.opcodes, opcode, out = [], params, param;

        for (var i=0, l=opcodes.length; i<l; i++) {
          opcode = opcodes[i];

          if (opcode.opcode === 'DECLARE') {
            out.push("DECLARE " + opcode.name + "=" + opcode.value);
          } else {
            params = [];
            for (var j=0; j<opcode.args.length; j++) {
              param = opcode.args[j];
              if (typeof param === "string") {
                param = "\"" + param.replace("\n", "\\n") + "\"";
              }
              params.push(param);
            }
            out.push(opcode.opcode + " " + params.join(" "));
          }
        }

        return out.join("\n");
      },

      equals: function(other) {
        var len = this.opcodes.length;
        if (other.opcodes.length !== len) {
          return false;
        }

        for (var i = 0; i < len; i++) {
          var opcode = this.opcodes[i],
            otherOpcode = other.opcodes[i];
          if (opcode.opcode !== otherOpcode.opcode || opcode.args.length !== otherOpcode.args.length) {
            return false;
          }
          for (var j = 0; j < opcode.args.length; j++) {
            if (opcode.args[j] !== otherOpcode.args[j]) {
              return false;
            }
          }
        }

        len = this.children.length;
        if (other.children.length !== len) {
          return false;
        }
        for (i = 0; i < len; i++) {
          if (!this.children[i].equals(other.children[i])) {
            return false;
          }
        }

        return true;
      },

      guid: 0,

      compile: function(program, options) {
        this.opcodes = [];
        this.children = [];
        this.depths = {list: []};
        this.options = options;

        // These changes will propagate to the other compiler components
        var knownHelpers = this.options.knownHelpers;
        this.options.knownHelpers = {
          'helperMissing': true,
          'blockHelperMissing': true,
          'each': true,
          'if': true,
          'unless': true,
          'with': true,
          'log': true
        };
        if (knownHelpers) {
          for (var name in knownHelpers) {
            this.options.knownHelpers[name] = knownHelpers[name];
          }
        }

        return this.accept(program);
      },

      accept: function(node) {
        var strip = node.strip || {},
          ret;
        if (strip.left) {
          this.opcode('strip');
        }

        ret = this[node.type](node);

        if (strip.right) {
          this.opcode('strip');
        }

        return ret;
      },

      program: function(program) {
        var statements = program.statements;

        for(var i=0, l=statements.length; i<l; i++) {
          this.accept(statements[i]);
        }
        this.isSimple = l === 1;

        this.depths.list = this.depths.list.sort(function(a, b) {
          return a - b;
        });

        return this;
      },

      compileProgram: function(program) {
        var result = new this.compiler().compile(program, this.options);
        var guid = this.guid++, depth;

        this.usePartial = this.usePartial || result.usePartial;

        this.children[guid] = result;

        for(var i=0, l=result.depths.list.length; i<l; i++) {
          depth = result.depths.list[i];

          if(depth < 2) { continue; }
          else { this.addDepth(depth - 1); }
        }

        return guid;
      },

      block: function(block) {
        var mustache = block.mustache,
          program = block.program,
          inverse = block.inverse;

        if (program) {
          program = this.compileProgram(program);
        }

        if (inverse) {
          inverse = this.compileProgram(inverse);
        }

        var type = this.classifyMustache(mustache);

        if (type === "helper") {
          this.helperMustache(mustache, program, inverse);
        } else if (type === "simple") {
          this.simpleMustache(mustache);

          // now that the simple mustache is resolved, we need to
          // evaluate it by executing `blockHelperMissing`
          this.opcode('pushProgram', program);
          this.opcode('pushProgram', inverse);
          this.opcode('emptyHash');
          this.opcode('blockValue');
        } else {
          this.ambiguousMustache(mustache, program, inverse);

          // now that the simple mustache is resolved, we need to
          // evaluate it by executing `blockHelperMissing`
          this.opcode('pushProgram', program);
          this.opcode('pushProgram', inverse);
          this.opcode('emptyHash');
          this.opcode('ambiguousBlockValue');
        }

        this.opcode('append');
      },

      hash: function(hash) {
        var pairs = hash.pairs, pair, val;

        this.opcode('pushHash');

        for(var i=0, l=pairs.length; i<l; i++) {
          pair = pairs[i];
          val  = pair[1];

          if (this.options.stringParams) {
            if(val.depth) {
              this.addDepth(val.depth);
            }
            this.opcode('getContext', val.depth || 0);
            this.opcode('pushStringParam', val.stringModeValue, val.type);
          } else {
            this.accept(val);
          }

          this.opcode('assignToHash', pair[0]);
        }
        this.opcode('popHash');
      },

      partial: function(partial) {
        var partialName = partial.partialName;
        this.usePartial = true;

        if(partial.context) {
          this.ID(partial.context);
        } else {
          this.opcode('push', 'depth0');
        }

        this.opcode('invokePartial', partialName.name);
        this.opcode('append');
      },

      content: function(content) {
        this.opcode('appendContent', content.string);
      },

      mustache: function(mustache) {
        var options = this.options;
        var type = this.classifyMustache(mustache);

        if (type === "simple") {
          this.simpleMustache(mustache);
        } else if (type === "helper") {
          this.helperMustache(mustache);
        } else {
          this.ambiguousMustache(mustache);
        }

        if(mustache.escaped && !options.noEscape) {
          this.opcode('appendEscaped');
        } else {
          this.opcode('append');
        }
      },

      ambiguousMustache: function(mustache, program, inverse) {
        var id = mustache.id,
          name = id.parts[0],
          isBlock = program != null || inverse != null;

        this.opcode('getContext', id.depth);

        this.opcode('pushProgram', program);
        this.opcode('pushProgram', inverse);

        this.opcode('invokeAmbiguous', name, isBlock);
      },

      simpleMustache: function(mustache) {
        var id = mustache.id;

        if (id.type === 'DATA') {
          this.DATA(id);
        } else if (id.parts.length) {
          this.ID(id);
        } else {
          // Simplified ID for `this`
          this.addDepth(id.depth);
          this.opcode('getContext', id.depth);
          this.opcode('pushContext');
        }

        this.opcode('resolvePossibleLambda');
      },

      helperMustache: function(mustache, program, inverse) {
        var params = this.setupFullMustacheParams(mustache, program, inverse),
          name = mustache.id.parts[0];

        if (this.options.knownHelpers[name]) {
          this.opcode('invokeKnownHelper', params.length, name);
        } else if (this.options.knownHelpersOnly) {
          throw new Error("You specified knownHelpersOnly, but used the unknown helper " + name);
        } else {
          this.opcode('invokeHelper', params.length, name);
        }
      },

      ID: function(id) {
        this.addDepth(id.depth);
        this.opcode('getContext', id.depth);

        var name = id.parts[0];
        if (!name) {
          this.opcode('pushContext');
        } else {
          this.opcode('lookupOnContext', id.parts[0]);
        }

        for(var i=1, l=id.parts.length; i<l; i++) {
          this.opcode('lookup', id.parts[i]);
        }
      },

      DATA: function(data) {
        this.options.data = true;
        if (data.id.isScoped || data.id.depth) {
          throw new Exception('Scoped data references are not supported: ' + data.original);
        }

        this.opcode('lookupData');
        var parts = data.id.parts;
        for(var i=0, l=parts.length; i<l; i++) {
          this.opcode('lookup', parts[i]);
        }
      },

      STRING: function(string) {
        this.opcode('pushString', string.string);
      },

      INTEGER: function(integer) {
        this.opcode('pushLiteral', integer.integer);
      },

      BOOLEAN: function(bool) {
        this.opcode('pushLiteral', bool.bool);
      },

      comment: function() {},

      // HELPERS
      opcode: function(name) {
        this.opcodes.push({ opcode: name, args: [].slice.call(arguments, 1) });
      },

      declare: function(name, value) {
        this.opcodes.push({ opcode: 'DECLARE', name: name, value: value });
      },

      addDepth: function(depth) {
        if(isNaN(depth)) { throw new Error("EWOT"); }
        if(depth === 0) { return; }

        if(!this.depths[depth]) {
          this.depths[depth] = true;
          this.depths.list.push(depth);
        }
      },

      classifyMustache: function(mustache) {
        var isHelper   = mustache.isHelper;
        var isEligible = mustache.eligibleHelper;
        var options    = this.options;

        // if ambiguous, we can possibly resolve the ambiguity now
        if (isEligible && !isHelper) {
          var name = mustache.id.parts[0];

          if (options.knownHelpers[name]) {
            isHelper = true;
          } else if (options.knownHelpersOnly) {
            isEligible = false;
          }
        }

        if (isHelper) { return "helper"; }
        else if (isEligible) { return "ambiguous"; }
        else { return "simple"; }
      },

      pushParams: function(params) {
        var i = params.length, param;

        while(i--) {
          param = params[i];

          if(this.options.stringParams) {
            if(param.depth) {
              this.addDepth(param.depth);
            }

            this.opcode('getContext', param.depth || 0);
            this.opcode('pushStringParam', param.stringModeValue, param.type);
          } else {
            this[param.type](param);
          }
        }
      },

      setupMustacheParams: function(mustache) {
        var params = mustache.params;
        this.pushParams(params);

        if(mustache.hash) {
          this.hash(mustache.hash);
        } else {
          this.opcode('emptyHash');
        }

        return params;
      },

      // this will replace setupMustacheParams when we're done
      setupFullMustacheParams: function(mustache, program, inverse) {
        var params = mustache.params;
        this.pushParams(params);

        this.opcode('pushProgram', program);
        this.opcode('pushProgram', inverse);

        if(mustache.hash) {
          this.hash(mustache.hash);
        } else {
          this.opcode('emptyHash');
        }

        return params;
      }
    };

    function precompile(input, options) {
      if (input == null || (typeof input !== 'string' && input.constructor !== AST.ProgramNode)) {
        throw new Exception("You must pass a string or Handlebars AST to Handlebars.precompile. You passed " + input);
      }

      options = options || {};
      if (!('data' in options)) {
        options.data = true;
      }

      var ast = parse(input);
      var environment = new Compiler().compile(ast, options);
      return new JavaScriptCompiler().compile(environment, options);
    }

    __exports__.precompile = precompile;function compile(input, options, env) {
      if (input == null || (typeof input !== 'string' && input.constructor !== AST.ProgramNode)) {
        throw new Exception("You must pass a string or Handlebars AST to Handlebars.compile. You passed " + input);
      }

      options = options || {};

      if (!('data' in options)) {
        options.data = true;
      }

      var compiled;

      function compileInput() {
        var ast = parse(input);
        var environment = new Compiler().compile(ast, options);
        var templateSpec = new JavaScriptCompiler().compile(environment, options, undefined, true);
        return env.template(templateSpec);
      }

      // Template is only compiled on first use and cached after that point.
      return function(context, options) {
        if (!compiled) {
          compiled = compileInput();
        }
        return compiled.call(this, context, options);
      };
    }

    __exports__.compile = compile;
    return __exports__;
  })(__module5__, __module8__, __module11__, __module7__);

// handlebars.js
  var __module0__ = (function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __dependency5__) {
    "use strict";
    var __exports__;
    var Handlebars = __dependency1__;

    // Compiler imports
    var AST = __dependency2__;
    var Parser = __dependency3__.parser;
    var parse = __dependency3__.parse;
    var Compiler = __dependency4__.Compiler;
    var compile = __dependency4__.compile;
    var precompile = __dependency4__.precompile;
    var JavaScriptCompiler = __dependency5__;

    var _create = Handlebars.create;
    var create = function() {
      var hb = _create();

      hb.compile = function(input, options) {
        return compile(input, options, hb);
      };
      hb.precompile = precompile;

      hb.AST = AST;
      hb.Compiler = Compiler;
      hb.JavaScriptCompiler = JavaScriptCompiler;
      hb.Parser = Parser;
      hb.parse = parse;

      return hb;
    };

    Handlebars = create();
    Handlebars.create = create;

    __exports__ = Handlebars;
    return __exports__;
  })(__module1__, __module7__, __module8__, __module10__, __module11__);

  return __module0__;
});


(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define('lib/metric_scorer', ['vendor/underscore'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('underscore'));
  } else {
    root.MetricScorer = factory(root._);
  }
}(this, function (_, localize) {
  var
    thresholds = {},
    statuses = ['danger', 'warning', 'info', 'success'],
    invertedStatuses = ['success', 'info', 'warning', 'danger'],
    statusFunctions = {
      linear: function linear (val, passwordLength, config) {
        var
          status = config.invert ? invertedStatuses : statuses,
          i;

        for (i = 0; i < config.thresholds; i += 1) {
          if (val < config.thresholds[i]) {
            return status[i];
          }
        }

        return status[3];
      },
      percent: function percent (val, passwordLength, config) {
        val /= passwordLength;
        var
          status = config.invert ? invertedStatuses : statuses,
          i = 0, j;

        if (config.min) {
          if (val < config.min) {
            return status[0];
          }
          i = 1;
        }

        for (j = 0; i < config.thresholds; j += 1, i += 1) {
          if (val < config.thresholds[j]) {
            return status[i];
          }
        }

        return status[3];
      },
      choose: function choose (val, passwordLength, config) {
        var status = config.invert ? invertedStatuses : statuses;

        return (config.values || status)[val];
      },
      poison: function poison (val, passwordLength, config) {
        var status = config.invert ? invertedStatuses : statuses;

        if (val < config.thresholds[0]) {
          return status[0];
        } else if (val < config.thresholds[1]) {
          return status[1];
        } else if (val < passwordLength * config.maxOfLength) {
          return status[2];
        }

        return status[3];
      },
      boolean: function bolean (val, passwordLength, config) {
        var status = config.invert ? invertedStatuses : statuses;

        if (val) {
          return status[0];
        }

        return status[4];
      }
    },
    scoreFunctions = {
      linear: function linear (val, passwordLength, config) {
        val = Math.min(1, Math.floor(val / config.divisor));
        return config.invert ? (1 - val) : val;
      },
      percent: function percent (val, passwordLength, config) {
        val = val / passwordLength;
        return config.invert ? (1 - val) : val;
      },
      boolean: function bolean (val, passwordLength, config) {
        val = val ? 0 : 1;
        return config.invert ? (1 - val) : val;
      }
    };

  function scoreMetrics (analysis) {
    return _.compact(_.map(analysis, function (value, key) {
      var fieldThresholds = thresholds[key];
      if (!fieldThresholds) {
        return null;
      }
      return {
        key: key,
        value: Math.floor(value),
        status: statusFunctions[fieldThresholds.status.type](value, analysis.password_length, fieldThresholds.status),
        score:  scoreFunctions[fieldThresholds.score.type](value, analysis.password_length, fieldThresholds.score)
      };
    }));
  }

  function init (config) {
    thresholds = config.metricThresholds;
  }

  return {
    init: init,
    score: scoreMetrics
  };
}));

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define('lib/non_entropic_factors', ['vendor/underscore'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('underscore'));
  } else {
    root.NonEntropicFactors = factory(root._);
  }
}(this, function (_) {

  var
    thresholds = {},
    siteSettings = {};

  function score (val, length, thresholds) {
    var
      min = thresholds.minimumValue || (thresholds.minimumPercent ? (length * thresholds.minimumPercent) : 0),
      divisor = thresholds.divisor  || (thresholds.divisorPercent ? (length * thresholds.divisorPercent) : 1),
      weight = thresholds.weight;

    if (val >= min) {
      return (1.0 - weight) + (weight * (1 - (val / divisor)));
    } else {
      return 1.0;
    }
  }

  function scoreSite (site) {
    var algorithm = _.find(siteSettings.cryptographic_hash_functions, function (h) {
      return h.key === site.algorithm;
    }) || _.find(siteSettings.key_derivation_functions, function (h) {
      return h.key === site.algorithm;
    });

    return (algorithm.estimated_strength / siteSettings.baseline_strength) *
           (site.system_salt ? siteSettings.system_salt_bonus : 1.0) *
           (site.user_salt ? siteSettings.user_salt_bonus : 1.0);
  }

  function scoreNonEntropicFactors (analysis) {
    return _.reduce(_.keys(analysis), function (result, field) {
      var fieldThresholds = thresholds[field];
      if (!fieldThresholds) {
        return result;
      }
      return result * score(analysis[field], analysis.password_length, fieldThresholds);
    }, 1.0);
  }

  function init (config) {
    // TODO: add hashing method and salt to non_entropic_factor_thresholds

    thresholds = config.nonEntropicFactorThresholds;
    siteSettings = config.hashingAlgorithms;
  }

  return {
    init: init,
    score: scoreNonEntropicFactors,
    scoreSite: scoreSite
  };
}));

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define('lib/keyboard', ['vendor/underscore'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('underscore'));
  } else {
    root.Keyboard = factory(root._);
  }
}(this, function (_) {
  function Keyboard (map) {
    this._map = map;
  }

  _.extend(Keyboard.prototype, {

    getKeyAt: function getKeyAt(x, y, shift) {
      if (this._map[y] && this._map[y][x]) {
        return this._map[y][x][shift];
      }
      return null;
    },

    getNeighbors: function getNeighbors (letter) {
      var
        self = this,
        result = {
          distance: []
        };

      _.each(self._map, function (row, y) {
        _.each(row, function (cell, x) {
          if (_.contains(cell, letter)) {
            var
              shift    = cell[0] === letter ? 0 : 1,
              altShift = cell[0] === letter ? 1 : 0;

            result.distance[0] = [letter];

            result.distance[1] = [
              cell[altShift],
              self.getKeyAt(x, y - 1, shift),
              self.getKeyAt(x, y + 1, shift),
              self.getKeyAt(x - 1, y, shift),
              self.getKeyAt(x + 1, y, shift)
            ];

            result.distance[2] = [
              self.getKeyAt(x, y - 1, altShift),
              self.getKeyAt(x, y + 1, altShift),
              self.getKeyAt(x - 1, y, altShift),
              self.getKeyAt(x + 1, y, altShift),
              self.getKeyAt(x - 1, y - 1, shift),
              self.getKeyAt(x - 1, y + 1, shift),
              self.getKeyAt(x + 1, y - 1, shift),
              self.getKeyAt(x + 1, y + 1, shift)
            ];

            result.distance[3] = [
              self.getKeyAt(x - 1, y - 1, altShift),
              self.getKeyAt(x - 1, y + 1, altShift),
              self.getKeyAt(x + 1, y - 1, altShift),
              self.getKeyAt(x + 1, y + 1, altShift)
            ];
          }
        });
      });

      return result;
    },

    proximity: function proximity (password) {
      var i, result = 0;

      function eachKey (keys, i) {
        if (_.contains(keys, nextLetter)) {
          result += 4 - i;
        }
      }

      for (i = 0; i < password.length - 1; i += 1) {
        var
          neighbors = this.getNeighbors((password[i])),
          nextLetter = password[i + 1];

        _.each(neighbors.distance, eachKey);
      }

      return result;
    }
  });

  return Keyboard;
}));

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define('lib/keyboard_mutator', ['vendor/underscore'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('underscore'));
  } else {
    root.KeyboardMutator = factory(root._);
  }
}(this, function (_) {

  function KeyboardMutator (keyboard) {
    this.keyboard = keyboard;
  }

  _.extend(KeyboardMutator.prototype, {
    mutate: function mutate (dictionary) {
      var result = { distance: [] }, self = this;
      _.each(dictionary.distance, function (words, dist) {
        _.each(words, function (word) {
          var
            raw = _.map(word, function (letter) {
              return self.keyboard.getNeighbors(letter);
            }),
            distances = [
              [
                _.map(raw, function (a) { return a.distance[1][1]; }),
                _.map(raw, function (a) { return a.distance[1][2]; }),
                _.map(raw, function (a) { return a.distance[1][3]; }),
                _.map(raw, function (a) { return a.distance[1][4]; })
              ],
              [
                _.map(raw, function (a) { return a.distance[2][4]; }),
                _.map(raw, function (a) { return a.distance[2][5]; }),
                _.map(raw, function (a) { return a.distance[2][6]; }),
                _.map(raw, function (a) { return a.distance[2][7]; })
              ]
            ];

          _.each(distances, function (candidates, i) {
            if (!result.distance[dist + i + 1]) {
              result.distance[dist + i + 1] = [];
            }
            result.distance[dist + i + 1] =  result.distance[dist + i + 1].concat(_.map(_.reject(candidates, function (w) {
              return _.contains(w, null);
            }), function (w) {
              return w.join('');
            }));
          });
        });
      });
      return result;
    }
  });

  return KeyboardMutator;
}));

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define('lib/leet_mutator', ['vendor/underscore'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('underscore'));
  } else {
    root.LeetMutator = factory(root._);
  }
}(this, function (_) {

  function LeetMutator (substitutions) {
    this.substitutions = substitutions;
  }

  _.extend(LeetMutator.prototype, {
    mutate: function mutate (dictionary) {
      var result = { distance: [] }, self = this;
      _.each(dictionary.distance, function (words, dist) {
        result.distance[dist + 1] = _.flatten(_.map(words, function (word) {
          return _.reject(
            _.reduce(_.map(word, function (letter) {
              return _.compact(_.flatten([letter, self.substitutions[letter.toLowerCase()]]));
            }), function (results, letters) {
              return _.flatten(_.map(results, function (r) {
                return _.flatten(_.map(letters, function (l) {
                  return r + l;
                }));
              }));
            }, ['']), function (word2) {
              return word === word2;
            });
        }));
      });
      return result;
    }
  });

  return LeetMutator;
}));

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define('lib/dictionary', ['vendor/underscore'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('underscore'));
  } else {
    root.Dictionary = factory(root._);
  }
}(this, function (_) {
  function Dictionary (dict) {
    this.mutators = [];
    if (dict instanceof Array) {
      this.distance = _.clone([dict]);
    } else {
      this.distance = _.map(dict.distance, _.clone);
    }
  }

  _.extend(Dictionary.prototype, {
    getHits: function getHits (password) {
      return _.map(this.distance, function (words) {
        return _.uniq(_.filter(words, function (word) {
          return password.indexOf(word) !== -1;
        }));
      });
    },

    getNumHits: function getNumHits (password) {
      return _.reduce(this.getHits(password), function (sum, words) { return sum + words.length; }, 0);
    },

    getLength: function getLength () {
      return _.reduce(this.distance, function (sum, words) { return sum + words.length; }, 0);
    },

    addMutator: function addMutator (mutator) {
      this.mutators.push(mutator);
    },

    mutate: function mutate (depth) {
      var mutations = [[{ mutationsPerformed: [], result: this }]], i;

      function mutateEachDepth (mutator) {
        mutations[i] = mutations[i].concat(
          _.map(_.reject(mutations[i - 1], function (mutation) {
            return _.contains(mutation.mutationsPerformed, mutator);
          }), function (mutation) {
            var tmp = mutator.mutate(mutation.result);
            return {
              mutationsPerformed: _.flatten([mutation.mutationsPerformed, mutator]),
              result: tmp
            };
          })
        );
      }

      for (i = 1; i <= depth; i += 1) {
        mutations[i] = [];
        _.each(this.mutators, mutateEachDepth);
      }

      return merge(_.flatten(_.map(mutations, function (d) { return _.pluck(d, 'result'); })));
    },

    toJSON: function toJSON () {
      return {
        distance: this.distance
      };
    }
  });

  function merge (dictionaries) {
    var result = { distance: [] };

    _.each(dictionaries, function (dict, i) {
      _.each(dict.distance, function (words, dist) {
        if (!result.distance[dist]) {
          result.distance[dist] = [];
        }
        result.distance[dist] = result.distance[dist].concat(words);
      });
    });

    return new Dictionary(result);
  }

  return Dictionary;
}));

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define('lib/analysis', ['vendor/underscore', 'lib/keyboard', 'lib/dictionary'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('underscore'), require('./keyboard'), require('./dictionary'));
  } else {
    root.Analyzer = factory(root._, root.Keyboard, root.Dictionary);
  }
}(this, function (_, Keyboard, Dictionary) {

  var keyboard, dictionary;

  function init (config) {
    keyboard = new Keyboard(config.keyboard);
    dictionary = new Dictionary(config.dictionary);
  }

  function analyze (password) {
    var
      numUppercase = (password.match(/[A-Z]/g) || []).length,
      numLowercase = (password.match(/[a-z]/g) || []).length,
      numNumerals  = (password.match(/\d/g)    || []).length,
      numSymbols   = (password.match(/[\W_]/g) || []).length;

    return {
      password_length:               password.length,
      num_uppercase:                 numUppercase,
      num_lowercase:                 numLowercase,
      num_numerals:                  numNumerals,
      num_symbols:                   numSymbols,
      num_classes:                   (numUppercase ? 1 : 0) + (numLowercase ? 1 : 0) + (numNumerals ? 1 : 0) + (numSymbols ? 1 : 0),
      num_words:                     (password.match(/[a-z]{2,}/gi) || []).length,
      num_numbers:                   (password.match(/\d{2,}/g) || []).length,
      num_years:                     (password.match(/(?:19|20)\d{2}/g) || []).length,
      letters_only:                !!(password.match(/^[a-zA-Z]+$/)),
      numerals_only:               !!(password.match(/^\d+$/)),
      symbols_only:                !!(password.match(/^[\W_]+$/)),
      repeat_characters:             (password.match(/([a-z])(?=[^\1]*\1)/g) || []).length,
      repeat_characters_insensitive: (password.match(/([a-z])(?=[^\1]*\1)/gi) || []).length,
      repeat_numerals:               (password.match(/(\d)(?=[^\1]*\1)/g) || []).length,
      repeat_symbols:                (password.match(/([\W_])(?=[^\1]*\1)/g) || []).length,
      consecutive_uppercase:         consecutive(password, /[A-Z]{2,}/g),
      consecutive_lowercase:         consecutive(password, /[a-z]{2,}/g),
      consecutive_numerals:          consecutive(password, /\d{2,}/g),
      consecutive_symbols:           consecutive(password, /[\W_]{2,}/g),
      sequential_numerals:           sequential(password,  /\d{2,}/g),
      sequential_characters:         sequential(password,  /[a-zA-Z]{2,}/g),
      keyboard_proximity:            keyboard.proximity(password),
      dictionary_hits:               dictionary.getHits(password),
      dictionary_hit_count:          dictionary.getNumHits(password),
      entropy:                       entropy(password, !!numUppercase, !!numLowercase, !!numNumerals, !!numSymbols)
      // TODO: unicode? (e.g. 'ä' vs '$' and 'a' -> 'ä')
      // TODO: war list (e.g. ask some questions, what's your name? when were you born?, etc
    };
  }

  function consecutive (password, regex) {
    return _.reduce(password.match(regex) || [], function (sum, match) {
      return sum + match.length;
    }, 0);
  }

  function sequential (password, regex) {
    return _.reduce(password.match(regex) || [], function (sum, match) {
      var count = 0;
      _.each(match, function (letter, i) {
        if (1 === Math.abs(match.charCodeAt(i) - match.charCodeAt(i + 1))) {
          count += 1;
        }
      });
      return count;
    }, 0);
  }

  function entropy (password, hasUppercase, hasLowercase, hasNumerals, hasSymbols) {
    var possible_symbols = 0;
    if (hasUppercase) {
      possible_symbols += 26;
    }
    if (hasLowercase) {
      possible_symbols += 26;
    }
    if (hasNumerals) {
      possible_symbols += 10;
    }
    if (hasSymbols) {
      possible_symbols += 33; // ascii (basic) printable characters that do not match \d.
    }
    return password.length * (Math.log(possible_symbols) / Math.log(2));
  }

  return {
    init: init,
    analyze: analyze
  };
}));

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define('lib/localize', [], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory();
  } else {
    root.Localizer = factory();
  }
}(this, function () {

  var lookupTable = {};

  function init (config) {
    lookupTable = config.localizationTable;
  }

  function localize (key) {
    return lookupTable[key] || ('???' + key + '???');
  }

  function hasKey (key) {
    return !!lookupTable[key];
  }

  return {
    init: init,
    localize: localize,
    hasKey: hasKey
  };
}));

define('crack_time_reporter',

[
  'vendor/jquery',
  'vendor/underscore',
  'vendor/handlebars',
  'vendor/moment',
  'lib/localize',
  'lib/non_entropic_factors'
],

function ($, _, Handlebars, moment, localize, nonEntropicFactors) {
  var
    container = $('.time-required'),
    template = Handlebars.compile('<li class="list-group-item">{{{text}}}</li>'),
    agencies = [];

  function render (analysis, site) {
    var fudgedEntropy = analysis.entropy * nonEntropicFactors.score(analysis);
    container.empty().append(_.map(agencies, function (agency) {
      var secondsRequired = Math.pow(2, fudgedEntropy - agency.computationalStrength) * nonEntropicFactors.scoreSite(site);
      return template({
        text: agency.template({
          duration: moment.duration(secondsRequired, 'seconds').humanize()
        })
      });
    }).join(''));
  }

  function init (config) {
    nonEntropicFactors.init(config);
    agencies = _.map(config.agencies, function (agency) {
      agency.template = Handlebars.compile(localize.localize('crack_time_template_' + agency.key));
      return agency;
    });
  }

  return {
    init: init,
    render: render
  };
});

define('metrics_reporter',

[
  'vendor/jquery',
  'vendor/underscore',
  'vendor/handlebars',
  'lib/localize',
  'lib/metric_scorer'
],

function ($, _, Handlebars, localize, metricScorer) {
  var
    container = $('.metrics'),
    template = Handlebars.compile('' +
      '<li class="list-group-item metric alert alert-{{status}}">{{{label}}}{{#if hasTooltip}} <span class="glyphicon glyphicon-info-sign"></span>{{/if}}<span class="badge">{{#if boolean}}{{#if value}}x{{else}}&#x2713{{/if}}{{else}}{{value}}{{/if}}</span></li>'
    );

  function render (analysis) {
    container.empty();
    _.each(metricScorer.score(analysis), function (obj) {
      obj.label = localize.localize('metric_label_' + obj.key);
      obj.hasTooltip = localize.hasKey('metric_tooltip_' + obj.key);

      var el = $(template(obj));
      el.appendTo(container);

      if (obj.tooltipMessage) {
        el.find('.glyphicon').popover({
          animation: true,
            placement: 'right',
            trigger: 'hover',
            //title: 'testing',
            content: localize.localize('metric_tooltip_' + obj.key),
            container: 'body'
        });
      }
    });
  }

  function init (config) {
    metricScorer.init(config);
  }

  return {
    init: init,
    render: render
  };
});

define('app',

[
  'vendor/jquery',
  'vendor/underscore',
  'lib/analysis',
  'metrics_reporter',
  'crack_time_reporter',
  'lib/localize'
],

function ($, _, analysis, metricsReporter, crackTimeReporter, localize) {
  function run (password, site) {
    var
      results = analysis.analyze(password),
      cleanedResults = _.clone(results);

    delete cleanedResults.dictionary_hits;
    $.get('/submit_results', cleanedResults);

    metricsReporter.render(results);
    crackTimeReporter.render(results, site);

    $('.results').removeClass('hide');
  }

  function getPassword() {
    return $('.gauge-form input[name=password]').val();
  }

  function getSite(config) {
    var
      siteKey = $('.gauge-form select[name=site]').val(),
      hashKey = $('.gauge-form select[name=hash]').val(),
      site = {
        algorithm: 'sha-256',
        system_salt: true,
        user_salt: false
      };

    if (siteKey) {
      console.log('SITEKEY', siteKey);
      site = _.find(config.hashingAlgorithms.known_sites, function (s) {
        return s.key === siteKey;
      });
    } else if (hashKey) {
      console.log('HASHKEY', hashKey);
      site.algorithm = hashKey;
    }

    return site;
  }

  function init (config) {
    localize.init(config);
    analysis.init(config);
    metricsReporter.init(config);
    crackTimeReporter.init(config);

    $('.gauge-form').on('submit', function (ev) {
      ev.preventDefault();
      run(getPassword(), getSite(config));
    });

    $('#evaluate').on('click', function (ev) {
      ev.preventDefault();
      run(getPassword(), getSite(config));
    });
  }

  return {
    init: init
  };
});