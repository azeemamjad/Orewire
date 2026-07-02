const path = require('path');

const minio = require('./minio-storage');
const aws = require('./aws-s3-storage');

const { MINIO_PREFIX } = minio;
const S3_PREFIX = 's3:';

function getFilingPrefix() {
  return (process.env.STORAGE_FILING_PREFIX || process.env.MINIO_FILING_PREFIX || 'filings').replace(/\/+$/, '');
}

function usePresignedUrls() {
  return process.env.AWS_S3_PRESIGNED_URLS !== 'false';
}

function presignExpiresSec() {
  const n = parseInt(process.env.AWS_S3_PRESIGN_EXPIRES_SEC || '3600', 10);
  return Number.isFinite(n) && n >= 60 ? n : 3600;
}

function isStorageEnabled() {
  return aws.isAwsS3Enabled();
}

function isS3Path(pdfPath) {
  return typeof pdfPath === 'string' && pdfPath.startsWith(S3_PREFIX);
}

function isPublicStorageUrl(pdfPath) {
  return typeof pdfPath === 'string' && pdfPath.startsWith('https://');
}

function isRemoteStoragePath(pdfPath) {
  return minio.isMinioLegacyPath(pdfPath) || isS3Path(pdfPath) || isPublicStorageUrl(pdfPath);
}

/** @deprecated alias — true for legacy minio:, s3:, and public HTTPS URLs */
function isMinioPath(pdfPath) {
  return isRemoteStoragePath(pdfPath);
}

function toS3Path(objectKey) {
  return `${S3_PREFIX}${objectKey.replace(/^\/+/, '')}`;
}

function parseS3Path(pdfPath) {
  if (!isS3Path(pdfPath)) return null;
  return pdfPath.slice(S3_PREFIX.length);
}

function parsePublicUrlToKey(url) {
  const base = aws.publicBaseUrl();
  if (url.startsWith(base + '/')) {
    return url.slice(base.length + 1);
  }
  try {
    const u = new URL(url);
    const pathname = u.pathname.replace(/^\/+/, '');
    const bucket = aws.getBucket();
    if (bucket && pathname.startsWith(bucket + '/')) {
      return pathname.slice(bucket.length + 1);
    }
    return pathname;
  } catch {
    return null;
  }
}

function parseStoragePath(pdfPath) {
  if (isS3Path(pdfPath)) return parseS3Path(pdfPath);
  if (minio.isMinioLegacyPath(pdfPath)) return minio.parseMinioLegacyPath(pdfPath);
  if (isPublicStorageUrl(pdfPath)) return parsePublicUrlToKey(pdfPath);
  return null;
}

/** @deprecated alias for parseStoragePath */
function parseMinioPath(pdfPath) {
  return parseStoragePath(pdfPath);
}

function toStoragePath(objectKey) {
  if (!isStorageEnabled()) {
    throw new Error('Object storage is not configured (set AWS_S3_ENABLED=true)');
  }
  if (usePresignedUrls()) return toS3Path(objectKey);
  return aws.publicUrl(objectKey);
}

/** DB value after upload/migration */
function toDbStoragePath(objectKey) {
  return toStoragePath(objectKey);
}

/** @deprecated alias for toStoragePath when AWS is enabled; legacy minio: prefix otherwise */
function toMinioPath(objectKey) {
  if (isStorageEnabled()) return toStoragePath(objectKey);
  return minio.toMinioPath(objectKey);
}

function localPathToObjectKey(localPath, downloadsDir) {
  const resolved = path.resolve(localPath);
  const base = path.resolve(downloadsDir);
  if (resolved === base || resolved.startsWith(base + path.sep)) {
    return path.relative(base, resolved).split(path.sep).join('/');
  }
  return `${path.basename(path.dirname(resolved))}/${path.basename(resolved)}`;
}

async function persistFilingPdf(localPath, objectKey) {
  if (!isStorageEnabled()) return localPath;
  if (!(await objectExists(objectKey))) {
    await uploadFile(localPath, objectKey);
  }
  return toDbStoragePath(objectKey);
}

async function ensureBucket() {
  return aws.ensureBucket();
}

async function objectExists(objectKey) {
  return aws.objectExists(objectKey);
}

async function statObject(objectKey) {
  const head = await aws.headObject(objectKey);
  return {
    size: head.size,
    etag: head.etag,
    metaData: { 'content-type': head.contentType || 'application/pdf' },
  };
}

async function uploadFile(localPath, objectKey, opts) {
  return aws.uploadFile(localPath, objectKey, opts);
}

async function getObjectStream(objectKey) {
  return aws.getObjectStream(objectKey);
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

async function resolveDocumentRedirect(pdfPath) {
  const objectKey = parseStoragePath(pdfPath);
  if (!objectKey) return null;

  if (isStorageEnabled()) {
    if (usePresignedUrls() || isS3Path(pdfPath) || minio.isMinioLegacyPath(pdfPath)) {
      return aws.presignedGetUrl(objectKey, { expiresIn: presignExpiresSec() });
    }
    if (isPublicStorageUrl(pdfPath)) {
      return aws.presignedGetUrl(objectKey, { expiresIn: presignExpiresSec() });
    }
    return aws.publicUrl(objectKey);
  }

  if (minio.isMinioEnabled() && minio.isMinioLegacyPath(pdfPath)) return null;
  return null;
}

module.exports = {
  MINIO_PREFIX,
  S3_PREFIX,
  getFilingPrefix,
  usePresignedUrls,
  presignExpiresSec,
  isStorageEnabled,
  isAwsS3Enabled: aws.isAwsS3Enabled,
  isMinioEnabled: minio.isMinioEnabled,
  isS3Path,
  isPublicStorageUrl,
  isRemoteStoragePath,
  isMinioPath,
  isMinioLegacyPath: minio.isMinioLegacyPath,
  toS3Path,
  toStoragePath,
  toDbStoragePath,
  toMinioPath,
  parseStoragePath,
  parseS3Path,
  parseMinioPath,
  publicUrl: aws.publicUrl,
  presignedGetUrl: aws.presignedGetUrl,
  resolveDocumentRedirect,
  localPathToObjectKey,
  persistFilingPdf,
  ensureBucket,
  objectExists,
  statObject,
  uploadFile,
  getObjectStream,
  streamToResponse,
  describeAwsConfig: aws.describeClientConfig,
  describeMinioConfig: minio.describeClientConfig,
  getMinioClient: minio.getClient,
  getMinioBucket: minio.getBucket,
  minioObjectExists: minio.objectExists,
  minioStatObject: minio.statObject,
  minioUploadFile: minio.uploadFile,
  minioGetObjectStream: minio.getObjectStream,
  minioListObjects: minio.listObjects,
  minioEnsureBucket: minio.ensureBucket,
  parseMinioLegacyPath: minio.parseMinioLegacyPath,
  toMinioLegacyPath: minio.toMinioPath,
};
