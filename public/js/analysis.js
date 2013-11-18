define(['underscore'], function (_) {

  function init (config) {
    KEYBOARD = config.keyboard.map,
    DICTIONARY = mutateDictionary(config.dictionary);
  }

  function analyze (password) {
    var
      numUppercase = (password.match(/[A-Z]/g) || []).length,
      numLowercase = (password.match(/[a-z]/g) || []).length,
      numNumerals  = (password.match(/\d/g)    || []).length,
      numSymbols   = (password.match(/[\W_]/g) || []).length;

    return {
      length: password.length,
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
      consecutive_numbers:           consecutive(password, /\d{2,}/g),
      consecutive_symbols:           consecutive(password, /[\W_]{2,}/g),
      sequential_numbers:            sequential(password,  /\d{2,}/g),
      sequential_letters:            sequential(password,  /[a-zA-Z]{2,}/g),
      keyboard_proximity:            keyboardProximity(password),
      dictionary_hits:               dictionaryHits(password)
      // TODO: unicode? (e.g. 'ä' vs '$' and 'a' -> 'ä')
      // TODO: war list (e.g. ask some questions, what's your name? when were you born?, etc
      // TODO: 1337 case
    };
  }

  var
    DICTIONARY = null, // filled in by init
    KEYBOARD = null;

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

  function getKeyboardAt(x, y, shift) {
    if (KEYBOARD[y] && KEYBOARD[y][x]) {
      return KEYBOARD[y][x][shift];
    }
    return null;
  }

  function getKeyboardNeighbors (letter) {
    var result = {
      distance: []
    };
    _.each(KEYBOARD, function (row, y) {
      _.each(row, function (cell, x) {
        if (_.contains(cell, letter)) {
          var
            shift    = cell[0] === letter ? 0 : 1,
            altShift = cell[0] === letter ? 1 : 0;

          result.distance[0] = [letter];

          result.distance[1] = [
            cell[altShift],
            getKeyboardAt(x, y - 1, shift),
            getKeyboardAt(x, y + 1, shift),
            getKeyboardAt(x - 1, y, shift),
            getKeyboardAt(x + 1, y, shift)
          ];

          result.distance[2] = [
            getKeyboardAt(x, y - 1, altShift),
            getKeyboardAt(x, y + 1, altShift),
            getKeyboardAt(x - 1, y, altShift),
            getKeyboardAt(x + 1, y, altShift),
            getKeyboardAt(x - 1, y - 1, shift),
            getKeyboardAt(x - 1, y + 1, shift),
            getKeyboardAt(x + 1, y - 1, shift),
            getKeyboardAt(x + 1, y + 1, shift)
          ];

          result.distance[3] = [
            getKeyboardAt(x - 1, y - 1, altShift),
            getKeyboardAt(x - 1, y + 1, altShift),
            getKeyboardAt(x + 1, y - 1, altShift),
            getKeyboardAt(x + 1, y + 1, altShift)
          ];
        }
      });
    });

    return result;
  }

  function keyboardProximity (password) {
    var i, result = 0;

    for (i = 0; i < password.length - 1; i += 1) {
      var
        neighbors = getKeyboardNeighbors((password[i])),
        nextLetter = password[i + 1];

      _.each(neighbors.distance, function (keys, i) {
        if (_.contains(keys, nextLetter)) {
          result += 4 - i;
        }
      });
    }

    return result;
  }

  function mutateDictionary (dictionary) {
    var
      dict1337 = _.flatten(_.map(dictionary, function (w) { return mutate1337(w); })),
      dictKeyb = _.flatten(_.map(dictionary, function (w) { return mutateKeyboard(w); }));

    return _.uniq(_.flatten([
      dictionary,
      dict1337,
      dictKeyb,
      _.map(dict1337, function (w) { return mutateKeyboard(w); }),
      _.map(dictKeyb, function (w) { return mutate1337(w); })
    ]));
  }

  function mutate1337 (word) {
    // TODO
    // step 1: split
    // step 2: get a list of all possible substitutions
    // step 3: recombine all combinations
    return [word];
  }

  function mutateKeyboard (word) {
    var
      raw = _.map(word, function (letter) {
        return getKeyboardNeighbors(letter);
      }),
      results = [
        _.map(raw, function (a) { return a.distance[1][1]; }),
        _.map(raw, function (a) { return a.distance[1][2]; }),
        _.map(raw, function (a) { return a.distance[1][3]; }),
        _.map(raw, function (a) { return a.distance[1][4]; }),
        _.map(raw, function (a) { return a.distance[2][4]; }),
        _.map(raw, function (a) { return a.distance[2][5]; }),
        _.map(raw, function (a) { return a.distance[2][6]; }),
        _.map(raw, function (a) { return a.distance[2][7]; })
      ];

    return _.map(_.reject(results, function (w) {
      return _.contains(w, null);
    }), function (w) {
      return w.join('');
    });
  }

  function dictionaryHits (password) {
    return _.filter(DICTIONARY, function (word) {
      return password.indexOf(word) !== -1;
    }).length;
  }

  return {
    init: init,
    analyze: analyze
  };
});