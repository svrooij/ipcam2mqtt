const log = require('yalm')
const config = require('./config.js')
const mqtt = require('mqtt')
const pkg = require('../package.json')
const FtpServer = require('@svrooij/ftpd').FtpServer
const os = require('os')
const path = require('path')
const fs = require('fs')

let client
let timeouts = []
let server
let currentStatus = 0
const tempdir = path.join(os.tmpdir(), pkg.name)

function start () {
  log.setLevel(config.logging)
  log.info(pkg.name + ' ' + pkg.version + ' starting')

  const mqttOptions = { will: {
    topic: config.name + '/connected',
    message: 0,
    qos: 0
  }}

  client = mqtt.connect(config.mqtt, mqttOptions)
  setupMqttLogging()

  // Create root dir for uploads
  fs.access(tempdir, fs.constants.R_OK, (err) => {
    if (err) {
      fs.mkdir(tempdir, (err2) => {
        if (err2) { throw err2 }
        setupFtp()
      })
    } else {
      setupFtp()
    }
  })

  process.on('SIGINT', function () {
    server.close()
    fs.rmdir(tempdir, (err) => {
      if (err) {
        log.debug('Could not delete temp folder', err)
      }
    })
    log.info('Waiting %d seconds for possible clear events that are scheduled', config.timeout)
    // graceful shutdown
    setTimeout(function () {
      process.exit()
    }, config.timeout * 1000)
  })
}

function setupMqttLogging () {
  client.on('connect', () => {
    // Inform controllers we are connected to mqtt (but not yet to the hardware).
    log.info('Connected to MQTT server.')
    publishConnectionStatus('1')
  })

  client.on('close', () => {
    log.info('mqtt closed ' + config.mqtt)
  })

  client.on('error', err => {
    log.error('mqtt', err.toString())
  })

  client.on('offline', () => {
    log.error('mqtt offline')
  })

  client.on('reconnect', () => {
    log.info('mqtt reconnect')
  })
}

function setupFtp () {
  server = new FtpServer('127.0.0.1', {
    getInitialCwd: function () {
      return tempdir
    },
    getRoot: function () {
      // return process.cwd() // Wonder what this does, maybe create a special directory for temporary saving the files...
      return process.cwd()
    },
    useWriteFile: true,
    useReadFile: true,
    maxStatsAtOnce: 0
  })

  server.on('client:connected', handleClient)
  server.on('error', function (err) {
    log.error('FTP Server error', err)
    // Should we exit?
  })
  server.on('close', function () {
    log.info('FTP Server closed')
    publishConnectionStatus('1')
  })
  server.listen(config.port)
  log.info('Started FTP server on port %d', config.port)
}

function publishConnectionStatus (status) {
  if (currentStatus === status) {
    return
  }
  currentStatus = status
   // 1 for mqtt online two for connected to hardware (should this be 2 after first image?)
  client.publish(config.name + '/connected', status, {
    qos: 0,
    retain: true
  })
}

/**
 * Get the topic name for a given item
 * @method getTopicFor
 * @param  {String}    device   Device Name
 * @param  {String}    type     Output type
 * @return {String}             MQTT Topic name
 */
function getTopicFor (device, type) {
  return [config.name, device, type].join('/')
}

/**
 * Notify the broker that something triggered
 * @method notifyMQTT
 * @param  {String} device      Identifier for the camera
 * @param  {String} filestream  Stream with image data
 * @param  {String} filename    The name of the file
 */
function notifyMQTT (device, filestream, filename) {
  publishState(device, (filestream ? 'active' : 'inactive'), filename)
  publishImage(device, filestream)
}

/**
 * Receive writeFile events from camera
 * @method cameraEvent
 * @param  {String} id          Username
 * @param  {String} file        Filename of uploaded file
 * @param  {String} contents    Stream with image data
 * @param  {String} callback    Callback funtion
 */
