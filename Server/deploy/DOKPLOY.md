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

**Important:** The hostname `minio` only resolves **inside** the same Docker network as the MinIO container. Your backend runs on the **host** (`node index` via SSH), not in Docker — so use one of the options below.

### Option A — Host → MinIO container IP (recommended for SSH migration)

```bash
# Get MinIO container IP on the Docker bridge
MINIO_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' orewire-minio-0jtrko-minio-1)
echo $MINIO_IP
```

Temporarily in `.env` (or export for one run):

```env
MINIO_ENDPOINT=<that-ip>    # e.g. 172.18.0.5
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_PATH_STYLE=true
```

Then from `~/www/Orewire/Server` on the host:

```bash
node scripts/test-minio-connection.js
node scripts/migrate-filings-to-minio.js
```

Do **not** `docker exec` into the MinIO container — it has no Node.js.

### Option B — Host → published port (if 9000 is mapped)

```bash
docker port orewire-minio-0jtrko-minio-1
```

If `9000/tcp -> 0.0.0.0:9000`:

```env
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_USE_SSL=false
```

### Option C — Public URL from host (slower; proxy may rate-limit)

```env
MINIO_ENDPOINT=storage.orewire.com
MINIO_PORT=443
MINIO_USE_SSL=true
MINIO_UPLOAD_DELAY_MS=150
```

### Option D — One-off Node container on MinIO’s Docker network

```bash
NET=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' orewire-minio-0jtrko-minio-1)
docker run --rm -v "$PWD:/app" -w /app --env-file .env --network "$NET" \
  -e MINIO_ENDPOINT=orewire-minio-0jtrko-minio-1 -e MINIO_PORT=9000 -e MINIO_USE_SSL=false \
  node:22-alpine node scripts/migrate-filings-to-minio.js
```

(Service name `orewire-minio-0jtrko-minio-1` resolves inside that network.)

### Steps

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
