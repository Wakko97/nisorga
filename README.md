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

## Nisorga-Installation (LXC-Container)

`scripts/nisorga-lxc-install.sh` wird **in der Proxmox-VE-Shell** (als root auf dem Proxmox-Host) ausgeführt. Es legt einen neuen unprivilegierten LXC-Container an und installiert darin die Anwendung aus diesem Repository (`scripts/nisorga-app-install.sh` wird dafür in den Container übertragen und dort ausgeführt).

Der Installer erkennt den Anwendungs-Stack automatisch anhand vorhandener Dateien im Repo:

- `docker-compose.yml` / `compose.yml` → installiert Docker und startet `docker compose up -d --build`
- `package.json` → installiert Node.js, führt `npm install`/`npm run build` aus und legt einen systemd-Service `nisorga` an
- `requirements.txt` / `pyproject.toml` → installiert Python in einem venv unter `/opt/nisorga/.venv`
- `Dockerfile` (ohne Compose) → baut das Image `nisorga:latest`
- Ist nichts davon vorhanden (aktuell der Fall, das Repo enthält noch keine Anwendung), wird das Repository nach `/opt/nisorga` geklont und eine entsprechende Meldung ausgegeben.

### Verwendung

Direkt in der Proxmox-Shell, ohne vorheriges Klonen:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Wakko97/nisorga/main/scripts/nisorga-lxc-install.sh)
```

Oder mit lokal ausgecheckstem Repo:

```bash
sudo ./scripts/nisorga-lxc-install.sh --help
sudo ./scripts/nisorga-lxc-install.sh --yes
sudo ./scripts/nisorga-lxc-install.sh --ctid 105 --hostname nisorga --storage local-lvm --ip 192.168.1.50/24 --gateway 192.168.1.1
```

Wichtige Optionen: `--ctid`, `--hostname`, `--storage`, `--bridge`, `--ip` (`dhcp` oder CIDR + `--gateway`), `--cores`, `--memory`, `--swap`, `--disk`, `--password`, `--branch`, `--privileged`, `--dry-run`.

Am Ende gibt das Skript die Container-ID sowie (falls generiert) das Root-Passwort aus. Einstieg in den Container: `pct enter <CTID>`.
