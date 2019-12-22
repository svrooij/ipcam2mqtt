const pkg = require('../package.json')
const config = require('yargs')
  .env('IPCAM2MQTT')
  .usage(pkg.name + ' ' + pkg.version + '\r\nUsage: $0 [options]')
  .describe('m', 'mqtt broker url. See https://github.com/svrooij/ipcam2mqtt#mqtt-url')
  .describe('i', 'instance name. used as mqtt client id and as topic prefix')
  .describe('p', 'The port to run on')
  .describe('timeout', 'The timeout in seconds for resetting back to inactive, -1 for no reset')
  .describe('k', 'Set this if you want to keep the images in mqtt')
  .describe('h', 'Show this help')
  .describe('v', 'Set the verbosity.')
  .alias({
    h: 'help',
    v: 'verbosity',
    m: 'mqtt',
    i: 'instance',
    p: 'port',
    k: 'keep-images'
  })
  .default({
    v: 'info',
    m: 'mqtt://127.0.0.1',
    i: 'cameras',
    p: 8000,
    timeout: 10
  })
  .choices('v', ['error', 'warn', 'info', 'debug'])
  .boolean(['k'])
  .version()
  .help('help')
  .argv

module.exports = config
