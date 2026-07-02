#!/usr/bin/env node
/**
 * Test MinIO connectivity — run on the server before migration.
 *   node scripts/test-minio-connection.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const {
  isMinioEnabled,
  describeClientConfig,
  getClient,
  getBucket,
  ensureBucket,
} = require('../lib/infra/minio-storage');

async function main() {
  if (!isMinioEnabled()) {
    console.error('MinIO not enabled — set MINIO_ENABLED=true and credentials in .env');
    process.exit(1);
  }

  console.log('MinIO config:', describeClientConfig());

  const minio = getClient();
  const bucket = getBucket();

  try {
    const buckets = await minio.listBuckets();
    console.log('listBuckets: OK —', buckets.map((b) => b.name).join(', ') || '(none)');
  } catch (err) {
    console.error('listBuckets FAILED:', err.code || err.name, err.message);
    printHints(err);
    process.exit(1);
  }

  try {
    const exists = await minio.bucketExists(bucket);
    console.log(`bucketExists("${bucket}"):`, exists);
    if (!exists) {
      console.log('Creating bucket…');
      await ensureBucket();
      console.log('makeBucket: OK');
    }
  } catch (err) {
    console.error('bucket check FAILED:', err.code || err.name, err.message);
    printHints(err);
    process.exit(1);
  }

  const testKey = '_healthcheck/test.txt';
  try {
    await minio.putObject(bucket, testKey, Buffer.from('ok'), 2, { 'Content-Type': 'text/plain' });
    await minio.removeObject(bucket, testKey);
    console.log('putObject/removeObject: OK');
  } catch (err) {
    console.error('write test FAILED:', err.code || err.name, err.message);
    printHints(err);
    process.exit(1);
  }

  console.log('\nMinIO connection is working. Safe to run migrate-filings-to-minio.js');
}

function printHints(err) {
  const msg = `${err.code || ''} ${err.message || ''}`.toLowerCase();
  console.error('\nHints:');
  if (msg.includes('access denied') || msg.includes('signature') || msg.includes('invalidaccesskey')) {
    console.error('  • Verify MINIO_ACCESS_KEY / MINIO_SECRET_KEY in Dokploy MinIO service env');
    console.error('  • Try MINIO_PATH_STYLE=true (default for storage.orewire.com)');
    console.error('  • Try MINIO_REGION=  (empty) or remove MINIO_REGION');
    console.error('  • If backend runs inside Dokploy, try internal endpoint:');
    console.error('      MINIO_ENDPOINT=minio  MINIO_PORT=9000  MINIO_USE_SSL=false');
  }
  if (msg.includes('wrong version number') || msg.includes('eproto')) {
    console.error('  • SSL mismatch — MinIO on port 9000 uses HTTP, not HTTPS.');
    console.error('  • Set MINIO_USE_SSL=false when using docker IP or port 9000.');
  }
  if (msg.includes('enotfound') || msg.includes('eai_again') || msg.includes('getaddrinfo')) {
    console.error('  • Hostname does not resolve from this shell (common when backend runs on host, not in Docker).');
    console.error('  • Do NOT docker exec into the MinIO container — it has no Node.');
    console.error('  • Use MinIO container IP instead:');
    console.error('      docker inspect -f \'{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}\' <minio-container>');
    console.error('      MINIO_ENDPOINT=<ip>  MINIO_PORT=9000  MINIO_USE_SSL=false');
    console.error('  • Or use public URL: MINIO_ENDPOINT=storage.orewire.com  MINIO_PORT=443  MINIO_USE_SSL=true');
  }
  if (msg.includes('enotfound') || msg.includes('econnrefused') || msg.includes('certificate')) {
    console.error('  • Check MINIO_ENDPOINT / MINIO_PORT / MINIO_USE_SSL match Dokploy routing');
    console.error('  • storage.orewire.com:443 must proxy to MinIO S3 API (port 9000), not console only');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
