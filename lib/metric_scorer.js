(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define('lib/metric_scorer', ['vendor/underscore'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('underscore'));
  } else {
    root.metricScorer = factory(root._);
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
        val = Math.min(1, Math.floor(val / config.divisor))
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