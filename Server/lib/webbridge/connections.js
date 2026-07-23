'use strict';

const { randomUUID } = require('crypto');

/**
 * Tracks Chrome extension WebSocket connections and routes tool calls.
 */
class ConnectionManager {
  constructor(config) {
    this.config = config;
    this.connections = new Map();
    this.messageHandlers = new Set();
    this.heartbeatTimers = new Map();
    this.nextId = 1;
    this.pending = new Map();
  }

  addConnection(transport) {
    const id = `ext-${this.nextId++}`;
    const conn = { id, transport, connectedAt: Date.now() };
    this.connections.set(id, conn);
    console.log(`[webbridge] Extension connected: ${id}`);

    transport.onMessage((msg) => {
      if (msg.type === 'hello') {
        conn.extensionVersion = msg.payload?.extensionVersion;
        transport.send({ type: 'hello_ack', payload: { daemonVersion: '0.1.0-orewire' } });
        console.log(`[webbridge] ${id} hello — extension v${conn.extensionVersion}`);
      }
      if (msg.type === 'tool_result') {
        this._handleResult(msg);
      }
      for (const h of this.messageHandlers) h(msg);
    });

    transport.onClose(() => this.removeConnection(id));
    this._startHeartbeat(id);
    return id;
  }

  removeConnection(id) {
    const conn = this.connections.get(id);
    if (!conn) return;
    this._stopHeartbeat(id);
    try {
      conn.transport.close();
    } catch {
      /* ignore */
    }
    this.connections.delete(id);
    console.log(`[webbridge] Extension disconnected: ${id}`);
  }

  getActiveTransport() {
    const first = this.connections.values().next();
    return first.done ? undefined : first.value.transport;
  }

  getConnectionCount() {
    return this.connections.size;
  }

  onMessage(handler) {
    this.messageHandlers.add(handler);
  }

  callTool(name, args = {}) {
    const transport = this.getActiveTransport();
    if (!transport) return Promise.reject(new Error('No extension connected — open Chrome with OreWire Bridge loaded'));

    const requestId = randomUUID();
    const message = {
      type: 'tool_call',
      requestId,
      payload: { name, args },
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Tool "${name}" timed out after ${this.config.toolCallTimeoutMs}ms`));
      }, this.config.toolCallTimeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });
      transport.send(message);
    });
  }

  _handleResult(msg) {
    const pending = this.pending.get(msg.responseToRequestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.responseToRequestId);
    pending.resolve(msg.payload || {});
  }

  _startHeartbeat(id) {
    const timer = setInterval(() => {
      const conn = this.connections.get(id);
      if (!conn) {
        this._stopHeartbeat(id);
        return;
      }
      conn.transport.send({ type: 'ping', timestamp: Date.now() });
    }, this.config.heartbeatIntervalMs);
    this.heartbeatTimers.set(id, timer);
  }

  _stopHeartbeat(id) {
    const timer = this.heartbeatTimers.get(id);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(id);
    }
  }
}

function wrapWsTransport(ws) {
  const messageHandlers = new Set();
  const closeHandlers = new Set();

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      for (const h of messageHandlers) h(msg);
    } catch {
      console.error('[webbridge] Invalid WS message');
    }
  });
  ws.on('close', () => {
    for (const h of closeHandlers) h();
  });
  ws.on('error', (err) => {
    console.error('[webbridge] WS error:', err.message || err);
  });

  return {
    send(message) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    },
    onMessage(handler) {
      messageHandlers.add(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
    },
    close() {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

module.exports = { ConnectionManager, wrapWsTransport };
