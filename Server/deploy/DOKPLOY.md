# Dokploy deployment (OreWire)

## Monorepo layout

The git repo root is **not** the app root. In Dokploy, set **Root Directory** (build context) per app:

| Dokploy service | Root directory | Dockerfile path | Container port |
|-----------------|----------------|-----------------|----------------|
| **backend** | `Server` | `Dockerfile` | `8070` |
| **frontend** | `frontend` | `Dockerfile` | `8080` |

Do **not** point Dokploy at the repo root (`/`) — builds will fail or use the wrong context.

## Docker images

| Service | Image base |
|---------|------------|
| **backend** | `mcr.microsoft.com/playwright:v1.61.1-jammy` (must match `playwright` in `Server/package.json`) |
| **frontend** | `nginx:alpine` (Vite build in stage 1) |

**Playwright / Relay:** If you see `Executable doesn't exist at /ms-playwright/chromium-…`, the Docker image tag and `playwright` npm version are out of sync — rebuild after pulling the latest `Server/Dockerfile`.

For Relay, allocate **≥ 1 GB shared memory** (`/dev/shm`) on the backend container if Dokploy exposes that setting.

### Local (docker compose)

From the repo root:

```bash
cp Server/.env.example Server/.env   # set DATABASE_URL and secrets
docker compose up --build
```

- Frontend: http://localhost:8080  
- Backend / admin: http://localhost:8070/admin/dashboard.html  

Optional root `.env` (see `.env.docker.example`) to override `VITE_API_URL` and host ports.

The server container mounts a volume at `/app/data` for scraper downloads and cookies.

### Dokploy — backend

1. **New application** → name e.g. `backend` → Build type: **Dockerfile**
2. **Root directory:** `Server` (not `/` and not the whole repo)
3. **Dockerfile path:** `Dockerfile`
4. **Container port:** `8070`
5. **Domain:** `backend.orewire.com` (HTTPS via Dokploy / Traefik)
6. **Env:** paste from `Server/.env.example` (production values); set `PORT=8070`, `RELAY_ENABLED=true`, `RELAY_HEADLESS=true` (or omit — Docker auto-forces headless)
7. **Volume:** persistent storage → `/app/data` (downloads + cookies)
8. **Shared memory:** ≥ 1 GB if Relay is enabled
9. **Redeploy** after git pull when `Server/Dockerfile` or `playwright` version changes

Production filing storage uses **AWS S3** (`AWS_S3_ENABLED=true`). MinIO env is only needed during migration (`migrate-minio-to-aws.js`); use the MinIO service hostname on the Dokploy Docker network (e.g. `MINIO_ENDPOINT=minio`, `MINIO_PORT=9000`, `MINIO_USE_SSL=false`).

### Dokploy — frontend

1. **New application** → name e.g. `frontend` → Build type: **Dockerfile**
2. **Root directory:** `frontend`
3. **Dockerfile path:** `Dockerfile`
4. **Build arguments** (required — **not** runtime env only). In Dokploy, open **Build** / **Docker Build Args** and set:

   ```env
   VITE_API_URL=https://backend.orewire.com/api
   VITE_FRONTEND_DOMAIN=orewire.com
   VITE_BACKEND_DOMAIN=backend.orewire.com
   ```

   `VITE_*` values are compiled into the static JS at **image build time**. Setting them only under Runtime Environment does nothing — the site will still call `localhost` and the browser will prompt to access your local network.

   If you skip `VITE_API_URL` but set `VITE_BACKEND_DOMAIN`, the app uses `https://backend.orewire.com/api` automatically.

5. **Container port:** `8080` (nginx listens on `8080` inside the image)
6. **Domain:** `orewire.com` (and `www.orewire.com` if you use it)

**Rebuild and redeploy** the frontend after any `VITE_*` change.

---

## Services (overview)

| Service | Source | Notes |
|---------|--------|-------|
| **Backend** | `Server/` | Node app, Playwright image, listens on port `8070` |
| **Frontend** | `frontend/` | Static build (`npm run build` → nginx on port `8080`) |
| **MinIO** | Dokploy MinIO template | Filing PDF storage (~25 GB+) |
| **Postgres** | Supabase (external) or Dokploy Postgres | `DATABASE_URL` |

## Backend env (Dokploy)

Required:

```env
DATABASE_URL=...
PORT=8070
DOWNLOADS_DIR=./data/downloads
COOKIE_FILE=./data/cookies.json
ADMIN_PASSWORD=...
```

AWS S3 (production filing storage — private bucket + presigned URLs):

```env
AWS_S3_ENABLED=true
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=eu-north-1
AWS_S3_BUCKET=orewire-filings
AWS_S3_PUBLIC_BASE_URL=https://orewire-filings.s3.eu-north-1.amazonaws.com
STORAGE_FILING_PREFIX=filings
AWS_S3_PRESIGNED_URLS=true
AWS_S3_PRESIGN_EXPIRES_SEC=3600
```

**AWS setup (console / IaC):**

- Create bucket in your chosen region (match `AWS_REGION`).
- **No public bucket policy required** when `AWS_S3_PRESIGNED_URLS=true` — bucket stays private.
- IAM user/role for the app: `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, `s3:HeadObject`, `s3:DeleteObject` on the bucket prefix.
- Never commit keys — use Dokploy secrets or an IAM role on EC2.

MinIO (legacy — migration source only; remove after cutover):

```env
MINIO_ENABLED=true
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_PATH_STYLE=true
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=orewire-filings
```

## Filing storage migration (MinIO → AWS S3)

### Admin UI (recommended)

1. Deploy with both `MINIO_*` and `AWS_*` env vars set.
2. Open **Admin → Storage** (`/admin/storage.html`).
3. Review analytics (object counts, volume, pending `minio:` rows).
4. Click **Dry run**, then **Start migration** (optional: include local paths / orphan objects).
5. Watch live progress until complete.
6. Spot-check a filing PDF on the public site (`/api/filings/:id/document` → presigned S3 redirect).
7. Remove `MINIO_ENABLED`, decommission MinIO.

### CLI (alternative)

```bash
docker exec -it <server-container> node scripts/test-aws-s3-connection.js
docker exec -it <server-container> node scripts/migrate-minio-to-aws.js --dry-run
docker exec -it <server-container> node scripts/migrate-minio-to-aws.js
docker exec -it <server-container> node scripts/migrate-minio-to-aws.js --include-local
```

Optional flags: `--include-orphans`

### Legacy: local disk → MinIO (pre-S3)

If filings are still on local disk with `minio:` not yet in DB, run the older script first (requires MinIO):

```bash
node scripts/test-minio-connection.js
node scripts/migrate-filings-to-minio.js --dry-run
node scripts/migrate-filings-to-minio.js
```

Then migrate via Admin → Storage or `migrate-minio-to-aws.js`.

## pdf_path format

| Before | After S3 migration |
|--------|---------------------|
| `/app/data/downloads/Co (T)/file.pdf` | `s3:filings/<hash>.pdf` |
| `minio:filings/abc.pdf` (legacy) | `s3:filings/abc.pdf` |

`GET /api/filings/:id/document` generates a **presigned redirect** (default) so the bucket can stay private. Local paths still stream from disk until migrated.

## Volumes

- Mount a small volume at `Server/data/downloads` for scraper staging (PDFs upload to S3 on save when `AWS_S3_ENABLED=true`).
- MinIO bucket holds production filing PDFs.

## Scraper note

Browser scrapers run in-process under `Server/lib/scraper/`. Downloads land in `data/downloads` first; use MinIO import scripts to persist unique filings.
