express = require 'express'
app = express()
exphbs = require 'express3-handlebars'
fs = require 'fs'
_ = require 'underscore'
Keyboard = require './lib/keyboard'
Dictionary = require './lib/dictionary'
LeetMutator = require './lib/leet_mutator'
KeyboardMutator = require './lib/keyboard_mutator'

app.use app.router
app.use express.static "#{__dirname}/public"
app.use express.bodyParser()

app.engine 'handlebars', exphbs {defaultLayout: 'main'}

app.set 'views', "#{__dirname}/views"
app.set 'view engine', 'handlebars'

port = process.env.PORT || 3000
env = process.env.ENV || 'dev'

app.get '/', (req, res) ->
  fs.readFile 'config/strings/en.json', (err, data) ->
    strings = JSON.parse(data)
    res.render 'index', {
      strings: strings,
      hashing_algorithms: {
        cryptographic_hash_functions: _.map(hashingAlgorithms.cryptographic_hash_functions, (a) ->
          b = _.clone(a)
          b.label = strings["hashing_algorithm_#{b.key}"]
          b
        )
        key_derivation_functions: _.map(hashingAlgorithms.key_derivation_functions, (a) ->
          b = _.clone(a)
          b.label = strings["hashing_algorithm_#{b.key}"]
          b
        )
        known_sites: _.map(hashingAlgorithms.known_sites, (a) ->
          b = _.clone(a)
          b.label = strings["known_site_#{b.key}"]
          b
        )
      }
      minifyAssets: 'prod' == env
      config: JSON.stringify({
        nonEntropicFactorThresholds: nonEntropicFactorThresholds,
        metricThresholds: metricThresholds,
        agencies: agencies,
        keyboard: keyboardMap,
        localizationTable: strings,
        dictionary: mutatedDictionary,
        hashingAlgorithms: hashingAlgorithms
      })
    }

app.get '/submit_results', (req, res) ->
  console.log('RESULTS', req.query)
  # TODO: save results
  res.send 200

app.get '/about', (req, res) ->
  fs.readFile 'config/strings/en.json', (err, data) ->
    strings = JSON.parse(data)
    res.render 'about', {
      strings: strings
    }

rawDictionary = _.compact(fs.readFileSync('config/dictionary.txt').toString().split(/\s/))
keyboardMap = JSON.parse(fs.readFileSync('config/keyboards/qwerty_us_en.json')).map
leetSubstitutions = JSON.parse(fs.readFileSync('config/leet_substitutions.json'))
nonEntropicFactorThresholds = JSON.parse(fs.readFileSync('config/non_entropic_factor_thresholds.json'))
metricThresholds = JSON.parse(fs.readFileSync('config/metric_thresholds.json'))
agencies = JSON.parse(fs.readFileSync('config/agencies.json')).agencies
hashingAlgorithms = JSON.parse(fs.readFileSync('config/hashing_algorithms.json'))

keyboard = new Keyboard(keyboardMap)
leetMutator = new LeetMutator(leetSubstitutions)
keyboardMutator = new KeyboardMutator(keyboard)

dictionary = new Dictionary(rawDictionary)
dictionary.addMutator(leetMutator)
dictionary.addMutator(keyboardMutator)
mutatedDictionary = dictionary.mutate(1)

app.listen port, ->
  console.log("Listening on port # #{port}")