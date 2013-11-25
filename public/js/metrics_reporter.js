define(['jquery', 'underscore', 'handlebars', 'localize', 'metric_scorer'], function ($, _, Handlebars, localize, metricScorer) {
  var
    container = $('.metrics'),
    template = Handlebars.compile('' +
      '<li class="list-group-item metric alert alert-{{status}}">{{label}}{{#if hasTooltip}} <span class="glyphicon glyphicon-info-sign"></span>{{/if}}<span class="badge">{{#if boolean}}{{#if value}}x{{else}}&#x2713{{/if}}{{else}}{{value}}{{/if}}</span></li>'
    );

  function render (analysis) {
    container.empty();
    _.each(metricScorer.score(analysis), function (obj) {
      obj.label = localize.localize('metric_label_' + obj.key);
      obj.hasTooltip = localize.hasKey('metric_tooltip_' + obj.key);

      var el = $(template(obj));
      el.appendTo(container);

      if (obj.tooltipMessage) {
        el.find('.glyphicon').popover({
          animation: true,
            placement: 'right',
            trigger: 'hover',
            //title: 'testing',
            content: localize.localize('metric_tooltip_' + obj.key),
            container: 'body'
        });
      }
    });
  }

  function init (config) {
    metricScorer.init(config);
  }

  return {
    init: init,
    render: render
  };
});