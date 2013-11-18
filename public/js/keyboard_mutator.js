(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['underscore'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('underscore'));
  } else {
    root.KeyboardMutator = factory(root._);
  }
}(this, function (_) {

  function KeyboardMutator (keyboard) {
    this.keyboard = keyboard;
  }

  _.extend(KeyboardMutator.prototype, {
    mutate: function mutate (dictionary) {
      var result = { distance: [] }, self = this;
      _.each(dictionary.distance, function (words, dist) {
        _.each(words, function (word) {
          var
            raw = _.map(word, function (letter) {
              return self.keyboard.getNeighbors(letter);
            }),
            distances = [
              [
                _.map(raw, function (a) { return a.distance[1][1]; }),
                _.map(raw, function (a) { return a.distance[1][2]; }),
                _.map(raw, function (a) { return a.distance[1][3]; }),
                _.map(raw, function (a) { return a.distance[1][4]; })
              ],
              [
                _.map(raw, function (a) { return a.distance[2][4]; }),
                _.map(raw, function (a) { return a.distance[2][5]; }),
                _.map(raw, function (a) { return a.distance[2][6]; }),
                _.map(raw, function (a) { return a.distance[2][7]; })
              ]
            ];

          _.each(distances, function (candidates, i) {
            if (!result.distance[dist + i + 1]) {
              result.distance[dist + i + 1] = [];
            }
            result.distance[dist + i + 1] =  result.distance[dist + i + 1].concat(_.map(_.reject(candidates, function (w) {
              return _.contains(w, null);
            }), function (w) {
              return w.join('');
            }));
          });
        });
      });
      return result;
    }
  });

  return KeyboardMutator;
}));