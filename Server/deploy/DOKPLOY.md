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

## Relay browser (important)

The backend image is built to get past bot walls. Four things it does that a plain
Node image does not — see `Server/relay/README.md` for the full reasoning:

| | why |
|---|---|
| Installs **real Google Chrome** (`patchright install chrome`) | bundled Chromium advertises `HeadlessChrome` in `sec-ch-ua`; SEDAR+ rejects it at the header layer |
| Starts **Xvfb** in `docker-entrypoint.sh`, runs Chrome **headed** | headless Chrome differs in ways no script can hide |
| Passes `--enable-unsafe-swiftshader` when the host has no GPU | Chrome 126+ otherwise exposes **no WebGL at all**, which is a loud bot signal |
| `exec`s node as PID 1 | so Dokploy's SIGTERM stops the container immediately instead of waiting out the 10s kill timeout |

**Image size** is ~4.4 GB (Playwright base + Chrome). Build args:

```bash
--build-arg INSTALL_CAMOUFOX=1           # +200MB, adds the Camoufox fallback engine
--build-arg INSTALL_PATCHED_CHROMIUM=1   # +900MB, only if you set BROWSER_CHANNEL=chromium
```

**Browser profiles** persist under `/app/data/profiles` on the mounted volume — one
Chrome profile per proxy worker, carrying cookies between runs so the browser looks
like a returning visitor. Budget a few hundred MB and expect them to grow; deleting
a profile directory burns that session and starts it clean.

Verify a deployed image before trusting it:

```bash
docker run --rm --shm-size=1g <image> node scripts/test-stealth.js --flow sedar
```

That asserts every fingerprint signal and walks the real SEDAR+ search flow. It
exits non-zero on failure, so it can gate a deploy.

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
6. **Env:** paste from `Server/.env.example` (production values); set `PORT=8070`, `RELAY_ENABLED=true`, and **`RELAY_HEADLESS=false`**
   > ⚠️ This changed. The old advice was `RELAY_HEADLESS=true` because headed mode
   > needed a display the container didn't have. The image now starts Xvfb in its
   > entrypoint, so a display exists — and headless Chrome is scored heavily by
   > SEDAR+'s Radware wall. Leaving this at `true` re-breaks scraping.
   > Do **not** set `USER_AGENT` either (see below).
7. **Volume:** persistent storage → `/app/data` (downloads, cookies, **browser profiles**)
8. **Shared memory:** ≥ 1 GB — required, not optional, now that Chrome runs headed
9. **Redeploy** after git pull when `Server/Dockerfile` or `playwright` version changes

Production filing storage uses **AWS S3 only** (`AWS_S3_ENABLED=true`). Keep the bucket private and use presigned URLs (`AWS_S3_PRESIGNED_URLS=true`).

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
| **AWS S3** | AWS account | Filing PDF storage (private bucket + presigned URLs) |
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

Do **not** set `MINIO_*` — MinIO is no longer used.

## pdf_path format

| Value | Meaning |
|--------|---------|
| `s3:TICKER/file.pdf` | Object key in the AWS bucket (presigned on request) |
| `https://…` | Public URL mode (`AWS_S3_PRESIGNED_URLS=false`) |
| Local path | Staging only — upload via pipeline when S3 is enabled |

`GET /api/filings/:id/document` generates a **presigned redirect** (default) so the bucket can stay private. Local paths still stream from disk until uploaded.

Admin → **Storage** (`/admin/storage.html`) shows S3 connection status and bucket volume.

## Volumes

- Mount a small volume at `Server/data/downloads` for scraper staging (PDFs upload to S3 on save when `AWS_S3_ENABLED=true`).
- Production filing PDFs live in the AWS S3 bucket.

## Scraper note

Browser scrapers run in-process under `Server/lib/scraper/`. Downloads land in `data/downloads` first, then upload to S3 when storage is enabled.
