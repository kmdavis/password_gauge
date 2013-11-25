(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['underscore'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('underscore'));
  } else {
    root.nonEntropicFactors = factory(root._);
  }
}(this, function (_) {

  var thresholds = {};

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
  }

  return {
    init: init,
    score: scoreNonEntropicFactors
  };
}));