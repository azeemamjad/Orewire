'use strict';

const { readLocalConfig, updateLocalConfig } = require('./auth');

let listener = null;
let currentUrl = null;

function getPublicUrl() {
  return currentUrl;
}

function isNgrokConnected() {
  return !!currentUrl;
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function normalizeDomain(raw) {
  return (
    String(raw || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '') || undefined
  );
}

/** Prefer env → explicit arg → saved reserved domain (never ephemeral random hosts). */
function resolvePreferredDomain(explicit) {
  return (
    normalizeDomain(explicit) ||
    normalizeDomain(process.env.NGROK_DOMAIN || process.env.WEBBRIDGE_NGROK_DOMAIN) ||
    normalizeDomain(readLocalConfig()?.ngrokDomain)
  );
}

async function stopNgrokTunnel() {
  if (listener) {
    try {
      await listener.close();
    } catch {
      /* ignore */
    }
    listener = null;
  }
  currentUrl = null;
  try {
    const ngrok = require('@ngrok/ngrok');
    if (typeof ngrok.disconnect === 'function') await ngrok.disconnect();
  } catch {
    /* ignore */
  }
}

async function startNgrokTunnel({ authtoken, httpPort, domain } = {}) {
  const token = String(
    authtoken || process.env.NGROK_AUTHTOKEN || readLocalConfig()?.ngrokAuthtoken || '',
  ).trim();
  if (!token || token.length < 16) throw new Error('Invalid ngrok authtoken');

  const ngrok = require('@ngrok/ngrok');
  const preferred = resolvePreferredDomain(domain);

  await stopNgrokTunnel();

  const forwardOpts = { addr: httpPort, authtoken: token };
  if (preferred) forwardOpts.domain = preferred;

  try {
    listener = await ngrok.forward(forwardOpts);
  } catch (err) {
    if (preferred) {
      console.warn(
        `[webbridge/ngrok] Domain "${preferred}" failed (${err.message || err}); trying without domain`,
      );
      listener = await ngrok.forward({ addr: httpPort, authtoken: token });
    } else {
      throw err;
    }
  }

  const url = listener.url();
  if (!url) throw new Error('ngrok started but returned no URL');

  currentUrl = url.replace(/\/+$/, '');
  const host = hostnameFromUrl(currentUrl);

  // Keep the reserved domain preference if we have one; only persist host when it matches or no preference
  const domainToSave = preferred || host || undefined;

  updateLocalConfig({
    ngrokAuthtoken: token,
    ngrokDomain: domainToSave,
    publicUrl: currentUrl,
  });

  console.log(`[webbridge/ngrok] Public URL: ${currentUrl}`);
  return { url: currentUrl, domain: host };
}

async function restoreNgrokTunnel(httpPort) {
  const cfg = readLocalConfig();
  const token = (cfg?.ngrokAuthtoken || process.env.NGROK_AUTHTOKEN || '').trim();
  if (!token) return null;
  try {
    const { url } = await startNgrokTunnel({
      authtoken: token,
      httpPort,
      domain: resolvePreferredDomain(cfg?.ngrokDomain),
    });
    return url;
  } catch (err) {
    console.warn('[webbridge/ngrok] Auto-restore failed:', err.message || err);
    return null;
  }
}

module.exports = {
  getPublicUrl,
  isNgrokConnected,
  startNgrokTunnel,
  stopNgrokTunnel,
  restoreNgrokTunnel,
  resolvePreferredDomain,
};
