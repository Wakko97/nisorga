# Nisorga

Eine Web-App für Geschäftsführer:innen zur schnellen Erfassung von Ideen und Aufgaben (GTD-artig), mit Eisenhower-Matrix, Mehrbenutzer-Unterstützung (Owner + Mitglieder/Assistenz), Google-Kalender-Sync und einer offenen Integrations-API (API-Key + Webhooks).

## Struktur

Monorepo mit npm workspaces:

```
/backend   Node.js + Express + TypeScript + Prisma + PostgreSQL
/frontend  React + Vite + TypeScript + Tailwind CSS + React Router + TanStack Query
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
3. **Server-Konfiguration** — reine Statusanzeige (`GET /setup/status`), ob Google Calendar, SendGrid und der E-Mail-Empfang serverseitig konfiguriert sind. Secrets werden bewusst NICHT über den Browser gesetzt — das bleibt Sache der `.env`-Datei (siehe oben und [Produktivhärtung](#produktivhärtung)).

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
- **E-Mail-Erfassung**: Jeder Nutzer bekommt eine persönliche Inbound-Adresse (`inbox+<token>@<EMAIL_INBOUND_DOMAIN>`, sichtbar/kopierbar unter Einstellungen). Eingehende Mails werden über SendGrid Inbound Parse als Idee in der Inbox angelegt (`source=EMAIL`).
- **Delegations-Tracking & Erinnerungen**: Items können auf Status „Wartet auf Rückmeldung" (`WAITING`) gesetzt werden; `waitingSince` wird automatisch gepflegt. Ein täglicher Cron-Job verschickt nach `WAITING_REMINDER_DAYS` (Default 3) eine Erinnerungsmail an Ersteller:in und Zugewiesene:n. Aufgaben-/Matrix-Ansicht zeigen ein rotes "überfällig, wartet seit X Tagen"-Badge.
- **Wochenrückblick-Digest**: Ein wöchentlicher Cron-Job (freitags 08:00) verschickt die Wochenrückblick-Daten aller Nutzer:innen als HTML-Mail.
- **Sprachnotiz**: Mikrofon-Button im Schnellerfassungsfeld nutzt die Web-Speech-API (`de-DE`), um gesprochenen Text direkt als Titel zu übernehmen. Wird ausgeblendet/deaktiviert, wenn der Browser die API nicht unterstützt.
- **Kamera-Scan**: Kamera-Button (📷) im Schnellerfassungsfeld öffnet auf Mobilgeräten direkt die Rückkamera (`<input type="file" capture="environment">`). Das Foto wird clientseitig per Tesseract.js (deutsches Sprachpaket, dynamisch nachgeladen — kein Teil des Haupt-Bundles) per OCR ausgewertet; der erkannte Text (erste ~80 Zeichen) erscheint als bearbeitbarer Titel-Vorschlag. Beim Speichern wird zuerst das Item angelegt (`source=SCAN`) und danach das Foto per `POST /items/:id/attachment` als Anhang hochgeladen. Anhänge liegen serverseitig unter `UPLOADS_DIR` (Default `./uploads`) unter einem zufälligen Dateinamen und werden ausschließlich über die authentifizierte Route `GET /items/:id/attachment` ausgeliefert (kein öffentlicher Static-Mount), damit die Item-Sichtbarkeitsregeln greifen. In `docker-compose.yml` liegt `UPLOADS_DIR` auf dem benannten Volume `uploads_data`, damit Anhänge Container-Neustarts überleben.

### SendGrid einrichten

1. Im SendGrid-Konto eine **Inbound Parse**-Domain/-Subdomain einrichten (z. B. `inbound.deine-domain.tld`) und den MX-Eintrag entsprechend SendGrid-Anleitung setzen.
2. Als Webhook-URL `https://<backend-host>/integrations/email/inbound?secret=<EMAIL_INBOUND_SECRET>` eintragen (POST, multipart/form-data — "Post the raw, full MIME message" kann deaktiviert bleiben, da nur `to`/`subject`/`text` ausgewertet werden).
3. In `backend/.env` `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `EMAIL_INBOUND_SECRET` und `EMAIL_INBOUND_DOMAIN` (= die eingerichtete Inbound-Parse-Domain) setzen.
4. Ohne gesetzten `SENDGRID_API_KEY` versendet `sendEmail()` keine echten Mails, sondern loggt nur eine Warnung — lokale Entwicklung funktioniert also auch ohne SendGrid-Account.

> **Hinweis:** Die Cron-Jobs (Erinnerungen, Wochendigest) laufen im selben Node-Prozess wie der API-Server (`node-cron`, registriert in `backend/src/index.ts`, deaktiviert wenn `NODE_ENV=test`). Für den Produktivbetrieb bei höherer Last ist ein separater Worker-Prozess empfehlenswert, damit lang laufende Jobs den API-Server nicht beeinträchtigen.

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

Voraussetzung: `backend/.env` muss vollständig ausgefüllt sein (siehe `backend/.env.example`), insbesondere `JWT_SECRET`, `EMAIL_INBOUND_SECRET` und `GOOGLE_TOKEN_ENCRYPTION_KEY` — ohne diese startet das Backend nicht. Für die E2E-Tests genügt die normale (nicht die Test-)Datenbank aus dem Setup-Abschnitt oben, solange die Migrationen angewendet wurden (`npx prisma migrate deploy`).

`frontend/playwright.config.ts` startet Backend (`npm run dev` in `../backend`, Port 4000) und Frontend (`npm run dev`, Port 5173) automatisch über die `webServer`-Option (Array mit zwei Einträgen), sofern sie nicht schon laufen (`reuseExistingServer: !process.env.CI`). Ein manueller Start in zwei Terminals ist daher nicht nötig, funktioniert aber genauso — Playwright erkennt bereits laufende Server auf den konfigurierten Ports und startet sie dann nicht erneut.

```bash
cd frontend
npx playwright test
```

## Offene Punkte / TODO

- E-Mail-Verifizierung ist derzeit ein Soft-Gate (kein Login-Block); je nach Compliance-Anforderung ggf. auf Hard-Gate umstellen.
