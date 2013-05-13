var express   = require('express'),
    async     = require('async'),
    path      = require('path'),
    bcrypt    = require('bcrypt'),
    sqlite    = require('sqlite3'),
    os        = require('os'),
    jsonAPI   = require('./lib/jsonapi-v2-1.js').JSONAPI,
    events    = require('events'),
    ansi      = require('ansiparse'),
    moment    = require('moment'),
    config    = require('./config.js');
    
var JSONAPI = new jsonAPI({
  hostname: config.JSONAPI.hostname,
  port:     config.JSONAPI.port,
  username: config.JSONAPI.username,
  password: config.JSONAPI.password,
  salt:     config.JSONAPI.salt
});

var app = express();
var mainEmitter = new events.EventEmitter;
mainEmitter.setMaxListeners(100);
var currentPlayers = [];
var server = app.listen(config.App.port);
var io = require('socket.io').listen(server);
io.set('log level', 1);

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.bodyParser());
  app.use(express.static(path.join(__dirname, 'public')));
});

io.on('connection', function(socket) {
  // console.log('socket connected');
  
  function emitConsole(data) {
    socket.emit('console', {data: data});
  }
  function emitPlayer(data) {
    socket.emit('player', {data: data});
  }
  function emitSystem(data) {
    socket.emit('system', {data: data});
  }
  
  mainEmitter.on('console', emitConsole);
  mainEmitter.on('player', emitPlayer);
  mainEmitter.on('system', emitSystem);
  
  socket.on('disconnect', function() {
    // console.log('socket closed, removing listeners');
    mainEmitter.removeListener('console', emitConsole);
    mainEmitter.removeListener('player', emitPlayer);
    mainEmitter.removeListener('system', emitSystem);
  });
    
});

dataStream();

//SQLite connection
var userDB = new sqlite.Database('data/users.db', function() {
  userDB.run("CREATE TABLE IF NOT EXISTS users (username VARCHAR(100) NOT NULL, password VARCHAR(100) NOT NULL, salt VARCHAR(100) NOT NULL, PRIMARY KEY (username))", function() {
    userDB.run("INSERT OR IGNORE INTO users VALUES ('admin', '$2a$10$f4dpV3LgZKVos1sZnfMuxerO1mdvjOaPB/YaSLajZU3GGLiV46Cg2', '$2a$10$f4dpV3LgZKVos1sZnfMuxe')");
  });
});

//Basic http authentication
var Auth = express.basicAuth(function(user, pass, next) {
  userDB.get("SELECT password,salt FROM users WHERE username = ?", 'admin', function(err, row) {
    if (!err) {
      next(err, bcrypt.hashSync(pass, row.salt) === row.password);
    }
    else {
      next(err, false);
    }
  });
});

//Routes
app.get('/', Auth, function(req, res) {

  async.parallel([
      function(next) {
        JSONAPI.call('system.getJavaMemoryUsage', function(data) {
          checkSuccess(data, next);
        })
      }
    , function(next) {
        JSONAPI.call('system.getJavaMemoryTotal', function(data) {
          checkSuccess(data, next);
        })
      }
    , function(next) {
        var data = {
          'players': currentPlayers,
          'playerCount': currentPlayers.length
        };
        
        //todo get each player group prefix
        // currentPlayers.map(function(player) {
        //  JSONAPI get player group
        // });
        
        next(null, data);
      }
    , function(next) {
        JSONAPI.call('getLatestConsoleLogs', function(data) {
          checkSuccess(data, function(err, data) {
            if (!err) {
              var logs = data.success.map(function(log) {
                var message = "";
                log = ansi(log.line);
                
                log.map(function(chunk) {
                  if (chunk.foreground && chunk.foreground != 'white') {
                    message += "<font color='" + chunk.foreground + "'>"
                    message += chunk.text;
                    message += "</font>";
                  }
                  else {
                    message += chunk.text;
                  }
                });
                
                message = moment(message.substr(0, 20)).format("h:mm:ssa") + " " + message.substr(20);
              
                return message; 
              });
              
              next(null, logs);
            }
            else {
              next(err,data);
            }
          });
        })
      }
    , function (next) {
        JSONAPI.call('getServer', function(data) {
          checkSuccess(data, next);
        });
      }
  ], function(err, data) {
      if (!err) {
        res.render('manage', {  
            load: os.loadavg()
          , javaRam: data[0].success
          , javaTotal: data[1].success
          , totalRam: (os.totalmem() / 1000000)
          , players: data[2].players
          , playerCount: data[2].playerCount
          , console: data[3]
          , server: data[4].success
        }); 
      }
      else {
        res.send('Error communicating with minecraft server: ' + err + " Please check to make sure the information in your config.js file is correct.");
      }
  });
});

