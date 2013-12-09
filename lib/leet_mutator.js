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