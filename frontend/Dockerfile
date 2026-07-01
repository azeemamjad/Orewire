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

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