app.get('/settings', Auth, function(req, res) {
  var parts = req.headers.authorization.split(' ');
  var scheme = parts[0];
  
  if (scheme === 'Basic') {
    var authBuffer = new Buffer(parts[1], 'base64').toString().split(':');
    var username = authBuffer[0];
    
    res.render('settings',{username: username});
  }
  else {
    res.send(500);
  }
});

app.post('/password', Auth, function(req, res) {
  if (req.param('password','') != '' && req.param('password','') === req.param('passwordAgain','')) {
    var parts = req.headers.authorization.split(' ');
    var scheme = parts[0];
    
    if (scheme === 'Basic') {
      var authBuffer = new Buffer(parts[1], 'base64').toString().split(':');
      var username = authBuffer[0];
      var salt = bcrypt.genSaltSync(10);
      var hash = bcrypt.hashSync(req.param('password',''), salt);
      userDB.run("UPDATE users SET password = ?, salt = ? WHERE username = ?", [hash, salt, username], function(err) {
        if (err) {
          res.send({error: err});
        }
        else {
          res.redirect("/");
        }
      });
    }
    else {
      res.send(500);
    }
  }
});

function checkSuccess (data, next) {
  var err;
  if (data.result !== 'success') {
    if (data.error) {
      err = data.error;
    }
    else {
      err = 'Unknown Error';
    }
  }
  next(err, data);
}

//This sets up our streaming connections to jsonAPI
function dataStream() {
  JSONAPI.stream('console', false, function(json) {
    checkSuccess(json, function(err, json) {
      if (!err) {
        // console.log('console', json);
        mainEmitter.emit('console', ansi(json.success.line.trim()));
      }
      else {
        console.log("Connection stream error: " + err);
      }
    });
  });
  
  JSONAPI.stream('connections', true, function(json) {
    checkSuccess(json, function(err, json) {
      if (!err) {
        // console.log('connection', json);
        mainEmitter.emit('player', json.success);
        
        if (json.success.action === "connected") {
          if (currentPlayers.indexOf(json.success.player) === -1) {
            currentPlayers.push(json.success.player);
          }
        }
        else if (json.success.action === "disconnected") {
          var index = currentPlayers.indexOf(json.success.player);
          if (index !== -1) {
            currentPlayers.splice(index, 1);
          }
        }
        else {
          console.log("UNKNOWN ACTION: " + json.success.action);
        }
      }
      else {
        console.log("Connection stream error: " + err);
      }
    });
  });
  
  setInterval(function() {
    async.parallel([
        function(next) {
          try {
            JSONAPI.call('system.getJavaMemoryUsage', function(data) {
              checkSuccess(data, function(err, data) {
                if (!err) {
                  data = data.success;
                }
                next(err, data);
              });
            })
          }
          catch(e) {
            next(e);
          }
        }
      , function(next) {
          try {
            JSONAPI.call('system.getJavaMemoryTotal', function(data) {
              checkSuccess(data, function(err, data) {
                if (!err) {
                  data = data.success;
                }
                next(err, data);
              });
            })
          }
          catch(e) {
            next(e);
          }
        }
      , function(next) {
          next(null, os.totalmem() / 1000000);
        }
      , function(next) {
          next(null, os.loadavg());
        }
    ], function(err, results) {
        if (!err) {
          mainEmitter.emit('system', results);
        }
      }
    );
  }, 10000);
}
