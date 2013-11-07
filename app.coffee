express = require 'express'
app = express()
exphbs = require 'express3-handlebars'

app.use app.router
app.use express.static "#{__dirname}/public"

app.engine 'handlebars', exphbs {defaultLayout: 'main'}

app.set 'views', "#{__dirname}/views"
app.set 'view engine', 'handlebars'

app.get '/', (req, res) ->
  res.render 'index'

port = process.env.PORT || 3000
app.listen port, ->
  console.log("Listening on port # #{port}")