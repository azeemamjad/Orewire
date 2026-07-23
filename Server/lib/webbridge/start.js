'use strict';

/**
 * OreWire WebBridge — runs inside `node index.js` when WEBBRIDGE=1.
 * Talks to the Chrome extension over WebSocket; exposes HTTP for OreWire + local popup.
 */
const { WebSocketServer } = require('ws');
const { loadConfig, extensionDir } = require('./config');
const { loadOrCreateAuthToken } = require('./auth');
const { ConnectionManager, wrapWsTransport } = require('./connections');
const { createHttpServer } = require('./http-api');
const { restoreNgrokTunnel, getPublicUrl } = require('./ngrok');

let started = false;

async function startWebBridge() {
  if (started) {
    console.log('[webbridge] Already running');
    return;
  }
  started = true;

  const config = loadConfig();
  const authToken = loadOrCreateAuthToken();
  const connectionManager = new ConnectionManager(config);

  const wss = new WebSocketServer({
    host: config.wsHost,
    port: config.wsPort,
    path: '/ws',
  });
  wss.on('listening', () => {
    console.log(`[webbridge] WS  ws://${config.wsHost}:${config.wsPort}/ws`);
  });
  wss.on('connection', (ws) => {
    connectionManager.addConnection(wrapWsTransport(ws));
  });
  wss.on('error', (err) => {
    console.error('[webbridge] WS server error:', err.message || err);
  });

  const httpServer = createHttpServer({ config, authToken, connectionManager });
  await new Promise((resolve, reject) => {
    httpServer.listen(config.httpPort, config.httpHost, (err) => (err ? reject(err) : resolve()));
  });
  console.log(`[webbridge] HTTP http://${config.httpHost}:${config.httpPort}`);
  console.log(`[webbridge] Extension folder: ${extensionDir()}`);
  console.log('[webbridge] Load unpacked extension from that folder in Chrome, then paste ngrok authtoken in the popup');

  const publicUrl = await restoreNgrokTunnel(config.httpPort);
  if (publicUrl) {
    console.log(`[webbridge] Public tunnel: ${publicUrl}`);
  } else {
    console.log('[webbridge] No ngrok tunnel yet — open OreWire Bridge popup and paste ngrok authtoken');
  }

  return {
    config,
    authToken,
    getPublicUrl,
    connectionManager,
  };
}

module.exports = { startWebBridge };
