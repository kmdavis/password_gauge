define('app',

[
  'vendor/jquery',
  'vendor/underscore',
  'lib/analysis',
  'metrics_reporter',
  'crack_time_reporter',
  'lib/localize'
],

function ($, _, analysis, metricsReporter, crackTimeReporter, localize) {
  function run (password) {
    var
      results = analysis.analyze(password),
      cleanedResults = _.clone(results);

    delete cleanedResults.dictionary_hits;
    $.get('/submit_results', cleanedResults);

    metricsReporter.render(results);
    crackTimeReporter.render(results);

    $('.results').removeClass('hide');
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