function cameraEvent (id, file, contents, callback) {
  // log.debug('CameraEvent called with arguments: ', arguments)
  log.info('Motion detected for %s', id)

  // Auto clear after x seconds
  if (config.timeout > 0) {
    clearTimeout(timeouts[id])
    timeouts[id] = setTimeout(notifyMQTT.bind(null, id, null), config.timeout * 1000)
  }

  notifyMQTT(id, contents, file)

  publishConnectionStatus('2')

  if (typeof (callback) === 'function') {
    callback()
  }
}

function handleClient (connection) {
  const address = connection.socket.remoteAddress + ':' + connection.socket.remotePort
  let identifier

  // Receive username
  connection.on('command:user', function (user, success, failure) {
    if (!user) {
      return failure()
    }
    identifier = user
    success()
  })

  // Copied from https://github.com/stjohnjohnson/mqtt-camera-ftpd/blob/master/server.js#L136-L162
  // Not really sure how this works
  connection.on('command:pass', function (pass, success, failure) {
    if (!pass) {
      return failure()
    }
    success(identifier, {
      writeFile: cameraEvent.bind(null, identifier),
      readFile: noop(),
      unlink: noopOk(),
      readdir: noop(),
      mkdir: noop(),
      open: noop(),
      close: noop(),
      rmdir: noop(),
      rename: noop(),
      stat: function (file) {
        // log.debug('Stat called with arguments: ', arguments)

        var callback = arguments[arguments.length - 1]
        if (typeof (callback) === 'function') {
          if (file[file.length - 1] === path.sep) {
            callback(null, {
              mode: '0666',
              isDirectory: function () {
                return true
              },
              size: 1,
              mtime: 1
            })
          } else {
            fs.stat(file, callback)
          }
        }
      }
    })
  })

  connection.on('close', function () {
    // @TODO find out where "Client connection closed" is coming from
    log.debug('client %s disconnected', address)
  })

  connection.on('error', function (error) {
    log.error('client %s had an error: %s', address, error.toString())
  })
}

/**
 * Return a function that fails on call
 * @method noop
 * @return {Function} Yield error on function call
 */
function noop () {
  return function () {
    var callback = arguments[arguments.length - 1]
    callback(new Error('Not implemented'))
  }
}

/**
 * Return a function that continues on call
 * @method noopOk
 * @return {Function} Function that calls callback with success
 */
function noopOk () {
  return function () {
    var callback = arguments[arguments.length - 1]
    callback(null)
  }
}

/**
 * Guess the king of alarm, by filename
 * @method guessKind
 * @param  {String} filename      Filename of snapshot
 * @return {String} Returns either Unknown or Sound
 */
function guessKind (filename) {
  let kind = 'Unknown'

  if (filename.indexOf('SD') === 0) { // Foscam sound detector
    kind = 'Sound'
  }
  return kind
}

/**
 * Publish the new state of a device.
 * @method publishState
 * @param  {String} device      Name of the device
 * @param  {String} newState    The new state of the device
 * @param  {String} filename    Filename of snapshot
 * @return {void}
 */
function publishState (device, newState, filename) {
  log.debug('Publishing %s for %s', newState, device)
  const topic = getTopicFor(device, 'motion')
  let data = {
    val: newState,
    name: device,
    ts: Date.now()
  }

  if (filename) {
    filename = filename.substr(filename.lastIndexOf(path.sep) + 1)
    log.debug('Image filename is %s', filename)
    data.filename = filename
    data.kind = guessKind(filename)
  }

  client.publish(
        topic,
        JSON.stringify(data),
        {qos: 0, retain: true}
    )
}

/**
 * Publish the new image for a device.
 * @method publishImage
 * @param  {String} device  Name of the device
 * @param  {Stream} image   The new image
 * @return {void}
 */
function publishImage (device, image) {
  const topic = getTopicFor(device, 'image')
  if (image) {
    log.debug('Publishing new image for %s', device)
    client.publish(
      topic,
      image,
      {qos: 0, retain: true}
    )
  } else if (config.keepImages !== true) {
    log.debug('Clearing image for %s', device)
    client.publish(
      topic,
      null,
      {qos: 0, retain: true}
    )
  }
}

start()
