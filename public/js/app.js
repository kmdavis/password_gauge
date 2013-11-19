define(['jquery', 'analysis' , 'metrics_reporter', 'crack_time_reporter'], function ($, analysis, metricsReporter, crackTimeReporter) {
  function run (password) {
    var results = analysis.analyze(password);
    // TODO: submit results
    metricsReporter.render(results);
    crackTimeReporter.render(results);
    $('.results').removeClass('hide');
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