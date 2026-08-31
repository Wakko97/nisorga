# Nisorga

Eine Web-App für Geschäftsführer:innen zur schnellen Erfassung von Ideen und Aufgaben (GTD-artig), mit Eisenhower-Matrix, Mehrbenutzer-Unterstützung (Owner + Mitglieder/Assistenz), Google-Kalender-Sync und einer offenen Integrations-API (API-Key + Webhooks).

## Struktur

Monorepo mit npm workspaces:

```
/backend   Node.js + Express + TypeScript + Prisma + PostgreSQL
/frontend  React + Vite + TypeScript + Tailwind CSS + React Router + TanStack Query
/scripts   Betriebs-/Deployment-Skripte für Proxmox VE (siehe unten)
```

## Features

- **Schnellerfassung**: Ein Eingabefeld auf der Inbox-Seite, Tastenkürzel „n" fokussiert es von überall, Enter speichert.
- **GTD-Workflow**: Items landen in der Inbox und werden von dort verfeinert (Typ, Priorität, Zuweisung, Status).
- **Eisenhower-Matrix**: Items per Drag & Drop zwischen den vier Quadranten (wichtig/dringend) verschieben.
- **Aufgabenliste** mit Filtern nach Status, Zuweisung, Fälligkeit.
- **Mehrbenutzer**: Der Owner-Account wird einmalig über den [Einrichtungswizard](#einrichtungswizard) angelegt, alle Selbstregistrierungen danach werden `MEMBER`. Owner sehen alle Items, Mitglieder nur eigene bzw. ihnen zugewiesene.
- **Google-Kalender-Sync**: OAuth2-Verbindung, Items mit Fälligkeitsdatum können als Kalender-Event angelegt/aktualisiert werden.
- **Offene Integrations-API** (`/api/v1`): externe Systeme können per API-Key Items anlegen/lesen. Zusätzlich können Webhooks abonniert werden, die bei `item.created`/`item.updated` ausgelöst werden.

## Voraussetzungen

- Node.js >= 18
- PostgreSQL (lokal oder remote erreichbar)
- Ein Google Cloud Projekt mit aktivierter Calendar API und OAuth2-Credentials (für die Kalender-Integration; optional für den restlichen Betrieb)

## Setup

1. Repository klonen, Abhängigkeiten installieren:

   ```bash
   npm install
   ```

   Das installiert Backend und Frontend über npm workspaces in einem Schritt.

2. Umgebungsvariablen anlegen:

   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```

   Backend `.env` ausfüllen: `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `PORT`, `FRONTEND_URL`.

   > **Hinweis:** `GoogleAccount.accessToken`/`refreshToken` werden verschlüsselt in der Datenbank gespeichert — siehe Abschnitt [Produktivhärtung](#produktivhärtung) für Details zu `GOOGLE_TOKEN_ENCRYPTION_KEY`.

3. Datenbankschema anwenden:

   ```bash
   cd backend
   npx prisma generate
   npx prisma migrate dev --name init
   ```

   Falls keine PostgreSQL-Instanz verfügbar ist, kann das Schema trotzdem geprüft werden mit `npx prisma validate` (führt keine echte Migration aus).

4. Beide Workspaces im Entwicklungsmodus starten (in zwei Terminals):

   ```bash
   npm run dev:backend
   npm run dev:frontend
   ```

   Backend läuft standardmäßig auf `http://localhost:4000`, Frontend auf `http://localhost:5173`.

5. Frontend im Browser öffnen (`http://localhost:5173`) — bei einer frischen Installation leitet die App automatisch zum [Einrichtungswizard](#einrichtungswizard) weiter.

## Einrichtungswizard

Bei einer frischen Installation (noch kein Owner-Account angelegt) leitet die App jede Route auf `/setup` um. Der Wizard führt durch:

1. **Willkommen** — kurzer Überblick über die App.
2. **Owner-Account anlegen** — Name, E-Mail, Passwort (min. 8 Zeichen). Ruft `POST /setup/init` auf, das atomar genau einmal einen Owner-Account erzeugen kann (verhindert eine Race Condition bei gleichzeitigen Erstaufrufen). Ist die App bereits eingerichtet, meldet der Wizard das und verlinkt zu `/login`.
3. **Server-Konfiguration** — reine Statusanzeige (`GET /setup/status`), ob Google Calendar, SMTP-Versand und der E-Mail-Empfang serverseitig konfiguriert sind. Secrets werden bewusst NICHT über den Browser gesetzt — das bleibt Sache der `.env`-Datei (siehe oben und [Produktivhärtung](#produktivhärtung)).

Nach Abschluss landest du eingeloggt als Owner in der Inbox. Alle späteren Selbstregistrierungen über `/register` werden automatisch `MEMBER`.

## Google-Kalender-Integration einrichten

1. In der Google Cloud Console ein Projekt anlegen, die "Google Calendar API" aktivieren.
2. OAuth2-Client-ID (Typ "Webanwendung") anlegen, als Redirect-URI `http://localhost:4000/integrations/google/callback` eintragen.
3. Client-ID/-Secret in `backend/.env` eintragen.
4. In der App unter **Einstellungen** auf "Google Kalender verbinden" klicken.

## Externe Integrations-API

Siehe [docs/api.md](docs/api.md) für die vollständige Dokumentation der `/api/v1`-Schnittstelle (API-Key-Auth) sowie der Webhooks.

## Docker-Deployment

Siehe [docs/deployment.md](docs/deployment.md) für eine vollständige Anleitung, wie die App per Docker Compose (Backend, Frontend, PostgreSQL) hinter einem bereits laufenden Nginx Proxy Manager bereitgestellt wird.

## Erweiterte Features

- **Wochenrückblick** (`/review`, Backend `GET /review/weekly`): zeigt offene Inbox-Punkte, überfällige Aufgaben und seit über 3 Tagen unbearbeitete Ideen, mit Inline-Aktionen (Priorität setzen, zu Aufgabe konvertieren, zuweisen, archivieren). Dieselbe Sichtbarkeitslogik wie bei `/items` (Owner sehen alles, Mitglieder nur eigene/zugewiesene Items).
- **E-Mail-Erfassung**: Jeder Nutzer bekommt eine persönliche Inbound-Adresse (`inbox+<token>@<EMAIL_INBOUND_DOMAIN>`, sichtbar/kopierbar unter Einstellungen). Eingehende Mails werden per IMAP-Polling (Standard: alle 2 Minuten, `IMAP_POLL_CRON`) abgeholt und als Idee in der Inbox angelegt (`source=EMAIL`).
- **Delegations-Tracking & Erinnerungen**: Items können auf Status „Wartet auf Rückmeldung" (`WAITING`) gesetzt werden; `waitingSince` wird automatisch gepflegt. Ein täglicher Cron-Job verschickt nach `WAITING_REMINDER_DAYS` (Default 3) eine Erinnerungsmail an Ersteller:in und Zugewiesene:n. Aufgaben-/Matrix-Ansicht zeigen ein rotes "überfällig, wartet seit X Tagen"-Badge.
- **Wochenrückblick-Digest**: Ein wöchentlicher Cron-Job (freitags 08:00) verschickt die Wochenrückblick-Daten aller Nutzer:innen als HTML-Mail.
- **Sprachnotiz**: Mikrofon-Button im Schnellerfassungsfeld nutzt die Web-Speech-API (`de-DE`), um gesprochenen Text direkt als Titel zu übernehmen. Wird ausgeblendet/deaktiviert, wenn der Browser die API nicht unterstützt.
- **Kamera-Scan**: Kamera-Button (📷) im Schnellerfassungsfeld öffnet auf Mobilgeräten direkt die Rückkamera (`<input type="file" capture="environment">`). Das Foto wird clientseitig per Tesseract.js (deutsches Sprachpaket, dynamisch nachgeladen — kein Teil des Haupt-Bundles) per OCR ausgewertet; der erkannte Text (erste ~80 Zeichen) erscheint als bearbeitbarer Titel-Vorschlag. Beim Speichern wird zuerst das Item angelegt (`source=SCAN`) und danach das Foto per `POST /items/:id/attachment` als Anhang hochgeladen. Anhänge liegen serverseitig unter `UPLOADS_DIR` (Default `./uploads`) unter einem zufälligen Dateinamen und werden ausschließlich über die authentifizierte Route `GET /items/:id/attachment` ausgeliefert (kein öffentlicher Static-Mount), damit die Item-Sichtbarkeitsregeln greifen. In `docker-compose.yml` liegt `UPLOADS_DIR` auf dem benannten Volume `uploads_data`, damit Anhänge Container-Neustarts überleben.

### E-Mail (SMTP/IMAP) einrichten

Nisorga verschickt Mails per SMTP und holt eingehende Mails per IMAP ab — beides läuft gegen ein normales Mail-Konto (eigener Mailserver oder ein beliebiger Provider mit SMTP/IMAP-Zugang), es wird kein externer E-Mail-Dienst (SendGrid o. ä.) benötigt.

**Zwei Wege, das zu konfigurieren** (siehe `backend/src/lib/mailConfig.ts`):

- **Settings-UI** (empfohlen für den laufenden Betrieb): Sobald ein Owner-Account existiert, unter **Einstellungen → Mail-Konfiguration** einstellbar — wirkt sofort, kein Neustart nötig. Passwörter werden AES-256-GCM-verschlüsselt in der Datenbank abgelegt (siehe [Produktivhärtung](#produktivhärtung)) und nie an den Browser zurückgegeben.
- **Umgebungsvariablen** (`backend/.env`): Dienen als Bootstrap-Default, bevor ein Owner-Account existiert, bzw. für rein env-basierte Deployments. Eine in der Settings-UI gesetzte Variable überschreibt die gleichnamige `.env`-Variable feldweise; alles nicht in der UI Gesetzte fällt weiterhin auf `.env` zurück.

**Ausgehend (SMTP)** — für E-Mail-Verifizierung, Erinnerungen, Wochendigest:

1. Host, Port, TLS, Benutzername, Passwort, Absenderadresse setzen — per UI oder in `backend/.env`: `SMTP_HOST`, `SMTP_PORT` (587 für STARTTLS, 465 für implizites TLS), `SMTP_SECURE` (`"true"` nur bei Port 465), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`.
2. Ist nirgends ein Host gesetzt, versendet `sendEmail()` keine echten Mails, sondern loggt nur eine Warnung — lokale Entwicklung funktioniert also auch ohne Mail-Konto.

**Eingehend (IMAP)** — für die E-Mail-Erfassung (Mails werden zu Items):

1. Eine Mailbox einrichten, die **alle** an die Inbound-Domain adressierten Mails empfängt — entweder ein Catch-All-Postfach für diese (Sub-)Domain, oder ein Provider mit Plus-Adressierung (`inbox+<token>@...` landet dann im selben Postfach wie `inbox@...`). Ein selbst gehosteter Postfix/Dovecot unterstützt beides.
2. Host, Port, TLS, Benutzername, Passwort, Mailbox und Inbound-Domain setzen — per UI oder in `backend/.env`: `IMAP_HOST`, `IMAP_PORT` (Standard 993), `IMAP_SECURE`, `IMAP_USER`, `IMAP_PASSWORD`, `IMAP_MAILBOX` (Standard `INBOX`) und `EMAIL_INBOUND_DOMAIN` (wird für die angezeigte Inbound-Adresse in den Einstellungen gebraucht).
3. Das Backend pollt die Mailbox per Cron-Job (Standard: alle 2 Minuten, überschreibbar via `IMAP_POLL_CRON` in `.env`), verarbeitet ungelesene Nachrichten und markiert sie danach als gelesen — egal ob die Zustellung geklappt hat, damit eine unroutbare Mail (unbekanntes Token) nicht endlos erneut verarbeitet wird.
4. Ist nirgends ein Host gesetzt, läuft der Poll-Job als No-Op (nur eine Warnung im Log) — lokale Entwicklung funktioniert also auch ohne Mail-Konto.

> **Hinweis:** Die Cron-Jobs (Erinnerungen, Wochendigest, IMAP-Poll) laufen im selben Node-Prozess wie der API-Server (`node-cron`, registriert in `backend/src/index.ts`, deaktiviert wenn `NODE_ENV=test`). Für den Produktivbetrieb bei höherer Last ist ein separater Worker-Prozess empfehlenswert, damit lang laufende Jobs den API-Server nicht beeinträchtigen.

## Produktivhärtung

- **Verschlüsselte Google-Tokens**: `accessToken`/`refreshToken` in `GoogleAccount` werden AES-256-GCM-verschlüsselt gespeichert (`backend/src/lib/crypto.ts`). Erforderlich: `GOOGLE_TOKEN_ENCRYPTION_KEY` in `.env` (32 Byte, hex-kodiert — generieren mit `openssl rand -hex 32`). Ohne diesen Key schlägt jede Google-Verbindung/-Nutzung fehl statt Klartext-Tokens zu speichern.
- **Rate-Limiting für `/api/v1`**: 300 Requests / 15 Minuten pro API-Key (Fallback: IP), via `express-rate-limit` (`backend/src/routes/apiV1.ts`). Antworten enthalten die Standard-`RateLimit-*`-Header.
- **Brute-Force-Schutz für `/auth/login`**: 10 Versuche / 15 Minuten pro IP+E-Mail-Kombination (`backend/src/routes/auth.ts`).
- **Refresh-Token-Rotation**: Login/Registrierung setzen zwei Cookies — ein kurzlebiges Access-Token (`token`, 15 Min., JWT) und ein Refresh-Token (`refreshToken`, 30 Tage, zufälliger Wert, nur gehasht in der DB gespeichert, Cookie-Pfad `/auth`). `POST /auth/refresh` rotiert das Refresh-Token bei jeder Nutzung (Single-Use); wird ein bereits verwendetes/rotiertes Token erneut vorgelegt, gilt das als Diebstahlsignal und alle Refresh-Tokens der/des Nutzer:in werden widerrufen. Der Frontend-API-Client (`frontend/src/lib/api.ts`) ruft `/auth/refresh` transparent bei einem 401 auf und wiederholt den ursprünglichen Request einmal.
- **E-Mail-Verifizierung**: Bei der Registrierung wird automatisch eine Bestätigungsmail mit Link zu `/verify-email?token=...` verschickt (`POST /auth/verify-email`). Unbestätigte Accounts können sich weiterhin einloggen und die App nutzen (kein Hard-Block, um die Ersteinrichtung nicht zu blockieren), sehen aber im UI einen Hinweisbanner mit "Erneut senden"-Option (`POST /auth/resend-verification`).

## Build & Typecheck

```bash
# Backend
cd backend && npx tsc --noEmit

# Frontend
cd frontend && npm run build
```

## Tests

Backend-Tests (vitest + supertest) laufen gegen eine echte, separate Postgres-Testdatenbank (kein Mocking der DB) und decken Auth, Items-CRUD/Berechtigungen, Idee→Aufgabe-Konvertierung, Weekly Review, E-Mail-Inbound und die Cron-Job-Kernfunktionen ab — inklusive Regressionstests dafür, dass `passwordHash`/`emailInboundToken` nie in API-Antworten landen.

```bash
# Backend: einmalig eine Testdatenbank anlegen und Migrationen darauf anwenden
createdb nisorga_test
cd backend
DATABASE_URL="postgresql://<user>:<pass>@localhost:5432/nisorga_test?schema=public" npx prisma migrate deploy

# Backend-Tests ausführen
DATABASE_URL="postgresql://<user>:<pass>@localhost:5432/nisorga_test?schema=public" NODE_ENV=test npm test

# Frontend: Unit- und UI-Komponententests (Vitest + jsdom + React Testing Library)
cd frontend && npm test
```

Die Frontend-Testsuite (`cd frontend && npm test`) deckt neben der reinen Logik (`src/lib/waiting.test.ts`) jetzt auch UI-Komponententests mit Vitest + jsdom + React Testing Library ab: `AuthContext`, `ProtectedRoute`, `QuickCapture`, `useSpeechRecognition`, `ItemDetail` und `Login`. Der API-Client (`src/lib/api.ts`) wird darin per `vi.mock` ersetzt — es finden keine echten Netzwerkaufrufe statt.

## E2E-Tests

End-to-End-Tests mit [Playwright](https://playwright.dev/) liegen in `frontend/e2e/` und decken die zentralen Nutzerflüsse ab: Registrierung/Login/Logout (`auth.spec.ts`), Schnellerfassung → Konvertierung zu Aufgabe → "Wartet auf Rückmeldung" (`quick-capture-to-task.spec.ts`) sowie den Wochenrückblick (`review.spec.ts`). Jeder Testlauf verwendet eine frisch generierte, eindeutige E-Mail-Adresse pro Test, daher ist kein globaler DB-Reset nötig.

Setup:

```bash
cd frontend
npx playwright install --with-deps chromium
```

Voraussetzung: `backend/.env` muss vollständig ausgefüllt sein (siehe `backend/.env.example`), insbesondere `JWT_SECRET` und `GOOGLE_TOKEN_ENCRYPTION_KEY` — ohne diese startet das Backend nicht. Für die E2E-Tests genügt die normale (nicht die Test-)Datenbank aus dem Setup-Abschnitt oben, solange die Migrationen angewendet wurden (`npx prisma migrate deploy`).

`frontend/playwright.config.ts` startet Backend (`npm run dev` in `../backend`, Port 4000) und Frontend (`npm run dev`, Port 5173) automatisch über die `webServer`-Option (Array mit zwei Einträgen), sofern sie nicht schon laufen (`reuseExistingServer: !process.env.CI`). Ein manueller Start in zwei Terminals ist daher nicht nötig, funktioniert aber genauso — Playwright erkennt bereits laufende Server auf den konfigurierten Ports und startet sie dann nicht erneut.

```bash
cd frontend
npx playwright test
```

## Offene Punkte / TODO

- E-Mail-Verifizierung ist derzeit ein Soft-Gate (kein Login-Block); je nach Compliance-Anforderung ggf. auf Hard-Gate umstellen.

## Proxmox VE Deployment

Für den Betrieb auf einem eigenen Proxmox-VE-Host liegen unter [`scripts/`](scripts/) zwei unabhängige, in der **Proxmox-Shell** ausführbare Skripte:

### 1. Host-Vorbereitung (optional)

`scripts/proxmox-host-setup.sh` bereitet einen frisch installierten Proxmox-VE-Host für den produktiven Einsatz vor: Enterprise-Repo deaktivieren und `pve-no-subscription`-Repo einrichten, System aktualisieren, das Abo-Popup dauerhaft entfernen, gängige CLI-Tools installieren, Zeitzone/NTP konfigurieren. Idempotent, mit `--dry-run`, `--yes` und `--skip-*`-Flags.

```bash
sudo ./scripts/proxmox-host-setup.sh --help
sudo ./scripts/proxmox-host-setup.sh --yes
```

### 2. Nisorga in einem LXC-Container installieren

`scripts/nisorga-lxc-install.sh` legt einen neuen unprivilegierten LXC-Container an, klont dieses Repository hinein und installiert die Anwendung (über `scripts/nisorga-app-install.sh`, das dafür in den Container übertragen wird). Da dieses Repo ein `docker-compose.yml` enthält, wird automatisch Docker installiert und `docker compose up -d --build` ausgeführt — inklusive automatisch generierter `.env`/`backend/.env` mit zufälligen Secrets, falls diese noch nicht existieren (siehe [docs/deployment.md](docs/deployment.md) für die manuelle Variante mit Nginx Proxy Manager).

```bash
# Direkt in der Proxmox-Shell, ohne vorheriges Klonen:
bash <(curl -fsSL https://raw.githubusercontent.com/Wakko97/nisorga/main/scripts/nisorga-lxc-install.sh)

# Oder mit lokal ausgecheckstem Repo:
sudo ./scripts/nisorga-lxc-install.sh --help
sudo ./scripts/nisorga-lxc-install.sh --yes --ip 192.168.1.50/24 --gateway 192.168.1.1
```

Wichtige Optionen: `--ctid`, `--hostname`, `--storage`, `--bridge`, `--ip` (`dhcp` oder CIDR + `--gateway`), `--cores`, `--memory`, `--swap`, `--disk`, `--password`, `--branch`, `--privileged`, `--dry-run`. Am Ende gibt das Skript die Container-ID sowie das (ggf. generierte) Root-Passwort aus; Einstieg mit `pct enter <CTID>`.

**Wichtig:** Google-Kalender- und SMTP/IMAP-Integration werden dabei bewusst NICHT automatisch konfiguriert (siehe [Google-Kalender-Integration einrichten](#google-kalender-integration-einrichten) und [E-Mail (SMTP/IMAP) einrichten](#e-mail-smtpimap-einrichten)). SMTP/IMAP lässt sich nach dem Einrichtungswizard direkt in der App unter Einstellungen konfigurieren; alternativ (oder für Google Kalender) in `backend/.env` im Container (`/opt/nisorga/backend/.env`) nachtragen und `docker compose restart backend` ausführen. Ebenso ist standardmäßig kein Port für das Frontend nach außen freigegeben (siehe [docs/deployment.md](docs/deployment.md), Abschnitt zu `docker-compose.yml`) — für direkten Zugriff ohne eigenen Reverse Proxy den auskommentierten `ports`-Block beim `frontend`-Service in `docker-compose.yml` aktivieren.

### 3. Nisorga in einem bestehenden Container aktualisieren

`scripts/nisorga-lxc-update.sh` aktualisiert einen mit `nisorga-lxc-install.sh` erstellten Container auf den neuesten Stand (über `scripts/nisorga-update.sh`, das dafür in den Container übertragen und dort ausgeführt wird) und startet ihn per `docker compose up -d --build` neu. `.env`/`backend/.env` sowie hochgeladene Anhänge (`backend/uploads/`) bleiben dabei unangetastet.

Zwei Quellen für den neuen Code:

- **Git (Standard)**: holt den neuesten Commit des angegebenen Branches (`git fetch` + `git reset --hard`).
- **GitHub-ZIP**: ein lokal heruntergeladenes ZIP (z. B. über GitHub "Code → Download ZIP" für einen Branch/Tag/Commit, oder ein Release-Asset) wird auf den Proxmox-Host hochgeladen, in den Container übertragen und dort eingespielt — praktisch ohne Git-Zugriff aus dem Container heraus, oder um gezielt einen bestimmten heruntergeladenen Stand einzuspielen.

```bash
# Update per Git auf den neuesten main-Commit
sudo ./scripts/nisorga-lxc-update.sh --ctid 135

# Update aus einem lokal heruntergeladenen GitHub-ZIP
sudo ./scripts/nisorga-lxc-update.sh --ctid 135 --zip /root/nisorga-main.zip
```

Wichtige Optionen: `--ctid` (Pflicht), `--branch`, `--zip`, `--dir` (Installationsverzeichnis im Container, Standard `/opt/nisorga`), `--dry-run`.

### 4. Backup & Restore

`scripts/nisorga-lxc-backup.sh` sichert Postgres-Datenbank und `backend/uploads/` (Anhänge) eines Containers als ein `.tar.gz` — erzeugt via `scripts/nisorga-backup.sh` im Container, danach per `pct pull` auf den Proxmox-Host geholt (damit das Backup auch bei Verlust des Containers erhalten bleibt; das Zielverzeichnis auf dem Host sollte selbst wieder in ein reguläres Proxmox-Backup/Replikation einbezogen werden).

```bash
# Backup erstellen (landet standardmäßig unter /var/lib/vz/nisorga-backups/<CTID>/ auf dem Host)
sudo ./scripts/nisorga-lxc-backup.sh --ctid 135

# Backup einspielen (DESTRUKTIV: ersetzt DB und Anhänge im Container)
sudo ./scripts/nisorga-lxc-backup.sh --ctid 135 --restore /var/lib/vz/nisorga-backups/135/nisorga-backup-20260901-020000.tar.gz
```

Wichtige Optionen: `--ctid` (Pflicht), `--dest` (Zielverzeichnis auf dem Host), `--keep` (Aufbewahrungsanzahl im Container, Standard 7), `--restore`, `--dry-run`.

### 5. Automatische Zeitpläne (Update/Backup)

`scripts/nisorga-lxc-schedule.sh` richtet im Container einen systemd-Timer ein, der Update, Backup oder Healthcheck (siehe [Abschnitt 7](#7-monitoring--health-check)) regelmäßig automatisch anstößt — ohne Cron-Paket, nur mit Bordmitteln von Debian.

```bash
# Backup täglich um 02:00, 14 Stück aufbewahren
sudo ./scripts/nisorga-lxc-schedule.sh --ctid 135 --task backup -- --keep 14

# Update wöchentlich sonntags um 03:00 auf main
sudo ./scripts/nisorga-lxc-schedule.sh --ctid 135 --task update --schedule "Sun 03:00" -- --branch main

# Zeitplan wieder entfernen
sudo ./scripts/nisorga-lxc-schedule.sh --ctid 135 --task backup --disable
```

Wichtige Optionen: `--ctid` (Pflicht), `--task update|backup|healthcheck` (Pflicht), `--schedule` (systemd-`OnCalendar`-Ausdruck, siehe `man systemd.time`; Standard: `03:00` für Updates, `02:00` für Backups, `*:0/5` (alle 5 Minuten) für Healthchecks), `--disable`. Alles nach `--` wird 1:1 an das geplante Skript durchgereicht (z. B. `--branch`, `--keep`, `--alert-email`).

**Hinweis:** Das automatische Update pullt aus Git und baut/startet per Docker Compose neu — bei laufendem Betrieb kurzzeitig nicht erreichbar, keine Vorab-Prüfung auf Breaking Changes. Für produktive Instanzen ggf. lieber manuell anstoßen (`nisorga-lxc-update.sh`) oder vorher testen.

### 6. HTTPS ohne eigenen Reverse Proxy (Caddy)

Falls kein Nginx Proxy Manager (siehe [docs/deployment.md](docs/deployment.md)) vorhanden ist, richtet `scripts/nisorga-lxc-tls-setup.sh` stattdessen [Caddy](https://caddyserver.com/) als Reverse Proxy mit automatischem Let's-Encrypt-Zertifikat ein — als zusätzlicher Docker-Compose-Service (`docker-compose.tls.yml`), der intern an den `frontend`-Service weiterleitet (dessen eigener nginx kümmert sich schon um das API-Proxying zum Backend).

Voraussetzungen (nicht Teil des Skripts): eine Domain, deren DNS auf die öffentliche IP dieses Containers zeigt, sowie Port 80 (ACME-HTTP-01-Challenge) und 443 von außen erreichbar (Portweiterleitung am Router auf den Proxmox-Host bzw. Container).

```bash
sudo ./scripts/nisorga-lxc-tls-setup.sh --ctid 135 --domain nisorga.deine-domain.tld --email du@deine-domain.tld

# Wieder entfernen
sudo ./scripts/nisorga-lxc-tls-setup.sh --ctid 135 --disable
```

Wichtige Optionen: `--ctid` (Pflicht), `--domain` (Pflicht außer bei `--disable`), `--email` (für Let's-Encrypt-Benachrichtigungen), `--dir`, `--disable`, `--dry-run`. Zertifikatsstatus prüfen: `docker compose -f docker-compose.yml -f docker-compose.tls.yml logs -f caddy` im Container.

### 7. Monitoring / Health-Check

Die Docker-Images von `postgres`, `backend` und `frontend` bringen bereits einen nativen Docker-`HEALTHCHECK` mit (Backend/Frontend pollen `GET /health` bzw. die nginx-Startseite alle 30s). `scripts/nisorga-healthcheck.sh` liest diesen Status über `docker inspect`, versucht bei einem ungesunden Service standardmäßig einen `docker compose restart`, und schickt bei anhaltendem Problem optional eine Alarmierung — per Webhook (z. B. Slack/Discord/ntfy.sh, JSON `{"text": "..."}`) und/oder E-Mail über die in `backend/.env` gesetzten `SMTP_*`-Variablen (die Settings-UI-Mailkonfiguration liegt nur in der DB und ist von diesem reinen Shell-Skript aus nicht erreichbar — für Alarm-Mails also `SMTP_*` zusätzlich in `.env` setzen, auch wenn der eigentliche Mailversand der App über die UI läuft).

Am sinnvollsten als Zeitplan (siehe Abschnitt 5) eingerichtet:

```bash
sudo ./scripts/nisorga-lxc-schedule.sh --ctid 135 --task healthcheck -- --alert-email du@deine-domain.tld --webhook-url https://hooks.slack.com/services/...
```

Wichtige Optionen von `nisorga-healthcheck.sh`: `--dir`, `--no-restart` (keinen automatischen Neustart versuchen), `--alert-email`, `--webhook-url`, `--dry-run`. Exit-Code `0` = alles gesund, `1` = mindestens ein Service weiterhin ungesund — auch direkt für externes Monitoring per SSH-Aufruf nutzbar, unabhängig von Alarmierungs-Flags.
