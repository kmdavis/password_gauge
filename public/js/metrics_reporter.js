define(['jquery', 'underscore', 'handlebars'], function ($, _, Handlebars) {
  var
    container = $('.metrics'),
    template = Handlebars.compile('<li class="list-group-item metric alert alert-{{status}}" title="{{score}}%">{{label}}<span class="badge">{{#if boolean}}{{#if value}}x{{else}}&#x2713{{/if}}{{else}}{{value}}{{/if}}</span></li>');

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

  function naiveScoreNumPoison (key, value, label, max) {
    return {
      key: key,
      label: label,
      value: value,
      status: (function () {
        if (value === 0) {
          return 'success';
        } else if (value === 1) {
          return 'info';
        } else if (value > max) {
          return 'danger';
        } else {
          return 'warning';
        }
      }()),
      score: value / max
    };
  }

  function naiveScoreBoolean (key, value, label, invert) {
    return {
      key: key,
      label: label,
      value: value,
      boolean: true,
      status: ((invert ? !value : value) ? 'success' : 'danger'),
      score: ((invert ? !value : value) ? 100 : 0)
    };
  }

  function naiveScoreRepeats (key, value, label, passwordLength, thresholds) {
    var percent = value / passwordLength;
    return {
      key: key,
      label: label,
      value: value,
      status: (function () {
        if (percent < thresholds[0]) {
          return 'success';
        } else if (percent < thresholds[1]) {
          return 'info';
        } else if (percent < thresholds[2]) {
          return 'warning';
        } else {
          return 'danger';
        }
      }()),
      score: percent
    };
  }

  function naiveScoring (analysis) {
    return _.compact(_.map(analysis, function (value, key) {
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
      case 'num_classes':
        return {
          key: key,
          label: 'Number of Character Classes',
          value: value,
          status: ['danger', 'danger', 'warning', 'info', 'success'][value],
          score: value / 4
        };
      case 'num_words':
        return naiveScoreNumPoison(key, value, 'Number of Words', analysis.password_length / 5); // arbitrary, assuming 4 characters on average per word
      case 'num_numbers':
        return naiveScoreNumPoison(key, value, 'Number of Numbers', analysis.password_length / 5); // arbitrary, assuming 4 digits on average per number
      case 'num_years':
        return naiveScoreNumPoison(key, value, 'Number of Years', analysis.password_length / 5); // not arbitrary, exactly 4 digits per year
      case 'letters_only':
        return naiveScoreBoolean(key, value, 'Letters Only?', true);
      case 'numerals_only':
        return naiveScoreBoolean(key, value, 'Numerals Only?', true);
      case 'symbols_only':
        return naiveScoreBoolean(key, value, 'Symbols Only?', true);
      case 'repeat_characters':
        return naiveScoreRepeats(key, value, 'Number of Repeated Characters', analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'repeat_characters_insensitive':
        return naiveScoreRepeats(key, value, 'Number of Repeated Characters (Case Insensitive)', analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'repeat_numerals':
        return naiveScoreRepeats(key, value, 'Number of Repeated Numerals', analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'repeat_symbols':
        return naiveScoreRepeats(key, value, 'Number of Repeated Symbols', analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'consecutive_uppercase':
        return naiveScoreRepeats(key, value, 'Number of Consecutive Uppercase Characters', analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'consecutive_lowercase':
        return naiveScoreRepeats(key, value, 'Number of Consecutive Lowercase Characters', analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'consecutive_numerals':
        return naiveScoreRepeats(key, value, 'Number of Consecutive Numerals', analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'consecutive_symbols':
        return naiveScoreRepeats(key, value, 'Number of Consecutive Symbols', analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'sequential_letters':
        return naiveScoreRepeats(key, value, 'Number of Sequential Letters', analysis.password_length, [0.01, 0.05, 0.1]); // arbitrary thresholds
      case 'sequential_numerals':
        return naiveScoreRepeats(key, value, 'Number of Sequential Numerals', analysis.password_length, [0.01, 0.05, 0.1]); // arbitrary thresholds
      case 'keyboard_proximity':
        return naiveScoreRepeats(key, value, 'Keyboard Proximity', analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'dictionary_hits':
        return null;
      case 'dictionary_hit_count':
        return naiveScoreNumPoison(key, value, 'Dictionary Hits', analysis.password_length / 5); // arbitrary
      default:
        return {
          key: key,
          label: titleCase(key),
          value: 0,
          status: null,
          score: 0
        };
      }
    }));
  }

  function render (analysis) {
    container.empty().append(_.map(naiveScoring(analysis), template).join(''));
  }

  return {
    render: render
  };
});