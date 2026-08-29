# Playwright image must match package.json playwright version exactly
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# poppler-utils + tesseract: OCR for image-only / scanned PDFs.
# xvfb + xdpyinfo: let the relay run Chrome headed on a host with no monitor.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       poppler-utils tesseract-ocr xvfb x11-utils \
  && rm -rf /var/lib/apt/lists/*

# Camoufox is optional: it pulls better-sqlite3, which needs a native build the
# Playwright image has no toolchain for. The default install skips optional deps
# entirely so a fallback engine can never break a production deploy.
ARG INSTALL_CAMOUFOX=0

COPY package.json package-lock.json ./
RUN if [ "$INSTALL_CAMOUFOX" = "1" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends python3 make g++ \
      && rm -rf /var/lib/apt/lists/* \
      && npm ci --omit=dev; \
    else \
      npm ci --omit=dev --omit=optional; \
    fi

# Real Google Chrome, not the bundled Chromium. Bundled Chromium advertises
# "HeadlessChrome" in its sec-ch-ua and ships a different codec/font set, which
# SEDAR+'s Radware wall rejects at the header layer before any page JS runs.
#
# The *patched* Chromium download (~900MB) is skipped by default: Chrome is what
# the relay runs, and the base image already carries a stock Chromium for the
# non-relay callers (briefing PDFs, x-browser). Add it with
#   --build-arg INSTALL_PATCHED_CHROMIUM=1
# only if you intend to run BROWSER_CHANNEL=chromium.
ARG INSTALL_PATCHED_CHROMIUM=0
RUN npx patchright install --with-deps chrome \
  && if [ "$INSTALL_PATCHED_CHROMIUM" = "1" ]; then npx patchright install chromium; fi \
  && rm -rf /var/lib/apt/lists/*

# The Camoufox browser binary (~200MB), only when the engine was installed above.
#   docker build --build-arg INSTALL_CAMOUFOX=1 …   then set RELAY_ENGINE=camoufox
ENV CAMOUFOX_INSTALL_DIR=/opt/camoufox
RUN if [ "$INSTALL_CAMOUFOX" = "1" ]; then npx camoufox-js fetch; fi

COPY . .

RUN mkdir -p data/downloads data/cookies data/profiles \
  && chmod +x docker-entrypoint.sh

ENV PORT=8070

# Headed under the entrypoint's virtual display. RELAY_HEADLESS=true still forces
# headless, but expect bot walls to block it.
ENV RELAY_HEADLESS=false

EXPOSE 8070

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://127.0.0.1:${PORT}/admin/login || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "index.js"]
