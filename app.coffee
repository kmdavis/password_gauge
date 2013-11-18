express = require 'express'
app = express()
exphbs = require 'express3-handlebars'
fs = require 'fs'
_ = require 'underscore'

app.use app.router
app.use express.static "#{__dirname}/public"

app.engine 'handlebars', exphbs {defaultLayout: 'main'}

app.set 'views', "#{__dirname}/views"
app.set 'view engine', 'handlebars'

getKeyboard = (req) ->
  # TODO
  'qwerty_us_en'

app.get '/', (req, res) ->
  fs.readFile 'config/dictionary.txt', (err, dictionary) ->
    fs.readFile "config/keyboards/#{getKeyboard(req)}.json", (err, keyboard) ->
      res.render 'index', {
        dictionary: JSON.stringify(_.compact(dictionary.toString().split(/\s/))),
        keyboard: keyboard
      }

port = process.env.PORT || 3000
app.listen port, ->
  console.log("Listening on port # #{port}")