define(['jquery', 'analysis' , 'metrics_reporter', 'crack_time_reporter', 'localize'], function ($, analysis, metricsReporter, crackTimeReporter, localize) {
  function run (password) {
    var results = analysis.analyze(password);
    // TODO: submit results
    metricsReporter.render(results);
    crackTimeReporter.render(results);
    $('.results').removeClass('hide');
    // TODO: score results
    // TODO: render score
    console.log('analysis', results);
  }

  function init (config) {
    localize.init(config);
    analysis.init(config);
    metricsReporter.init(config);
    crackTimeReporter.init(config);

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