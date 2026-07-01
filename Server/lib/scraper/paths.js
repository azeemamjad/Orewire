const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '../..');

const DOWNLOADS_DIR = path.resolve(
  process.env.DOWNLOADS_DIR || path.join(SERVER_ROOT, 'data/downloads'),
);

const COOKIE_FILE = path.resolve(
  process.env.COOKIE_FILE || path.join(SERVER_ROOT, 'data/cookies.json'),
);

function serverRoot() {
  return process.env.OREWIRE_SERVER_PATH
    ? path.resolve(process.env.OREWIRE_SERVER_PATH)
    : SERVER_ROOT;
}

module.exports = {
  SERVER_ROOT,
  DOWNLOADS_DIR,
  COOKIE_FILE,
  serverRoot,
};
