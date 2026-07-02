const fs = require('fs');
const {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let client;

function isAwsS3Enabled() {
  return process.env.AWS_S3_ENABLED === 'true'
    && !!process.env.AWS_S3_BUCKET
    && !!process.env.AWS_ACCESS_KEY_ID
    && !!process.env.AWS_SECRET_ACCESS_KEY;
}

function getRegion() {
  return (process.env.AWS_REGION || 'us-east-1').trim();
}

function getBucket() {
  return process.env.AWS_S3_BUCKET;
}

function resetClient() {
  client = null;
}

function getClient() {
  if (!isAwsS3Enabled()) {
    throw new Error('AWS S3 is not configured (set AWS_S3_ENABLED=true, bucket, and credentials)');
  }
  if (client) return client;

  client = new S3Client({
    region: getRegion(),
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
    },
  });

  return client;
}

function describeClientConfig() {
  return {
    region: getRegion(),
    bucket: getBucket(),
    publicBaseUrl: publicBaseUrl(),
    accessKeySet: !!process.env.AWS_ACCESS_KEY_ID,
    secretKeySet: !!process.env.AWS_SECRET_ACCESS_KEY,
  };
}

function publicBaseUrl() {
  const override = (process.env.AWS_S3_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (override) return override;
  const bucket = getBucket();
  const region = getRegion();
  if (region === 'us-east-1') {
    return `https://${bucket}.s3.amazonaws.com`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com`;
}

function publicUrl(objectKey) {
  const key = objectKey.replace(/^\/+/, '');
  return `${publicBaseUrl()}/${key}`;
}

function uploadDelayMs() {
  const raw = process.env.AWS_S3_UPLOAD_DELAY_MS || process.env.MINIO_UPLOAD_DELAY_MS || '75';
  return Math.max(0, parseInt(raw, 10));
}

async function pauseBetweenUploads() {
  const ms = uploadDelayMs();
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

function isRetryableAwsError(err) {
  const msg = `${err?.name || ''} ${err?.Code || ''} ${err?.message || ''}`.toLowerCase();
  return (
    msg.includes('timeout')
    || msg.includes('econnreset')
    || msg.includes('socket')
    || msg.includes('503')
    || msg.includes('429')
    || msg.includes('502')
    || msg.includes('slowdown')
    || msg.includes('serviceunavailable')
  );
}

async function withRetry(fn, { label = 's3', retries = 4 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !isRetryableAwsError(err)) throw err;
      resetClient();
      const wait = Math.min(30_000, 500 * (2 ** attempt));
      console.warn(`[${label}] retry ${attempt + 1}/${retries} in ${wait}ms: ${err.message}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function ensureBucket() {
  const s3 = getClient();
  const bucket = getBucket();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (err) {
    if (err?.name !== 'NotFound' && err?.$metadata?.httpStatusCode !== 404) throw err;
    if (process.env.AWS_S3_CREATE_BUCKET !== 'true') {
      throw new Error(`Bucket "${bucket}" does not exist (set AWS_S3_CREATE_BUCKET=true to auto-create)`);
    }
    const params = { Bucket: bucket };
    if (getRegion() !== 'us-east-1') params.CreateBucketConfiguration = { LocationConstraint: getRegion() };
    await s3.send(new CreateBucketCommand(params));
    console.log(`[s3] Created bucket "${bucket}"`);
  }
  return bucket;
}

async function objectExists(objectKey) {
  try {
    await withRetry(
      () => getClient().send(new HeadObjectCommand({ Bucket: getBucket(), Key: objectKey })),
      { label: 'head' },
    );
    return true;
  } catch (err) {
    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

async function headObject(objectKey) {
  const res = await withRetry(
    () => getClient().send(new HeadObjectCommand({ Bucket: getBucket(), Key: objectKey })),
    { label: 'head' },
  );
  return {
    size: res.ContentLength,
    etag: res.ETag,
    contentType: res.ContentType,
  };
}

async function uploadFile(localPath, objectKey, { contentType = 'application/pdf' } = {}) {
  const body = fs.createReadStream(localPath);
  await uploadStream(body, objectKey, { contentType });
  await pauseBetweenUploads();
  return { bucket: getBucket(), key: objectKey };
}

async function uploadStream(stream, objectKey, { contentType = 'application/pdf' } = {}) {
  const upload = new Upload({
    client: getClient(),
    params: {
      Bucket: getBucket(),
      Key: objectKey,
      Body: stream,
      ContentType: contentType,
    },
  });
  await withRetry(() => upload.done(), { label: 'upload', retries: 5 });
  return { bucket: getBucket(), key: objectKey };
}

async function getObjectStream(objectKey) {
  const res = await getClient().send(new GetObjectCommand({
    Bucket: getBucket(),
    Key: objectKey,
  }));
  return res.Body;
}

async function listObjects(prefix = '') {
  const s3 = getClient();
  const bucket = getBucket();
  const objects = [];
  let continuationToken;

  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      ContinuationToken: continuationToken,
    }));
    for (const obj of res.Contents || []) {
      objects.push({ name: obj.Key, size: obj.Size, etag: obj.ETag });
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

async function presignedGetUrl(objectKey, { expiresIn = 3600 } = {}) {
  const key = objectKey.replace(/^\/+/, '');
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  return getSignedUrl(getClient(), command, { expiresIn });
}

module.exports = {
  isAwsS3Enabled,
  getClient,
  resetClient,
  getBucket,
  getRegion,
  ensureBucket,
  describeClientConfig,
  publicBaseUrl,
  publicUrl,
  objectExists,
  headObject,
  uploadFile,
  uploadStream,
  getObjectStream,
  listObjects,
  presignedGetUrl,
};
