# syntax=docker/dockerfile:1

# ---- Stage 1: build ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json

RUN npm ci --workspace frontend --include-workspace-root

COPY frontend ./frontend

# Zur Build-Zeit in die statischen Assets eingebacken (Vite env vars sind
# build-time, nicht runtime). Default /api passt zum nginx-Proxy unten,
# der /api/ intern an den backend-Container weiterleitet -> Single-Domain-
# Deployment ohne CORS.
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

WORKDIR /app/frontend
RUN npm run build

# ---- Stage 2: runtime ----
FROM nginx:alpine AS runtime

COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
