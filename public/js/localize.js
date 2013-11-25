(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory();
  } else {
    root.localize = factory();
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