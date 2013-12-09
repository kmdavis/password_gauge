define('crack_time_reporter',

[
  'vendor/jquery',
  'vendor/underscore',
  'vendor/handlebars',
  'vendor/moment',
  'lib/localize',
  'lib/non_entropic_factors'
],

function ($, _, Handlebars, moment, localize, nonEntropicFactors) {
  var
    container = $('.time-required'),
    template = Handlebars.compile('<li class="list-group-item">{{{text}}}</li>'),
    agencies = [];

  function render (analysis) {
    var fudgedEntropy = analysis.entropy * nonEntropicFactors.score(analysis);
    container.empty().append(_.map(agencies, function (agency) {
      var secondsRequired = Math.pow(2, fudgedEntropy - agency.computationalStrength);
      return template({
        text: agency.template({
          duration: moment.duration(secondsRequired, 'seconds').humanize()
        })
      });
    }).join(''));
  }

  function init (config) {
    nonEntropicFactors.init(config);
    agencies = _.map(config.agencies, function (agency) {
      agency.template = Handlebars.compile(localize.localize('crack_time_template_' + agency.key));
      return agency;
    });
  }

  return {
    init: init,
    render: render
  };
});