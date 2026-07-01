# Dokploy deployment (OreWire)

## Services

| Service | Source | Notes |
|---------|--------|-------|
| **Backend** | `Server/` | Node app, `node index.js`, port from `PORT` |
| **Frontend** | `frontend/` | Static build (`npm run build` → serve `dist/`) |
| **MinIO** | Dokploy MinIO template | Filing PDF storage (~25 GB+) |
| **Postgres** | Supabase (external) or Dokploy Postgres | `DATABASE_URL` |

## Backend env (Dokploy)

Required:

```env
DATABASE_URL=...
PORT=3000
SCRAPER_PATH=./Scraper
DOWNLOADS_DIR=./Scraper/downloads
ADMIN_PASSWORD=...
```

MinIO (after migration):

```env
MINIO_ENABLED=true
MINIO_ENDPOINT=<your-minio-host>    # e.g. minio.internal or s3.orewire.com
MINIO_PORT=9000
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=orewire-filings
```

## Filing storage migration (one-time on server)

1. Deploy backend with MinIO env vars set (`MINIO_ENABLED=true`).
2. Ensure `DOWNLOADS_DIR` still points at existing PDFs on disk.
3. Dry run:

   ```bash
   cd Server
   node scripts/migrate-filings-to-minio.js --dry-run
   ```

4. Upload + update DB:

   ```bash
   node scripts/migrate-filings-to-minio.js
   ```

5. Verify a few filings: `GET /api/filings/:id/document`
6. After verification, free disk:

   ```bash
   node scripts/migrate-filings-to-minio.js --delete-local
   ```

   (Only deletes files already uploaded and recorded as `minio:…` in the DB.)

## pdf_path format

| Before | After migration |
|--------|-----------------|
| `/app/Scraper/downloads/Co (T)/file.pdf` | `minio:Co (T)/file.pdf` |

The API serves both formats; new migrations use MinIO when `MINIO_ENABLED=true`.

## Volumes

- **Before migration:** mount a volume at `Server/Scraper/downloads` (or set `DOWNLOADS_DIR`).
- **After migration:** PDFs live in MinIO; downloads volume can shrink or be used only as a scraper staging area.

## Scraper note

Scrapers still write PDFs locally first. Pipeline analysis reads local files. After migration, run the migration script periodically for new downloads, or keep a small local staging volume until auto-upload is added.
