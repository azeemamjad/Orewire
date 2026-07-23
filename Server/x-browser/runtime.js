'use strict';

/** Shared in-process X Browser runtime (manager + screencast). */
const { HostedBrowserManager } = require('./manager');
const { ScreencastHub } = require('./screencast');

let runtime = null;

function getRuntime() {
  if (!runtime) {
    const manager = new HostedBrowserManager();
    const screencast = new ScreencastHub(manager);
    runtime = { manager, screencast, embedded: false, mountPath: '' };
  }
  return runtime;
}

function markEmbedded(mountPath) {
  const rt = getRuntime();
  rt.embedded = true;
  rt.mountPath = mountPath || '/x-browser';
  return rt;
}

function isEmbedded() {
  return !!(runtime && runtime.embedded);
}

function viewerUrlFromRequest(req) {
  const rt = getRuntime();
  if (!rt.embedded) return null;
  const proto = req?.protocol || 'https';
  const host = req?.get?.('host') || 'localhost';
  return `${proto}://${host}${rt.mountPath}/login`;
}

module.exports = {
  getRuntime,
  markEmbedded,
  isEmbedded,
  viewerUrlFromRequest,
};
