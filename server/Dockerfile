# Node + SQLite. bookworm-slim (glibc) so better-sqlite3 uses its prebuilt binary;
# build toolchain is included as a fallback in case a source compile is needed.
FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "server.js"]
