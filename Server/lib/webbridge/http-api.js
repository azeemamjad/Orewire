'use strict';

const http = require('http');
const { URL } = require('url');
const {
  extractBearer,
  isLoopbackIp,
  readLocalConfig,
} = require('./auth');
const {
  getPublicUrl,
  isNgrokConnected,
  startNgrokTunnel,
  stopNgrokTunnel,
} = require('./ngrok');
const { postXThread } = require('./post-x-thread');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket?.remoteAddress;
}

function createHttpServer({ config, authToken, connectionManager }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathName = url.pathname;
    const method = req.method || 'GET';
    const ip = clientIp(req);

    try {
      if (pathName === '/api/health' && method === 'GET') {
        return sendJson(res, 200, { ok: true, version: '0.1.0-orewire' });
      }

      if (pathName.startsWith('/api/local/')) {
        if (!isLoopbackIp(ip)) {
          return sendJson(res, 403, { error: 'Local setup API is only available on this machine' });
        }

        if (pathName === '/api/local/connection' && method === 'GET') {
          const cfg = readLocalConfig();
          return sendJson(res, 200, {
            ok: true,
            daemonConnected: true,
            extensionConnections: connectionManager.getConnectionCount(),
            ngrokConnected: isNgrokConnected(),
            publicUrl: getPublicUrl() || cfg?.publicUrl || null,
            bridgeToken: authToken,
            ngrokConfigured: !!(cfg?.ngrokAuthtoken || process.env.NGROK_AUTHTOKEN),
            ngrokDomain: cfg?.ngrokDomain || null,
          });
        }

        if (pathName === '/api/local/ngrok' && method === 'POST') {
          const body = await readBody(req);
          const cfg = readLocalConfig();
          const authtoken = String(body.authtoken || cfg?.ngrokAuthtoken || process.env.NGROK_AUTHTOKEN || '').trim();
          const domain = body.domain != null ? String(body.domain).trim() : undefined;
          if (!authtoken) {
            return sendJson(res, 400, {
              error: 'authtoken required (paste once in the extension, or set NGROK_AUTHTOKEN)',
            });
          }
          try {
            const { url: publicUrl } = await startNgrokTunnel({
              authtoken,
              httpPort: config.httpPort,
              domain: domain || undefined,
            });
            return sendJson(res, 200, {
              ok: true,
              publicUrl,
              bridgeToken: authToken,
              message: 'Tunnel up — paste publicUrl + bridgeToken into OreWire Admin',
            });
          } catch (err) {
            return sendJson(res, 400, { ok: false, error: err.message || String(err) });
          }
        }

        if (pathName === '/api/local/ngrok/stop' && method === 'POST') {
          await stopNgrokTunnel();
          return sendJson(res, 200, { ok: true });
        }

        return sendJson(res, 404, { error: 'Not found' });
      }

      if (pathName === '/api/status' || pathName === '/api/tool') {
        const token = extractBearer(req.headers.authorization);
        if (!token || token !== authToken) {
          return sendJson(res, 401, { error: 'Unauthorized — Bearer token required' });
        }
      }

      if (pathName === '/api/status' && method === 'GET') {
        return sendJson(res, 200, {
          status: 'ok',
          connections: connectionManager.getConnectionCount(),
          version: '0.1.0-orewire',
          publicUrl: getPublicUrl(),
          tools: ['post_x_thread'],
        });
      }

      if (pathName === '/api/tool' && method === 'POST') {
        const body = await readBody(req);
        const name = body.name;
        const args = body.args || {};
        if (!name) return sendJson(res, 400, { error: 'Missing tool name' });

        try {
          if (name === 'post_x_thread') {
            const data = await postXThread(connectionManager, args);
            return sendJson(res, 200, { data });
          }
          const result = await connectionManager.callTool(name, args);
          if (result.error) return sendJson(res, 500, { error: result.error });
          return sendJson(res, 200, { data: result.data });
        } catch (err) {
          return sendJson(res, 502, { error: err.message || String(err) });
        }
      }

      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || String(err) });
    }
  });
}

module.exports = { createHttpServer };
