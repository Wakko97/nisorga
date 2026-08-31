# Deployment mit Docker hinter Nginx Proxy Manager

Diese Anleitung beschreibt, wie Nisorga (Backend + Frontend + PostgreSQL) per
Docker Compose betrieben und an einen bereits laufenden, separat verwalteten
**Nginx Proxy Manager (NPM)** angebunden wird. NPM selbst wird hier **nicht**
eingerichtet — es wird vorausgesetzt, dass eine funktionierende NPM-Instanz
bereits erreichbar ist.

## 1. Voraussetzungen

- Docker Engine und Docker Compose (Plugin `docker compose`) installiert.
- Ein bereits laufender Nginx Proxy Manager, erreichbar über sein Admin-UI.
- Eine Domain (bzw. Subdomain), deren DNS-Eintrag auf den Server zeigt, auf
  dem NPM läuft.

## 2. `.env`-Dateien vorbereiten

Zwei getrennte `.env`-Dateien werden benötigt:

**a) Root-`.env`** (Postgres-Container-Credentials für docker-compose):

```bash
cp .env.example .env
```

Werte anpassen (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`).

**b) `backend/.env`** (App-Konfiguration):

```bash
cp backend/.env.example backend/.env
```

Alle Werte wie gewohnt ausfüllen (`JWT_SECRET`, `GOOGLE_CLIENT_ID`, etc.).

**WICHTIG:** `backend/.env.example` enthält `DATABASE_URL` mit Host
`localhost` — das funktioniert nur für lokale Entwicklung ohne Docker. Für
den Compose-Betrieb muss der Host auf den Servicenamen `postgres` geändert
werden, und die Credentials müssen mit der Root-`.env` übereinstimmen:

```
DATABASE_URL="postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@postgres:5432/<POSTGRES_DB>?schema=public"
```

Siehe auch Punkte 6–8 unten für produktionsrelevante Werte (`FRONTEND_URL`,
`NODE_ENV`, ggf. `TRUST_PROXY_HOPS`).

## 3. Build & Start

```bash
docker compose build
docker compose up -d
```

Beim Start des `backend`-Containers führt `docker-entrypoint.sh` automatisch
`npx prisma migrate deploy` aus, bevor der Server startet — Migrationen
werden also bei jedem Container-Start (bzw. Update) angewendet.

## 4. Verifikation

```bash
docker compose ps
```

Alle drei Services (`postgres`, `backend`, `frontend`) sollten `running`
bzw. `healthy` sein.

Falls die optionale Host-Port-Freigabe für `frontend` (`ports: ["8080:80"]`)
in `docker-compose.yml` einkommentiert wurde:

```bash
curl http://localhost:8080
```

Ansonsten (Standard-Setup ohne Host-Port-Publish) den Health-Check über den
internen Compose-Netzwerkpfad prüfen:

```bash
docker compose exec frontend wget -qO- http://backend:4000/health
```

Erwartete Antwort: `{"ok":true,"timestamp":"..."}`.

## 5. Anbindung an Nginx Proxy Manager

Im NPM-Admin-UI unter **Hosts → Proxy Hosts → Add Proxy Host**:

- **Domain Names**: die gewünschte (Sub-)Domain, z. B. `nisorga.example.com`
- **Scheme**: `http`
- **Forward Hostname / IP** und **Forward Port** hängen davon ab, ob NPM im
  selben Docker-Netzwerk wie die App-Container läuft:

  **Variante A — NPM läuft ebenfalls per Docker (häufigster Fall):**
  1. In `docker-compose.yml` den auskommentierten `npm_network`-Block
     aktivieren und den echten Netzwerknamen der NPM-Installation eintragen
     (z. B. `npm_default` oder wie im NPM-Compose-Setup benannt —
     `docker network ls` auf dem Host zeigt die verfügbaren Netzwerke).
  2. Den `frontend`-Service zusätzlich in dieses Netzwerk hängen (siehe
     Kommentare in `docker-compose.yml`).
  3. `docker compose up -d` erneut ausführen, damit der Container dem
     Netzwerk beitritt.
  4. In NPM als **Forward Hostname / IP** den Container- bzw. Service-Namen
     `frontend` (oder den vollen Compose-Container-Namen, falls kein
     DNS-Alias im gemeinsamen Netzwerk verfügbar ist) und als
     **Forward Port** `80` eintragen.

  **Variante B — NPM läuft nicht im selben Docker-Netzwerk (separater
  Host/VM oder eigenständige Installation):**
  1. In `docker-compose.yml` bei `frontend` die Zeile `ports: ["8080:80"]`
     einkommentieren und `docker compose up -d` erneut ausführen.
  2. In NPM als **Forward Hostname / IP** die IP-Adresse des Docker-Hosts
     eintragen und als **Forward Port** `8080`.

- **SSL-Tab**: "Request a new SSL Certificate" (Let's Encrypt) auswählen,
  "Force SSL" aktivieren, optional "HTTP/2 Support".
- Speichern.

Die App ist danach unter `https://<domain>` erreichbar. Der nginx-Prozess
im `frontend`-Container übernimmt intern das Routing von `/api/*` zum
`backend`-Container — NPM muss also nur auf den `frontend`-Container zeigen,
nicht auf `backend`.

## 6. `FRONTEND_URL` setzen

In `backend/.env`:

```
FRONTEND_URL="https://nisorga.example.com"
```

Wird für CORS-Origin-Prüfung benötigt, falls das Backend doch einmal direkt
(statt über den nginx-Proxy im Frontend-Container) angesprochen wird, sowie
für Redirect-/Callback-URLs (z. B. Google-OAuth-Callback,
E-Mail-Verifizierungslinks, die per Mail verschickt werden).

## 7. `NODE_ENV=production` setzen

In `backend/.env`:

```
NODE_ENV=production
```

Aktiviert u. a. `secure`-Cookies (Auth-/Refresh-Token-Cookies werden nur
noch über HTTPS übertragen). Das ist nur unbedenklich, wenn TLS tatsächlich
terminiert wird — was durch NPM (Let's-Encrypt-Zertifikat + "Force SSL",
siehe Schritt 5) sichergestellt ist.

## 8. `TRUST_PROXY_HOPS`

Prüfe, ob das Backend eine `TRUST_PROXY_HOPS`-Umgebungsvariable bzw. ein
entsprechendes `app.set("trust proxy", ...)` unterstützt (Stand dieser
Anleitung: **im Backend-Code noch nicht vorhanden** — wird ggf. in einem
separaten Task ergänzt). Sobald vorhanden: in `backend/.env` auf `1` setzen,
da genau ein Reverse Proxy (NPM) vor der App steht. Das sorgt dafür, dass
z. B. `X-Forwarded-For`/`X-Forwarded-Proto` korrekt ausgewertet werden
(u. a. relevant für `secure`-Cookies und Rate-Limiting nach echter Client-IP
statt der internen Proxy-IP).

## 9. Fußnote: Subdomain-Alternative (nicht empfohlen)

Diese Anleitung nutzt bewusst **eine** Domain mit Pfad-basiertem Routing
(`/api/*` wird intern vom nginx im Frontend-Container weitergeleitet) —
dadurch entfallen CORS- und Cross-Site-Cookie-Komplexität vollständig, da
Browser Frontend und Backend als dieselbe Origin sehen.

Falls stattdessen Frontend und Backend auf **getrennten Subdomains**
betrieben werden sollen (z. B. `app.example.com` und `api.example.com`,
jeweils als eigener NPM-Proxy-Host direkt auf die Container gemappt), wären
zusätzlich nötig:

- Auth-/Refresh-Cookies mit `SameSite=None; Secure` statt der
  Same-Origin-tauglichen Defaults, damit sie Cross-Site überhaupt gesendet
  werden.
- Explizite CORS-Origin-Konfiguration im Backend (`FRONTEND_URL` muss exakt
  der Frontend-Subdomain entsprechen; `credentials: true` bleibt nötig).

Das ist grundsätzlich möglich, aber komplexer und fehleranfälliger als der
Pfad-basierte Ansatz oben — daher hier nur der Vollständigkeit halber
erwähnt, nicht empfohlen.

## 10. Update-Workflow

```bash
git pull
docker compose build
docker compose up -d
```

Migrationen werden automatisch beim Start des `backend`-Containers über den
`docker-entrypoint.sh` angewendet (`npx prisma migrate deploy`) — ein
manueller Migrationsschritt ist nach einem Update nicht nötig.
