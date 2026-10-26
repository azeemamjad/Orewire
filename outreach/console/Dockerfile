FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit

COPY server.js index.html ./

ENV CONSOLE_PORT=8018
EXPOSE 8018

CMD ["node", "server.js"]
