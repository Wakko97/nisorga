# Externe Integrations-API (`/api/v1`)

Diese Schnittstelle richtet sich an externe Systeme (Zapier, Make, eigene Skripte, ...), die Ideen/Aufgaben in Nisorga anlegen oder auslesen wollen. Sie ist **getrennt** von der Session-Cookie-Auth des Frontends und wird per API-Key (Bearer-Token) abgesichert.

## Authentifizierung

1. In der App unter **Einstellungen → API-Keys** einen neuen Key erzeugen. Der Klartext-Key wird nur einmal angezeigt — sicher aufbewahren, es wird nur ein Hash in der Datenbank gespeichert.
2. Den Key als `Authorization: Bearer <key>` Header bei jedem Request an `/api/v1/*` mitschicken.

```bash
curl -H "Authorization: Bearer nis_xxxxxxxx..." https://your-domain/api/v1/items
```

Ein ungültiger oder fehlender Key liefert `401 Unauthorized`.

## Endpunkte

### `GET /api/v1/items`

Liefert alle Items, auf die der Key-Besitzer Zugriff hat (Owner: alle Items; Mitglied: eigene erstellte oder ihm zugewiesene Items).

**Response 200**

```json
[
  {
    "id": "uuid",
    "type": "IDEA",
    "title": "Neue Produktidee",
    "description": null,
    "status": "INBOX",
    "important": false,
    "urgent": false,
    "dueDate": null,
    "createdById": "uuid",
    "assignedToId": null,
    "googleEventId": null,
    "createdAt": "2026-01-01T10:00:00.000Z",
    "updatedAt": "2026-01-01T10:00:00.000Z"
  }
]
```

### `POST /api/v1/items`

Legt ein neues Item an. Der Key-Besitzer wird automatisch als Ersteller (`createdBy`) gesetzt.

**Body**

| Feld          | Typ     | Pflicht | Standard |
|---------------|---------|---------|----------|
| `title`       | string  | ja      | —        |
| `description` | string  | nein    | `null`   |
| `type`        | `"IDEA"` \| `"TASK"` | nein | `"IDEA"` |
| `status`      | `"INBOX"` \| `"TODO"` \| `"IN_PROGRESS"` \| `"DONE"` | nein | `"INBOX"` |
| `important`   | boolean | nein    | `false`  |
| `urgent`      | boolean | nein    | `false`  |
| `dueDate`     | ISO-8601 string | nein | `null` |

**Response 201**: das angelegte Item (gleiche Form wie oben).

## Webhooks

Unter **Einstellungen → Webhooks** (App-UI, Session-Auth) können Ziel-URLs abonniert werden, die bei bestimmten Ereignissen per `POST` benachrichtigt werden. Unterstützte Events aktuell:

- `item.created`
- `item.updated`

**Payload**

```json
{
  "event": "item.created",
  "item": { "...": "..." }
}
```

Die Zustellung erfolgt asynchron ("fire-and-forget"): ein Fehler oder Timeout beim Empfänger blockiert keine App-Anfragen und wird nur serverseitig geloggt. Es gibt aktuell keine automatischen Retries — der Empfänger sollte idempotent mit Wiederholungen umgehen können, falls später Retries ergänzt werden.
