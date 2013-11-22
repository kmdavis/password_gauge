define(['jquery', 'underscore', 'handlebars', 'moment'], function ($, _, Handlebars, moment) {
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

  function score (val, min, divisor, outMin) {
    if (val >= min) {
      return outMin + ((1.0 - outMin) * (1 - (val / divisor)));
    } else {
      return 1.0;
    }
  }

  function fudgeFactor (analysis) {


    var result =
      score(analysis.num_words, 2, analysis.password_length / 5, 0.9) *
      score(analysis.num_numbers, 2, analysis.password_length / 5, 0.9) *
      score(analysis.num_years, 2, analysis.password_length / 5, 0.9) *
      score(analysis.repeat_characters, analysis.password_length / 5, analysis.password_length, 0.9) *
      score(analysis.repeat_characters_insensitive, analysis.password_length / 5, analysis.password_length, 0.9) *
      score(analysis.repeat_numerals, analysis.password_length / 5, analysis.password_length, 0.9) *
      score(analysis.repeat_symbols, analysis.password_length / 5, analysis.password_length, 0.9) *
      score(analysis.consecutive_uppercase, analysis.password_length / 5, analysis.password_length, 0.9) *
      score(analysis.consecutive_lowercase, analysis.password_length / 5, analysis.password_length, 0.9) *
      score(analysis.consecutive_numerals, analysis.password_length / 5, analysis.password_length, 0.9) *
      score(analysis.consecutive_symbols, analysis.password_length / 5, analysis.password_length, 0.9) *
      score(analysis.sequential_characters, analysis.password_length / 5, analysis.password_length, 0.9) *
      score(analysis.sequential_numerals, analysis.password_length / 5, analysis.password_length, 0.9) *
      score(analysis.keyboard_proximity, analysis.password_length * 2, analysis.password_length, 0.9) *
      score(analysis.dictionary_hit_count, 1, analysis.password_length / 5, 0.9);

    // todo: hashing method + salt

    console.log('fudge factor', result);

    return result;
  }

  function render (analysis) {
    var fudgedEntropy = analysis.entropy * fudgeFactor(analysis);
    //var computationsRequiredForBruteForceAttack = Math.pow(2, analysis.entropy); // number is too big
    container.empty().append(_.map(AGENCIES, function (agency) {
      var secondsRequired = Math.pow(2, fudgedEntropy - agency.computationalStrength);
      return template({
        text: agency.template({
          duration: moment.duration(secondsRequired, 'seconds').humanize()
        })
      });
    }).join(''));
  }

  return {
    render: render
  };
});