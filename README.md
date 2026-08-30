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

## Build & Typecheck

```bash
# Backend
cd backend && npx tsc --noEmit

# Frontend
cd frontend && npm run build
```

## Offene Punkte / TODO

- Es wurde keine echte PostgreSQL-Instanz für diese Umgebung bereitgestellt; `prisma migrate dev` wurde daher nicht gegen eine laufende Datenbank ausgeführt. Das Schema ist mit `npx prisma validate` geprüft.
- Für Produktivbetrieb: Verschlüsselung der Google-Tokens in der DB, Rate-Limiting für `/api/v1`, Refresh-Token-Rotation, E-Mail-Verifizierung bei der Registrierung.
