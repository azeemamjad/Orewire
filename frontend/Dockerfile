FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL=http://localhost:8070/api
ARG VITE_FRONTEND_DOMAIN=localhost:8080
ARG VITE_BACKEND_DOMAIN=localhost:8070

ENV VITE_API_URL=$VITE_API_URL \
    VITE_FRONTEND_DOMAIN=$VITE_FRONTEND_DOMAIN \
    VITE_BACKEND_DOMAIN=$VITE_BACKEND_DOMAIN

RUN npm run build

FROM nginx:1.27-alpine

# nginx.conf is a template: the official entrypoint runs envsubst over
# /etc/nginx/templates/*.template into /etc/nginx/conf.d/ at container start,
# substituting ${BACKEND_UPSTREAM} and ${EXTRA_CRAWLER_UA_PATTERN}. Both are
# RUNTIME values, unlike the VITE_* build args above: changing either needs a
# restart, not a rebuild.
#
# BACKEND_UPSTREAM — the backend that renders crawler HTML and serves the
# sitemaps. The public backend host is a safe default; a private service URL is
# faster. If it is wrong or unreachable, the site still looks fine in a browser
# while being invisible to crawlers.
#
# EXTRA_CRAWLER_UA_PATTERN — a never-matching regex by default, so the
# extra-crawler map always has a valid mask. An empty value would leave a bare
# `""` mask, and a malformed map stops nginx from starting. Override it to serve
# rendered HTML to a crawler that is not in nginx.conf's list.
ENV BACKEND_UPSTREAM=http://backend.orewire.com \
    EXTRA_CRAWLER_UA_PATTERN=~*orewire-never-matches

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY orewire-proxy-headers.inc /etc/nginx/conf.d/orewire-proxy-headers.inc
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
