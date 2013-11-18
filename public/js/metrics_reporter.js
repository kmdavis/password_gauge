define(['jquery', 'underscore', 'handlebars'], function ($, _, Handlebars) {
  var
    container = $('.metrics'),
    template = Handlebars.compile('<li class="list-group-item metric alert alert-{{status}}" title="{{score}}%">{{label}}<span class="badge">{{value}}</span></li>');

  function titleCase (key) {
    return _.map(key.split(/_/g), function (word) { return word[0].toUpperCase() + word.slice(1); }).join(' ');
  }

  function naiveScoreNumInClass (key, value, label, passwordLength, min, thresholds) {
    var percent = value / passwordLength;
    return {
      key: key,
      label: label,
      value: value,
      status: (function () {
        if (value < min) {
          return 'danger';
        } else if (percent < thresholds[0]) {
          return 'warning';
        } else if (percent > thresholds[1]) {
          return 'success';
        } else {
          return 'info';
        }
      }()),
      score: percent
    };
  }

  function naiveScoring (analysis) {
    return _.map(analysis, function (value, key) {
      switch(key) {
      case 'password_length':
        return {
          key: key,
          label: titleCase(key),
          value: value,
          status: (function () {
            if (value < 8) {
              return 'danger';
            } else if (value < 15) {
              return 'warning';
            } else if (value > 32) { // arbitrary -- other 2 are based on windows NT passwords: http://www.thebitmill.com/articles/nt_password.html
              return 'success';
            } else {
              return 'info';
            }
          }()),
          score: Math.max(1, value / 64) // also arbitrary
        };
      case 'num_uppercase':
        return naiveScoreNumInClass(key, value, 'Number of Uppercase Characters', analysis.password_length, 1, [0.1, 0.25]); // thresholds and mins are arbitrary
      case 'num_lowercase':
        return naiveScoreNumInClass(key, value, 'Number of Lowercase Characters', analysis.password_length, 1, [0.1, 0.25]);
      case 'num_numerals':
        return naiveScoreNumInClass(key, value, 'Number of Numeric Digits',       analysis.password_length, 1, [0.075, 0.2]);
      case 'num_symbols':
        return naiveScoreNumInClass(key, value, 'Number of Symbols',              analysis.password_length, 1, [0.15, 0.3]);
      default:
        return {
          key: key,
          label: titleCase(key),
          value: 0,
          status: null,
          score: 0
        }
      }
    });
  }

  function render (analysis) {
    container.empty().append(_.map(naiveScoring(analysis), template).join(''));
  }

  return {
    render: render
  };
});