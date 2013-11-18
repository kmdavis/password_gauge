(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['underscore'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('underscore'));
  } else {
    root.Keyboard = factory(root._);
  }
}(this, function (_) {
  function Keyboard (map) {
    this._map = map;
  }

  _.extend(Keyboard.prototype, {

    getKeyAt: function getKeyAt(x, y, shift) {
      if (this._map[y] && this._map[y][x]) {
        return this._map[y][x][shift];
      }
      return null;
    },

    getNeighbors: function getNeighbors (letter) {
      var
        self = this,
        result = {
          distance: []
        };

      _.each(self._map, function (row, y) {
        _.each(row, function (cell, x) {
          if (_.contains(cell, letter)) {
            var
              shift    = cell[0] === letter ? 0 : 1,
              altShift = cell[0] === letter ? 1 : 0;

            result.distance[0] = [letter];

            result.distance[1] = [
              cell[altShift],
              self.getKeyAt(x, y - 1, shift),
              self.getKeyAt(x, y + 1, shift),
              self.getKeyAt(x - 1, y, shift),
              self.getKeyAt(x + 1, y, shift)
            ];

            result.distance[2] = [
              self.getKeyAt(x, y - 1, altShift),
              self.getKeyAt(x, y + 1, altShift),
              self.getKeyAt(x - 1, y, altShift),
              self.getKeyAt(x + 1, y, altShift),
              self.getKeyAt(x - 1, y - 1, shift),
              self.getKeyAt(x - 1, y + 1, shift),
              self.getKeyAt(x + 1, y - 1, shift),
              self.getKeyAt(x + 1, y + 1, shift)
            ];

            result.distance[3] = [
              self.getKeyAt(x - 1, y - 1, altShift),
              self.getKeyAt(x - 1, y + 1, altShift),
              self.getKeyAt(x + 1, y - 1, altShift),
              self.getKeyAt(x + 1, y + 1, altShift)
            ];
          }
        });
      });

      return result;
    },

    proximity: function proximity (password) {
      var i, result = 0;

      for (i = 0; i < password.length - 1; i += 1) {
        var
          neighbors = this.getNeighbors((password[i])),
          nextLetter = password[i + 1];

        _.each(neighbors.distance, function (keys, i) {
          if (_.contains(keys, nextLetter)) {
            result += 4 - i;
          }
        });
      }

      return result;
    }
  });

  return Keyboard;
}));