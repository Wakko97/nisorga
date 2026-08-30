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
- **Mehrbenutzer**: Der erste registrierte User wird automatisch `OWNER`, alle weiteren `MEMBER`. Owner sehen alle Items, Mitglieder nur eigene bzw. ihnen zugewiesene.
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

   Backend `.env` ausfüllen: `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `PORT`, `FRONTEND_URL`.

   > **Hinweis:** `GoogleAccount.accessToken`/`refreshToken` werden für dieses MVP als Klartext-Strings in der Datenbank gespeichert (keine zusätzliche Verschlüsselung). Stellt sicher, dass die Datenbank (Zugriff, Netzwerk, Backups) entsprechend abgesichert ist, da diese Tokens Zugriff auf den Google-Kalender des jeweiligen Nutzers geben.

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

## Google-Kalender-Integration einrichten

1. In der Google Cloud Console ein Projekt anlegen, die "Google Calendar API" aktivieren.
2. OAuth2-Client-ID (Typ "Webanwendung") anlegen, als Redirect-URI `http://localhost:4000/integrations/google/callback` eintragen.
3. Client-ID/-Secret in `backend/.env` eintragen.
4. In der App unter **Einstellungen** auf "Google Kalender verbinden" klicken.

## Externe Integrations-API

Siehe [docs/api.md](docs/api.md) für die vollständige Dokumentation der `/api/v1`-Schnittstelle (API-Key-Auth) sowie der Webhooks.

## Erweiterte Features

- **Wochenrückblick** (`/review`, Backend `GET /review/weekly`): zeigt offene Inbox-Punkte, überfällige Aufgaben und seit über 3 Tagen unbearbeitete Ideen, mit Inline-Aktionen (Priorität setzen, zu Aufgabe konvertieren, zuweisen, archivieren). Dieselbe Sichtbarkeitslogik wie bei `/items` (Owner sehen alles, Mitglieder nur eigene/zugewiesene Items).
- **E-Mail-Erfassung**: Jeder Nutzer bekommt eine persönliche Inbound-Adresse (`inbox+<token>@<EMAIL_INBOUND_DOMAIN>`, sichtbar/kopierbar unter Einstellungen). Eingehende Mails werden über SendGrid Inbound Parse als Idee in der Inbox angelegt (`source=EMAIL`).
- **Delegations-Tracking & Erinnerungen**: Items können auf Status „Wartet auf Rückmeldung" (`WAITING`) gesetzt werden; `waitingSince` wird automatisch gepflegt. Ein täglicher Cron-Job verschickt nach `WAITING_REMINDER_DAYS` (Default 3) eine Erinnerungsmail an Ersteller:in und Zugewiesene:n. Aufgaben-/Matrix-Ansicht zeigen ein rotes "überfällig, wartet seit X Tagen"-Badge.
- **Wochenrückblick-Digest**: Ein wöchentlicher Cron-Job (freitags 08:00) verschickt die Wochenrückblick-Daten aller Nutzer:innen als HTML-Mail.
- **Sprachnotiz**: Mikrofon-Button im Schnellerfassungsfeld nutzt die Web-Speech-API (`de-DE`), um gesprochenen Text direkt als Titel zu übernehmen. Wird ausgeblendet/deaktiviert, wenn der Browser die API nicht unterstützt.

### SendGrid einrichten

1. Im SendGrid-Konto eine **Inbound Parse**-Domain/-Subdomain einrichten (z. B. `inbound.deine-domain.tld`) und den MX-Eintrag entsprechend SendGrid-Anleitung setzen.
2. Als Webhook-URL `https://<backend-host>/integrations/email/inbound?secret=<EMAIL_INBOUND_SECRET>` eintragen (POST, multipart/form-data — "Post the raw, full MIME message" kann deaktiviert bleiben, da nur `to`/`subject`/`text` ausgewertet werden).
3. In `backend/.env` `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `EMAIL_INBOUND_SECRET` und `EMAIL_INBOUND_DOMAIN` (= die eingerichtete Inbound-Parse-Domain) setzen.
4. Ohne gesetzten `SENDGRID_API_KEY` versendet `sendEmail()` keine echten Mails, sondern loggt nur eine Warnung — lokale Entwicklung funktioniert also auch ohne SendGrid-Account.

> **Hinweis:** Die Cron-Jobs (Erinnerungen, Wochendigest) laufen im selben Node-Prozess wie der API-Server (`node-cron`, registriert in `backend/src/index.ts`, deaktiviert wenn `NODE_ENV=test`). Für den Produktivbetrieb bei höherer Last ist ein separater Worker-Prozess empfehlenswert, damit lang laufende Jobs den API-Server nicht beeinträchtigen.

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

# Frontend: Unit-Tests für reine Logik (z.B. Überfällig-Berechnung)
cd frontend && npm test
```

## Offene Punkte / TODO

- Für Produktivbetrieb: Verschlüsselung der Google-Tokens in der DB, Rate-Limiting für `/api/v1`, Refresh-Token-Rotation, E-Mail-Verifizierung bei der Registrierung.
- Testabdeckung bisher auf Backend-Kernflows und die verwundbarsten Frontend-Funktionen fokussiert; UI-Komponententests (React Testing Library) und E2E-Tests (Playwright) fehlen noch.
