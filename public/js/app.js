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
  function run (password, site) {
    var
      results = analysis.analyze(password),
      cleanedResults = _.clone(results);

    delete cleanedResults.dictionary_hits;
    $.get('/submit_results', cleanedResults);

    metricsReporter.render(results);
    crackTimeReporter.render(results, site);

    $('.results').removeClass('hide');
  }

  function getPassword() {
    return $('.gauge-form input[name=password]').val();
  }

  function getSite(config) {
    var
      siteKey = $('.gauge-form select[name=site]').val(),
      hashKey = $('.gauge-form select[name=hash]').val(),
      site = {
        algorithm: 'sha-256',
        system_salt: true,
        user_salt: false
      };

    if (siteKey) {
      console.log('SITEKEY', siteKey);
      site = _.find(config.hashingAlgorithms.known_sites, function (s) {
        return s.key === siteKey;
      });
    } else if (hashKey) {
      console.log('HASHKEY', hashKey);
      site.algorithm = hashKey;
    }

    return site;
  }

  function init (config) {
    localize.init(config);
    analysis.init(config);
    metricsReporter.init(config);
    crackTimeReporter.init(config);

    $('.gauge-form').on('submit', function (ev) {
      ev.preventDefault();
      run(getPassword(), getSite(config));
    });

    $('#evaluate').on('click', function (ev) {
      ev.preventDefault();
      run(getPassword(), getSite(config));
    });
  }

  return {
    init: init
  };
});