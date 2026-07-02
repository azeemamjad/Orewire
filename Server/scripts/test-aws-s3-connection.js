#!/usr/bin/env node
/**
 * Test AWS S3 connectivity — run before migration.
 *   node scripts/test-aws-s3-connection.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const {
  isAwsS3Enabled,
  describeClientConfig,
  ensureBucket,
  uploadFile,
  objectExists,
  publicUrl,
  listObjects,
} = require('../lib/infra/aws-s3-storage');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  if (!isAwsS3Enabled()) {
    console.error('AWS S3 not enabled — set AWS_S3_ENABLED=true, AWS_S3_BUCKET, and credentials in .env');
    process.exit(1);
  }

  console.log('AWS S3 config:', describeClientConfig());

  try {
    await ensureBucket();
    console.log('headBucket: OK');
  } catch (err) {
    console.error('headBucket FAILED:', err.name || err.code, err.message);
    printHints(err);
    process.exit(1);
  }

  try {
    const objects = await listObjects('');
    console.log(`listObjects: OK — ${objects.length} object(s) in bucket`);
  } catch (err) {
    console.error('listObjects FAILED:', err.name || err.code, err.message);
    printHints(err);
    process.exit(1);
  }

  const testKey = '_healthcheck/test.txt';
  const tmpPath = path.join(os.tmpdir(), `orewire-s3-test-${Date.now()}.txt`);
  fs.writeFileSync(tmpPath, 'ok');

  try {
    await uploadFile(tmpPath, testKey, { contentType: 'text/plain' });
    const exists = await objectExists(testKey);
    console.log('putObject: OK — exists:', exists);
    console.log('sample public URL:', publicUrl('filings/example.pdf'));

    const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
      },
    });
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: testKey,
    }));
    console.log('deleteObject: OK');
  } catch (err) {
    console.error('write test FAILED:', err.name || err.code, err.message);
    printHints(err);
    process.exit(1);
  } finally {
    fs.unlinkSync(tmpPath);
  }

  console.log('\nAWS S3 connection is working. Safe to run migrate-minio-to-aws.js');
}

function printHints(err) {
  const msg = `${err.name || ''} ${err.code || ''} ${err.message || ''}`.toLowerCase();
  console.error('\nHints:');
  if (msg.includes('accessdenied') || msg.includes('invalidaccesskey') || msg.includes('signature')) {
    console.error('  • Verify AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY');
    console.error('  • Check IAM policy allows s3:PutObject, s3:GetObject, s3:ListBucket, s3:HeadObject');
  }
  if (msg.includes('nosuchbucket') || msg.includes('not found')) {
    console.error('  • Create the bucket in AWS console or set AWS_S3_CREATE_BUCKET=true');
    console.error('  • Verify AWS_REGION matches the bucket region');
  }
  if (msg.includes('endpoint') || msg.includes('region')) {
    console.error('  • Set AWS_REGION to the bucket region (e.g. ap-south-1)');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
