module.exports = (grunt) ->
  grunt.initConfig
    pkg: grunt.file.readJSON 'package.json'
    meta:
      lib:   'lib/**/*.js'
      public: 'public/js/*.js'
      specs: 'spec/**/*.spec.js'
    jshint:
      src: ['<%= meta.lib %>', '<%= meta.public %>', '<%= meta.specs %>']
      options:
        jshintrc: true
    karma:
      options:
        configFile: 'karma.conf.js'
        preprocessors:
          '**/lib/**/*.js': 'coverage'
        browsers: [
          #'Firefox', 'Chrome', 'Safari'
          'Firefox'
        ]
        reporters: ['progress', 'coverage']
    # files: [] # Can't do this here, due to lack of JASMINE and JASMINE_ADAPTER global constants
    # if you add a dependency, it needs to be added to the files list in karma.conf.js
      specs: {}
      once:
        singleRun: true
      once_travis:
        singleRun: true
        browsers: [
          'PhantomJS'
        ]
    coverage:
      options:
        thresholds:
          statements: 90
          branches: 90
          lines: 90
          functions: 90
        dir: 'coverage'
    complexity:
      generic:
        src: ['<%= meta.lib %>', '<%= meta.public %>']
        options:
          errorsOnly: false
          cyclomatic: 10
          halstead: 20
          maintainability: 65
    clean:
      build: ['coverage', 'test-results.xml', 'doc', 'public/css/main.min.css', 'public/js/main.src.js', 'public/js/main.min.js']
      test: ['coverage', 'test-results.xml']
    concat:
      options:
        separator: '\n\n'
        banner: '/*! <%= pkg.name %> v<%= pkg.version %> <%= grunt.template.today("yyyy-mm-dd") %> */\n'
      build:
        src: [ # TODO: MAINTANANCE TASK: keep this in the proper order
          'public/js/vendor/require.js',
          'public/js/vendor/jquery.js',
          'public/js/vendor/bootstrap.js',
          'public/js/vendor/underscore.js',
          'public/js/vendor/moment.js',
          'public/js/vendor/handlebars.js',
          'lib/metric_scorer.js',
          'lib/non_entropic_factors.js',
          'lib/keyboard.js',
          'lib/keyboard_mutator.js',
          'lib/leet_mutator.js',
          'lib/dictionary.js',
          'lib/analysis.js',
          'lib/localize.js',
          'public/js/crack_time_reporter.js',
          'public/js/metrics_reporter.js',
          'public/js/app.js'
        ]
        dest: 'public/js/main.src.js'
    replace:
      dist:
        options:
          variables:
            'version': '<%= pkg.version %>' # Not currently used
        files: [
          {
            expand: true,
            flatten: true,
            src: ['public/js/main.src.js'],
            dest: 'public/js/'
          }
        ]
    uglify:
      options:
        banner: '/*! <%= pkg.name %> v<%= pkg.version %> <%= grunt.template.today("yyyy-mm-dd") %> */\n'
      build:
        src:  'public/js/main.src.js'
        dest: 'public/js/main.min.js'
    less:
      production:
        options:
          report: 'gzip'
          strictImports: true
          cleancss: true
        files: {
          'public/css/main.min.css': 'public/css/main.less'
        }
    release:
      options:
        bump:     true,  # bump the version in your package.json file.
        add:      false, # stage the package.json file's change.
        commit:   false, # commit that change with a message like "release 0.6.22".
        tag:      false, # create a new git tag for the release.
        push:     false, # push the changes out to github.
        pushTags: false, # also push the new tag out to github.
        npm:      false  # publish the new version to npm.

  grunt.loadNpmTasks 'grunt-complexity'
  grunt.loadNpmTasks 'grunt-contrib-clean'
  grunt.loadNpmTasks 'grunt-contrib-concat'
  grunt.loadNpmTasks 'grunt-contrib-jasmine'
  grunt.loadNpmTasks 'grunt-contrib-jshint'
  grunt.loadNpmTasks 'grunt-contrib-less'
  grunt.loadNpmTasks 'grunt-contrib-uglify'
  grunt.loadNpmTasks 'grunt-istanbul-coverage'
  grunt.loadNpmTasks 'grunt-karma'
  grunt.loadNpmTasks 'grunt-release'
  grunt.loadNpmTasks 'grunt-replace'

  grunt.registerTask 'doc', 'Generate documentation', ->
    done = this.async()
    grunt.log.writeln('Generating Documentation...')
    groc = require('child_process').spawn('./node_modules/.bin/groc', ['lib/*.js', 'README.md'])
    groc.stderr.on 'data', (data) -> grunt.log.error data.toString()
    groc.on 'exit', (status) ->
      if 0 == status
        grunt.log.writeln('...done!')
        done()
      else
        done(false)

  grunt.registerTask 'coveralls', 'Coveralls', ->
    done = this.async()
    require('child_process').exec './node_modules/grunt-karma/node_modules/karma/node_modules/.bin/istanbul report --lcovonly && cat ./coverage/lcov.info | ./node_modules/.bin/coveralls', (err, stdout, stderr) ->
      console.log err if err?
      done !err?

  grunt.registerTask 'default', ['karma:specs']
  grunt.registerTask 'minify', ['concat', 'replace', 'uglify', 'less']
  grunt.registerTask 'build', ['test', 'clean:build', 'doc', 'minify']
  grunt.registerTask 'test', ['clean:test', 'jshint', 'karma:once', 'coverage', 'complexity']
  grunt.registerTask 'test_travis', ['clean:test', 'jshint', 'karma:once_travis', 'coveralls']
