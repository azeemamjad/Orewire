const express = require('express');
const db = require('../../db');
const aws = require('../../lib/infra/aws-s3-storage');
const {
  getFilingPrefix,
  usePresignedUrls,
  presignExpiresSec,
  isStorageEnabled,
} = require('../../lib/infra/object-storage');

const router = express.Router();

async function bucketStats(listFn, prefix = '') {
  const objects = await listFn(prefix);
  const bytes = objects.reduce((s, o) => s + (o.size || 0), 0);
  const pdfs = objects.filter((o) => (o.name || '').toLowerCase().endsWith('.pdf'));
  return { objects: objects.length, pdfObjects: pdfs.length, bytes };
}

async function dbPathCounts() {
  const { rows } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE pdf_path LIKE 's3:%') AS s3_rows,
      COUNT(*) FILTER (WHERE pdf_path LIKE 'minio:%') AS legacy_minio_rows,
      COUNT(*) FILTER (WHERE pdf_path LIKE 'https://%') AS https_rows,
      COUNT(*) FILTER (
        WHERE pdf_path IS NOT NULL
          AND pdf_path NOT LIKE 'minio:%'
          AND pdf_path NOT LIKE 's3:%'
          AND pdf_path NOT LIKE 'https://%'
      ) AS local_rows,
      COUNT(*) FILTER (WHERE pdf_path IS NOT NULL) AS total
    FROM filings
  `);
  return rows[0] || {
    s3_rows: 0, legacy_minio_rows: 0, https_rows: 0, local_rows: 0, total: 0,
  };
}

async function testConnection(enabled, testFn) {
  if (!enabled) return { ok: false, error: 'Not configured' };
  try {
    await testFn();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// GET /api/admin/storage/summary
router.get('/summary', async (_req, res) => {
  try {
    const dbCounts = await dbPathCounts();
    const prefix = `${getFilingPrefix()}/`;

    const s3Conn = await testConnection(isStorageEnabled(), () => aws.ensureBucket());

    let s3Stats = null;
    if (s3Conn.ok) {
      try {
        s3Stats = await bucketStats((p) => aws.listObjects(p), prefix);
      } catch (err) {
        s3Stats = { error: err.message };
      }
    }

    res.json({
      config: {
        filingPrefix: getFilingPrefix(),
        presignedUrls: usePresignedUrls(),
        presignExpiresSec: presignExpiresSec(),
        s3Bucket: isStorageEnabled() ? aws.getBucket() : null,
        s3Region: isStorageEnabled() ? aws.getRegion() : null,
      },
      connections: { s3: s3Conn },
      db: dbCounts,
      s3: s3Stats,
    });
  } catch (err) {
    console.error('[storage] summary failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
