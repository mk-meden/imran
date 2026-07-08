# Node app for Render (or any Docker host). `pg` is pure JS, so no build
# toolchain is needed. The app stores nothing on disk — data lives in Postgres.
FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# Run as the unprivileged built-in `node` user.
USER node

# Render sets $PORT and routes to it; the app listens on process.env.PORT.
EXPOSE 3000
CMD ["node", "server.js"]
