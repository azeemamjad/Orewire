#!/usr/bin/env node
/**
 * Generate a presigned GET URL for a private S3 object.
 *
 *   node scripts/presign-s3-url.js filings/abc.pdf
 *   node scripts/presign-s3-url.js "ChatGPT Image Jul 1, 2026, 07_28_30 PM.png"
 *   node scripts/presign-s3-url.js filings/abc.pdf --expires 86400
 *   node scripts/presign-s3-url.js --list
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const {
  isAwsS3Enabled,
  describeClientConfig,
  listObjects,
  presignedGetUrl,
  publicUrl,
} = require('../lib/infra/aws-s3-storage');

function parseArgs(argv) {
  const opts = { expiresIn: 3600, list: false, keys: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') {
      opts.list = true;
    } else if (arg === '--expires' && argv[i + 1]) {
      opts.expiresIn = Math.max(60, parseInt(argv[++i], 10) || 3600);
    } else if (!arg.startsWith('-')) {
      opts.keys.push(arg);
    }
  }
  return opts;
}

function fmtBytes(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

async function main() {
  if (!isAwsS3Enabled()) {
    console.error('AWS S3 not enabled — set AWS_S3_ENABLED=true, AWS_S3_BUCKET, and credentials in .env');
    process.exit(1);
  }

  const opts = parseArgs(process.argv.slice(2));

  if (opts.list) {
    const objects = await listObjects('');
    console.log(`Bucket: ${describeClientConfig().bucket} (${objects.length} object(s))\n`);
    for (const obj of objects) {
      console.log(`  ${obj.name}  (${fmtBytes(obj.size || 0)})`);
    }
    if (objects.length === 0) {
      console.log('  (empty)');
    }
    console.log('\nPresign one: node scripts/presign-s3-url.js "<object-key>"');
    return;
  }

  if (opts.keys.length === 0) {
    console.error('Usage: node scripts/presign-s3-url.js <object-key> [--expires seconds]');
    console.error('       node scripts/presign-s3-url.js --list');
    process.exit(1);
  }

  for (const key of opts.keys) {
    try {
      const url = await presignedGetUrl(key, { expiresIn: opts.expiresIn });
      console.log(`Key:      ${key}`);
      console.log(`Public:   ${publicUrl(key)}  (Access Denied if bucket is private)`);
      console.log(`Presigned (${opts.expiresIn}s):`);
      console.log(url);
      if (opts.keys.length > 1) console.log('');
    } catch (err) {
      console.error(`Failed for "${key}":`, err.message);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
