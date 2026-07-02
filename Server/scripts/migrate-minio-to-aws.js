#!/usr/bin/env node
/**
 * Migrate filing PDFs from MinIO to AWS S3.
 *
 *   cd Server
 *   node scripts/test-aws-s3-connection.js
 *   node scripts/migrate-minio-to-aws.js --dry-run
 *   node scripts/migrate-minio-to-aws.js
 *   node scripts/migrate-minio-to-aws.js --include-local
 *   node scripts/migrate-minio-to-aws.js --include-orphans
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db = require('../db');
const { runMigration, fmtBytes } = require('../lib/infra/migrate-minio-to-s3');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERIFY_ONLY = args.includes('--verify-only');
const INCLUDE_ORPHANS = args.includes('--include-orphans');
const INCLUDE_LOCAL = args.includes('--include-local');

async function main() {
  const onProgress = ({ message, level }) => {
    if (message) {
      if (level === 'error') console.error(`[migrate] ${message}`);
      else console.log(`[migrate] ${message}`);
    }
  };

  const { stats, verify } = await runMigration({
    dryRun: DRY_RUN,
    verifyOnly: VERIFY_ONLY,
    includeOrphans: INCLUDE_ORPHANS,
    includeLocal: INCLUDE_LOCAL,
  }, onProgress);

  console.log('\n[migrate] Summary');
  console.log(`  Objects copied:      ${DRY_RUN ? stats.wouldCopy : stats.copied}`);
  console.log(`  Already on S3:       ${stats.skippedExists}`);
  console.log(`  DB rows updated:     ${DRY_RUN ? stats.wouldUpdateDb : stats.dbUpdated}`);
  if (INCLUDE_ORPHANS) console.log(`  Orphan objects:      ${stats.orphansCopied}`);
  if (INCLUDE_LOCAL) console.log(`  Missing local files: ${stats.missingLocal}`);
  console.log(`  Data transferred:    ${fmtBytes(stats.bytes)}`);
  console.log(`  Errors:              ${stats.errors}`);

  if (VERIFY_ONLY && verify) {
    console.log(`  Verify:              ${verify.ok} OK, ${verify.fail} failed`);
  }

  await db.end();
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});
