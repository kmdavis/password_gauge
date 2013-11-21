define(['jquery', 'underscore', 'handlebars'], function ($, _, Handlebars) {
  var
    container = $('.time-required'),
    template = Handlebars.compile('<li class="list-group-item">{{{text}}}</li>'),

    AGENCIES = [
      {
        key: 'boss',
        computationalStrength: 27, // 2^27 FLOPS ~= 171 MFLOPS, iPad2
        template: Handlebars.compile('It would take your boss <code>{{duration}}</code> to crack your password.')
      },
      {
        key: 'script-kiddie',
        computationalStrength: 35, // 2^35 FLOPS ~= 39 GFLOPS, 2013 MBP Core i7
        template: Handlebars.compile('A script kiddie could crack your password in <code>{{duration}}</code>.')
      },
      {
        key: 'hacker',
        computationalStrength: 41, // 2^41 FLOPS ~= 2.5 TFLOPS, GeForce GTX 590
        template: Handlebars.compile('A professional hacker could do it in <code>{{duration}}</code>.')
      },
      {
        key: 'nsa',
        computationalStrength: 50, // 2^50 FLOPS ~= 1.1 PFLOPS, <redacted by the NSA>
        template: Handlebars.compile('The NSA (or another large security apparatus) could do it in <code>{{duration}}</code>.')
      }
    ];

  function fudgeFactor (analysis) {
    return 1.0;
  }

  function renderDuration (duration) {
    if (duration < 1) {
      return 'less than a second';
    } else if (duration < 3) {
      return 'about a second';
    } else if (duration < 50) {
      return 'about ' + Math.floor((duration / 5) * 5) + ' seconds';
    } else if (duration < 70) {
      return 'about a minute';
    } else if (duration < 3000) { // 50 minutes
      return Math.floor(duration / 60) + ' minutes';
    } else if (duration < 5400) { // 90 minutes
      return 'about an hour';
    } else if (duration < 80000) { //86400 == 1 day
      return Math.floor(duration / 3600) + ' hours';
    } else if (duration < 130000) {
      return 'about a day';
    } else if (duration < 600000) {
      return 'under a week';
    } else if (duration < 2500000) {
      return 'a month';
    } else if (duration < 45000000) {
      return 'a year';
    } else {
      return Math.floor(duration / 31536000) + ' years';
    }
  }

  function render (analysis) {
    var fudgedEntropy = analysis.entropy * fudgeFactor(analysis);
    //var computationsRequiredForBruteForceAttack = Math.pow(2, analysis.entropy); // number is too big
    container.empty().append(_.map(AGENCIES, function (agency) {
      var secondsRequired = Math.pow(2, fudgedEntropy - agency.computationalStrength);
      return template({
        text: agency.template({
          duration: renderDuration(secondsRequired)
        })
      });
    }).join(''));
  }

  return {
    render: render
  };
});