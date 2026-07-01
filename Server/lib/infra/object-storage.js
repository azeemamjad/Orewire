const fs = require('fs');
const path = require('path');

const MINIO_PREFIX = 'minio:';

function isMinioEnabled() {
  return process.env.MINIO_ENABLED === 'true'
    && !!process.env.MINIO_ACCESS_KEY
    && !!process.env.MINIO_SECRET_KEY
    && !!process.env.MINIO_BUCKET;
}

function isMinioPath(pdfPath) {
  return typeof pdfPath === 'string' && pdfPath.startsWith(MINIO_PREFIX);
}

function toMinioPath(objectKey) {
  return `${MINIO_PREFIX}${objectKey.replace(/^\/+/, '')}`;
}

function parseMinioPath(pdfPath) {
  if (!isMinioPath(pdfPath)) return null;
  return pdfPath.slice(MINIO_PREFIX.length);
}

function parseEndpoint(raw) {
  const useSSL = process.env.MINIO_USE_SSL === 'true';
  if (!raw) {
    return { host: 'localhost', port: useSSL ? 443 : 9000, useSSL };
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const u = new URL(raw);
    const ssl = u.protocol === 'https:';
    return {
      host: u.hostname,
      port: u.port ? parseInt(u.port, 10) : (ssl ? 443 : 80),
      useSSL: ssl,
    };
  }
  return {
    host: raw.replace(/\/+$/, ''),
    port: parseInt(process.env.MINIO_PORT || (useSSL ? '443' : '9000'), 10),
    useSSL,
  };
}

/** Path-style URLs (host/bucket/key) work behind Traefik/Dokploy reverse proxies. */
function usePathStyle() {
  if (process.env.MINIO_PATH_STYLE === 'false') return false;
  if (process.env.MINIO_PATH_STYLE === 'true') return true;
  // Default on for public hostnames — virtual-hosted style needs bucket DNS records.
  const host = parseEndpoint(process.env.MINIO_ENDPOINT || '').host;
  return host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.internal');
}

function buildClientOptions() {
  const { host, port, useSSL } = parseEndpoint(process.env.MINIO_ENDPOINT || 'localhost');
  const region = (process.env.MINIO_REGION || '').trim();
  return {
    endPoint: host,
    port,
    useSSL,
    accessKey: (process.env.MINIO_ACCESS_KEY || '').trim(),
    secretKey: (process.env.MINIO_SECRET_KEY || '').trim(),
    region: region || undefined,
    pathStyle: usePathStyle(),
  };
}

let client;

function resetClient() {
  client = null;
}

function isRetryableMinioError(err) {
  const msg = `${err?.code || ''} ${err?.message || ''}`.toLowerCase();
  return (
    msg.includes('credentials')
    || msg.includes('access denied')
    || msg.includes('signature')
    || msg.includes('timeout')
    || msg.includes('econnreset')
    || msg.includes('socket')
    || msg.includes('503')
    || msg.includes('429')
    || msg.includes('502')
    || msg.includes('bad gateway')
  );
}

async function withRetry(fn, { label = 'minio', retries = 4 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !isRetryableMinioError(err)) throw err;
      resetClient();
      const wait = Math.min(30_000, 500 * (2 ** attempt));
      console.warn(`[${label}] retry ${attempt + 1}/${retries} in ${wait}ms: ${err.message}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

function uploadDelayMs() {
  return Math.max(0, parseInt(process.env.MINIO_UPLOAD_DELAY_MS || '75', 10));
}

async function pauseBetweenUploads() {
  const ms = uploadDelayMs();
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

function getClient() {
  if (!isMinioEnabled()) {
    throw new Error('MinIO is not configured (set MINIO_ENABLED=true and credentials)');
  }
  if (client) return client;

  const Minio = require('minio');
  const opts = buildClientOptions();
  client = new Minio.Client(opts);

  return client;
}

/** For diagnostics — safe to log (no secrets). */
function describeClientConfig() {
  const opts = buildClientOptions();
  return {
    endPoint: opts.endPoint,
    port: opts.port,
    useSSL: opts.useSSL,
    pathStyle: opts.pathStyle,
    region: opts.region || '(default)',
    bucket: getBucket(),
    accessKeySet: !!opts.accessKey,
    secretKeySet: !!opts.secretKey,
  };
}

function getBucket() {
  return process.env.MINIO_BUCKET;
}

async function ensureBucket() {
  const minio = getClient();
  const bucket = getBucket();
  const exists = await minio.bucketExists(bucket);
  if (!exists) {
    await minio.makeBucket(bucket, process.env.MINIO_REGION || '');
    console.log(`[minio] Created bucket "${bucket}"`);
  }
  return bucket;
}

function localPathToObjectKey(localPath, downloadsDir) {
  const resolved = path.resolve(localPath);
  const base = path.resolve(downloadsDir);
  if (resolved === base || resolved.startsWith(base + path.sep)) {
    return path.relative(base, resolved).split(path.sep).join('/');
  }
  return `${path.basename(path.dirname(resolved))}/${path.basename(resolved)}`;
}

async function objectExists(objectKey) {
  try {
    await withRetry(() => getClient().statObject(getBucket(), objectKey), { label: 'stat' });
    return true;
  } catch (err) {
    if (err?.code === 'NotFound' || err?.code === 'NoSuchKey') return false;
    throw err;
  }
}

async function statObject(objectKey) {
  return withRetry(() => getClient().statObject(getBucket(), objectKey), { label: 'stat' });
}

async function uploadFile(localPath, objectKey, { contentType = 'application/pdf' } = {}) {
  const bucket = getBucket();
  const meta = { 'Content-Type': contentType };
  await withRetry(
    () => getClient().fPutObject(bucket, objectKey, localPath, meta),
    { label: 'upload', retries: 5 },
  );
  await pauseBetweenUploads();
  return { bucket, key: objectKey };
}

async function getObjectStream(objectKey) {
  return getClient().getObject(getBucket(), objectKey);
}

async function streamToResponse(objectKey, res, { filename = 'filing.pdf' } = {}) {
  const stat = await statObject(objectKey);
  res.setHeader('Content-Type', stat.metaData?.['content-type'] || 'application/pdf');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  const stream = await getObjectStream(objectKey);
  stream.on('error', (err) => {
    if (!res.headersSent) res.status(502).json({ error: err.message });
    else res.destroy();
  });
  stream.pipe(res);
}

module.exports = {
  MINIO_PREFIX,
  isMinioEnabled,
  isMinioPath,
  toMinioPath,
  parseMinioPath,
  getClient,
  resetClient,
  getBucket,
  ensureBucket,
  describeClientConfig,
  buildClientOptions,
  localPathToObjectKey,
  objectExists,
  statObject,
  uploadFile,
  getObjectStream,
  streamToResponse,
};
