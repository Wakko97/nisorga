# nisorga

## Proxmox VE Host Setup

`scripts/proxmox-host-setup.sh` ist ein Post-Installations-Skript für einen frisch installierten Proxmox VE Host. Es ist **kein** Skript, das Proxmox selbst installiert (das erfolgt über das offizielle ISO), sondern richtet einen bestehenden Proxmox-Host für den produktiven Einsatz ein.

Das Skript erledigt folgende Schritte (jeweils einzeln abschaltbar):

- Enterprise-Repository deaktivieren und das kostenlose `pve-no-subscription`-Repository einrichten (inkl. Deaktivierung eines eventuell vorhandenen Ceph-Enterprise-Repos)
- System aktualisieren (`apt update && apt full-upgrade`)
- Das Abo-Popup ("No valid subscription") im Webinterface dauerhaft entfernen (übersteht auch künftige `pve-manager`-Updates)
- Gängige CLI-Tools installieren (curl, vim, htop, git, chrony, …)
- Zeitzone setzen und Zeitsynchronisation (chrony/systemd-timesyncd) aktivieren

Das Skript ist idempotent und kann gefahrlos mehrfach ausgeführt werden.

### Verwendung

```bash
sudo ./scripts/proxmox-host-setup.sh --help
sudo ./scripts/proxmox-host-setup.sh --dry-run          # zeigt nur, was gemacht würde
sudo ./scripts/proxmox-host-setup.sh --yes               # ohne Rückfragen durchlaufen
sudo ./scripts/proxmox-host-setup.sh --timezone Europe/Berlin
```

Einzelne Schritte lassen sich mit `--skip-repo`, `--skip-update`, `--skip-nag`, `--skip-tools` bzw. `--skip-time` überspringen.

Ein Log der ausgeführten Schritte wird zusätzlich unter `/var/log/proxmox-host-setup.log` abgelegt.
