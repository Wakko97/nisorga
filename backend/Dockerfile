# syntax=docker/dockerfile:1

# ---- Stage 1: build ----
FROM node:20-alpine AS build
WORKDIR /app

# Prisma-Engines (musl-Build) benötigen OpenSSL zur Laufzeit/Generierung.
RUN apk add --no-cache openssl

# Workspace-Setup: Root-package.json + package-lock.json werden benötigt,
# damit npm die Workspace-Hoisting-Struktur korrekt auflöst.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json

# Nur den backend-Workspace installieren (inkl. Hoisting der Root-Dependencies
# in das gemeinsame /app/node_modules).
RUN npm ci --workspace backend --include-workspace-root

# Restlichen Backend-Quellcode kopieren
COPY backend ./backend

WORKDIR /app/backend
RUN npx prisma generate
RUN npm run build

# ---- Stage 2: runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Prisma-Engines (musl-Build) benötigen OpenSSL zur Laufzeit (u.a. für
# "prisma migrate deploy" im Entrypoint).
RUN apk add --no-cache openssl

# Hinweis: node:20-alpine enthält bereits wget (busybox), genutzt für den Healthcheck.
# Die Prisma-CLI (devDependency) wird zur Laufzeit für "prisma migrate deploy" benötigt,
# daher wird hier bewusst das komplette node_modules aus dem Build-Stage übernommen
# statt production-only (--omit=dev) zu installieren.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/prisma ./prisma
COPY --from=build /app/backend/dist ./dist
COPY backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4000/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
