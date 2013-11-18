define(['jquery', 'analysis'], function ($, analysis) {
  function run (password) {
    var results = analysis.analyze(password);
    // TODO: submit results
    // TODO: render results
    // TODO: score results
    // TODO: render score
    console.log(results);
  }

  function init (config) {
    analysis.init(config);

    $('.gauge-form').on('submit', function (ev) {
      ev.preventDefault();
      run($('.gauge-form input[name=password]').val());
    });

    $('#evaluate').on('click', function (ev) {
      ev.preventDefault();
      run($('.gauge-form input[name=password]').val());
    });
  }

  return {
    init: init
  };
});