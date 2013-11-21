define(['jquery', 'underscore', 'handlebars'], function ($, _, Handlebars) {
  var
    container = $('.metrics'),
    template = Handlebars.compile('' +
      '<li class="list-group-item metric alert alert-{{status}}">{{label}}{{#if tooltipMessage}} <span class="glyphicon glyphicon-info-sign"></span>{{/if}}<span class="badge">{{#if boolean}}{{#if value}}x{{else}}&#x2713{{/if}}{{else}}{{value}}{{/if}}</span></li>'
    );

  function titleCase (key) {
    return _.map(key.split(/_/g), function (word) { return word[0].toUpperCase() + word.slice(1); }).join(' ');
  }

  function naiveScoreNumInClass (key, value, label, message, passwordLength, min, thresholds) {
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
      score: percent,
      tooltipMessage: message
    };
  }

  function naiveScoreNumPoison (key, value, label, message, max) {
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
      score: value / max,
      tooltipMessage: message
    };
  }

  function naiveScoreBoolean (key, value, label, message, invert) {
    return {
      key: key,
      label: label,
      value: value,
      boolean: true,
      status: ((invert ? !value : value) ? 'success' : 'danger'),
      score: ((invert ? !value : value) ? 100 : 0),
      tooltipMessage: message
    };
  }

  function naiveScoreRepeats (key, value, label, message, passwordLength, thresholds) {
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
      score: percent,
      tooltipMessage: message
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
        return naiveScoreNumInClass(key, value, 'Number of Uppercase Characters', null, analysis.password_length, 1, [0.1, 0.25]); // thresholds and mins are arbitrary
      case 'num_lowercase':
        return naiveScoreNumInClass(key, value, 'Number of Lowercase Characters', null, analysis.password_length, 1, [0.1, 0.25]);
      case 'num_numerals':
        return naiveScoreNumInClass(key, value, 'Number of Numeric Digits',       null, analysis.password_length, 1, [0.075, 0.2]);
      case 'num_symbols':
        return naiveScoreNumInClass(key, value, 'Number of Symbols',              null, analysis.password_length, 1, [0.15, 0.3]);
      case 'num_classes':
        return {
          key: key,
          label: 'Number of Character Classes',
          value: value,
          status: ['danger', 'danger', 'warning', 'info', 'success'][value],
          score: value / 4,
          tooltipMessage: 'Increasing the number of character classes makes it so that a hacker has to do more work in order to crack the password. See "Entropy" below.'
        };
      case 'num_words':
        return naiveScoreNumPoison(key, value, 'Number of Words',
          'Including words in your password may make it easier to remember, but it also makes it easier to crack, as it introduces an element that is subject to prediction.',
          analysis.password_length / 5); // arbitrary, assuming 4 characters on average per word
      case 'num_numbers':
        return naiveScoreNumPoison(key, value, 'Number of Numbers',
          'Including long numbers in your password may make it easier to remember, but it also makes it easier to crack, as it introduces an element that is subject to prediction.',
          analysis.password_length / 5); // arbitrary, assuming 4 digits on average per number
      case 'num_years':
        return naiveScoreNumPoison(key, value, 'Number of Years',
          'Just like including words and numbers in a password, years are also easy to remember... they are also VERY easy to guess.',
          analysis.password_length / 5); // not arbitrary, exactly 4 digits per year
      case 'letters_only':
        return naiveScoreBoolean(key, value, 'Letters Only?',  null, true);
      case 'numerals_only':
        return naiveScoreBoolean(key, value, 'Numerals Only?', null, true);
      case 'symbols_only':
        return naiveScoreBoolean(key, value, 'Symbols Only?',  null, true);
      case 'repeat_characters':
        return naiveScoreRepeats(key, value, 'Number of Repeated Characters',
          'Sometimes you can\'t avoid repeating characters, especially if your password is long, but if you repeat too much, a detectable pattern can creep in. You also don\'t want to use every character, as that is also a pattern.',
          analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'repeat_characters_insensitive':
        return naiveScoreRepeats(key, value, 'Number of Repeated Characters (Case Insensitive)',
          'This is the same as Repeated Characters, but we don\'t take case into consideration, e.g. "a" == "A"',
          analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'repeat_numerals':
        return naiveScoreRepeats(key, value, 'Number of Repeated Numerals', null, analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'repeat_symbols':
        return naiveScoreRepeats(key, value, 'Number of Repeated Symbols',  null, analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'consecutive_uppercase':
        return naiveScoreRepeats(key, value, 'Number of Consecutive Uppercase Characters',
          'Repeating characters ("aaa") creates a pattern, and if you\'ve been reading all these tooltips, you know by now that patterns in a password are bad.',
          analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'consecutive_lowercase':
        return naiveScoreRepeats(key, value, 'Number of Consecutive Lowercase Characters', null, analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'consecutive_numerals':
        return naiveScoreRepeats(key, value, 'Number of Consecutive Numerals',             null, analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'consecutive_symbols':
        return naiveScoreRepeats(key, value, 'Number of Consecutive Symbols',              null, analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'sequential_letters':
        return naiveScoreRepeats(key, value, 'Number of Sequential Letters',
          'Sequences ("abcde") are also bad.',
          analysis.password_length, [0.01, 0.05, 0.1]); // arbitrary thresholds
      case 'sequential_numerals':
        return naiveScoreRepeats(key, value, 'Number of Sequential Numerals',
          'Sequences ("12345") are bad.',
          null, analysis.password_length, [0.01, 0.05, 0.1]); // arbitrary thresholds
      case 'keyboard_proximity':
        return naiveScoreRepeats(key, value, 'Keyboard Proximity',
          'This is a measure of how close two adjacent characters in your password are on your keyboard, e.g. "a" is next to "s".',
          analysis.password_length, [0.05, 0.1, 0.2]); // arbitrary thresholds
      case 'dictionary_hit_count':
        return naiveScoreNumPoison(key, value, 'Dictionary Hits',
          'Using common words is a "bad thing", as it makes it very easy to crack your password. This is typically the first thing hackers try.',
          analysis.password_length / 5); // arbitrary
      case 'entropy':
        return {
          key: key,
          label: titleCase(key),
          value: Math.floor(value),
          status: (function () {
            if (value < 64) { // arbitrary thresholds:
              return 'danger';
            } else if (value < 128) {
              return 'warning';
            } else if (value > 256) {
              return 'success';
            } else {
              return 'info';
            }
          }),
          score: Math.floor(value / 400), // arbitrary
          tooltipMessage: 'Entropy is a measure of how much computation time would be required to brute force your password. This is determined by counting the number of possible characters that a hacker would have to pull randomly from, which in turn is based on what character classes you are using.'
        };
      default:
        return null;
      }
    }));
  }

  function render (analysis) {
    //container.empty().append(_.map(naiveScoring(analysis), template).join(''));
    container.empty();
    _.each(naiveScoring(analysis), function (obj) {
      var el = $(template(obj));
      el.appendTo(container);
      if (obj.tooltipMessage) {
        el.find('.glyphicon').popover({
          animation: true,
            placement: 'right',
            trigger: 'hover',
            //title: 'testing',
            content: obj.tooltipMessage,
            container: 'body'
        });
      }
    });
  }

  return {
    render: render
  };
});