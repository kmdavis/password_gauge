/* global Analyzer: false */

describe('Static Analysis', function () {
  describe('analyze', function () {
    it('should return an object', function () {
      expect(Analyzer.analyze('')).toEqual(jasmine.any(Object));
    });
  });
});