(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define('lib/analysis', ['vendor/underscore', 'lib/keyboard', 'lib/dictionary'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('underscore'), require('./keyboard'), require('./dictionary'));
  } else {
    root.nonEntropicFactors = factory(root._, root.Keyboard, root.Dictionary);
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