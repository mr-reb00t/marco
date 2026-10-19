# syntax=docker/dockerfile:1
# Marco: multi-stage image (build the web UI, then a slim runtime with production deps only).

# ---- build ---------------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts ./
# the whole folder: vite.config.ts imports helpers from it
COPY scripts ./scripts
COPY web ./web
COPY server ./server
RUN npm run build

# ---- runtime -------------------------------------------------------------------------------
FROM node:22-alpine
# SETUP_REQUIRE_TOKEN: inside a container the client address is not reliable (docker-proxy, Docker Desktop,
# rootless networking and same-host reverse proxies all show up as a private gateway address), so the setup
# wizard always asks for the one-time token printed in the log (docker compose logs | grep setup).
LABEL org.opencontainers.image.title="Marco" \
      org.opencontainers.image.description="Your family's day, framed. Self-hosted family wall calendar and dashboard." \
      org.opencontainers.image.source="https://github.com/mr-reb00t/marco" \
      org.opencontainers.image.licenses="MIT"
# MARCO_INSTALL=docker: the admin shows how to update a container (git pull, docker compose up -d --build) and never
# offers the update button.
ENV NODE_ENV=production \
    MARCO_INSTALL=docker \
    PORT=3000 \
    DATA_DIR=/data \
    SETUP_REQUIRE_TOKEN=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
