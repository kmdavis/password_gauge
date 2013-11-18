(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['underscore'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('underscore'));
  } else {
    root.Keyboard = factory(root._);
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

      for (i = 1; i <= depth; i += 1) {
        mutations[i] = [];
        _.each(this.mutators, function (mutator) {
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
        });
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