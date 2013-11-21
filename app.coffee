express = require 'express'
app = express()
exphbs = require 'express3-handlebars'
fs = require 'fs'
_ = require 'underscore'
Keyboard = require './public/js/keyboard'
Dictionary = require './public/js/dictionary'
LeetMutator = require './public/js/leet_mutator'
KeyboardMutator = require './public/js/keyboard_mutator'

app.use app.router
app.use express.static "#{__dirname}/public"

app.engine 'handlebars', exphbs {defaultLayout: 'main'}

app.set 'views', "#{__dirname}/views"
app.set 'view engine', 'handlebars'

app.get '/', (req, res) ->
  res.render 'index', {
    dictionary: JSON.stringify(mutatedDictionary),
    keyboard: JSON.stringify(keyboardMap)
  }

app.get '/about', (req, res) ->
  res.render 'about'

rawDictionary = _.compact(fs.readFileSync('config/dictionary.txt').toString().split(/\s/))
keyboardMap = JSON.parse(fs.readFileSync('config/keyboards/qwerty_us_en.json')).map
leetSubstitutions = JSON.parse(fs.readFileSync('config/leet_substitutions.json'))
keyboard = new Keyboard(keyboardMap)
leetMutator = new LeetMutator(leetSubstitutions)
keyboardMutator = new KeyboardMutator(keyboard)

startTime = Date.now()
console.log "Creating Mutant Dictionary from #{rawDictionary.length} entries; this WILL take awhile"
dictionary = new Dictionary(rawDictionary)
dictionary.addMutator(leetMutator)
dictionary.addMutator(keyboardMutator)
mutatedDictionary = dictionary.mutate(1)
mutationElapsed = Date.now() - startTime
console.log("Created Mutant Dictionary with #{mutatedDictionary.getLength()} entries in #{mutationElapsed}ms")

port = process.env.PORT || 3000
app.listen port, ->
  console.log("Listening on port # #{port}")