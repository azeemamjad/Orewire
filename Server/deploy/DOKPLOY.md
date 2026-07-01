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
6. **Env:** paste from `Server/.env.example` (production values); set `PORT=8070`
7. **Volume:** persistent storage → `/app/data` (downloads + cookies)
8. **Shared memory:** ≥ 1 GB if Relay is enabled
9. **Redeploy** after git pull when `Server/Dockerfile` or `playwright` version changes

Important for MinIO: from inside the backend container, use the MinIO **service hostname** on the Dokploy Docker network (e.g. `MINIO_ENDPOINT=minio`, `MINIO_PORT=9000`, `MINIO_USE_SSL=false`).

### Dokploy — frontend

1. **New application** → name e.g. `frontend` → Build type: **Dockerfile**
2. **Root directory:** `frontend`
3. **Dockerfile path:** `Dockerfile`
4. **Build args** (required at build time):

   ```env
   VITE_API_URL=https://backend.orewire.com/api
   VITE_FRONTEND_DOMAIN=orewire.com
   VITE_BACKEND_DOMAIN=backend.orewire.com
   ```

5. **Container port:** `8080` (nginx listens on `8080` inside the image)
6. **Domain:** `orewire.com`

Rebuild the frontend image whenever `VITE_*` URLs change.

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

**Important:** With Dockerized backend, use the MinIO **service name** on the Dokploy network (`MINIO_ENDPOINT=minio`, port `9000`, SSL off). For one-off migration from the host, see options below.

### Option A — Backend container → MinIO service name (recommended in Dokploy)

```env
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_PATH_STYLE=true
```

Run migration inside the running backend container:

```bash
docker exec -it <server-container> node scripts/migrate-filings-to-minio.js --dry-run
docker exec -it <server-container> node scripts/migrate-filings-to-minio.js
```

### Option B — Host → MinIO container IP (legacy SSH / host Node)

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
| `/app/data/downloads/Co (T)/file.pdf` | `minio:filings/<sha256>.pdf` |

The API serves both formats; new migrations use MinIO when `MINIO_ENABLED=true`.

## Volumes

- Mount a small volume at `Server/data/downloads` for scraper staging (PDFs move to MinIO via import/migration scripts).
- MinIO bucket holds production filing PDFs.

## Scraper note

Browser scrapers run in-process under `Server/lib/scraper/`. Downloads land in `data/downloads` first; use MinIO import scripts to persist unique filings.
