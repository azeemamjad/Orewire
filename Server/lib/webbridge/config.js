'use strict';

const path = require('path');

const DEFAULTS = {
  httpHost: process.env.WEBBRIDGE_HTTP_HOST || '127.0.0.1',
  httpPort: Number(process.env.WEBBRIDGE_HTTP_PORT) || 10087,
  wsHost: process.env.WEBBRIDGE_WS_HOST || '127.0.0.1',
  wsPort: Number(process.env.WEBBRIDGE_WS_PORT) || 10086,
  heartbeatIntervalMs: Number(process.env.WEBBRIDGE_HEARTBEAT_MS) || 30_000,
  toolCallTimeoutMs: Number(process.env.WEBBRIDGE_TOOL_TIMEOUT_MS) || 60_000,
};

function loadConfig() {
  return { ...DEFAULTS };
}

function extensionDir() {
  return path.join(__dirname, '..', '..', 'public', 'webbridge-extension');
}

module.exports = { loadConfig, extensionDir, DEFAULTS };
