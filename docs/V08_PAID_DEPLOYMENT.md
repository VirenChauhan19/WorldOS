# Optional paid Render deployment — future production use

**This configuration incurs hosting charges. It is preserved separately and was not deployed or authorized.** For $0 hosting use root `render.yaml` and the [Free guide](V08_DEPLOYMENT.md).

[deploy/render.paid.yaml](../deploy/render.paid.yaml) retains the original **Standard** service and **5 GB disk** at `/var/data`, `/var/data/worldos` workspace, one worker, concurrency ceiling 32, 12 MiB uploads, 24 MP images, two active writes, and daily backups. Authentication, CSRF, health checks, and provider secret prompts are preserved. `WORLDOS_STORAGE_MODE=persistent` requires the disk; startup never silently falls back to ephemeral storage. The entry point drops to uid/gid 10001 before serving.

Before any future paid deployment, review [pricing](https://render.com/pricing) and [disk behavior](https://render.com/docs/disks). The Dockerfile/context are relative to the repository root. Do not manage one service with both Blueprints. When switching from Free, also remove its resource-limit environment overrides or set the paid defaults; Render retains variables omitted from a subsequent Blueprint. Export the free workspace first.

## Data and backups

The directory contains `worldos.sqlite3` (owner photos/templates/inspections/trials), `auth.sqlite3` (session fingerprints/expiry), `judge-demo/worldos.sqlite3` (isolated demo data), and `backups/` (owner snapshots/metadata).

Public startup and every 24 hours create integrity-checked SQLite online backups, retaining seven atomic snapshots with timestamp/SHA-256 metadata. Photos/evidence are included; sessions and credentials are excluded. Judge data needs a separate CLI backup. Authenticated owners can POST `/api/admin/backups` with CSRF, then download GET `/api/admin/backups/latest`; judges receive 403. Keep copies outside the disk. Disk-backed services are single-instance and have a deployment interruption. Monitor capacity and backup logs.

## Restore without overwriting active data

Create a local snapshot at a new output path:

```powershell
.\.venv\Scripts\python.exe scripts/backup_workspace.py --data-dir .\data --output .\artifacts\worldos-backup.sqlite3
```

For an explicitly authorized paid service, upload through its SSH/SFTP access and restore into a new directory:

```sh
python scripts/backup_workspace.py --data-dir /var/data/worldos-restored --restore /path/to/uploaded-snapshot.sqlite3
```

Set `WORLDOS_DATA_DIR=/var/data/worldos-restored` and restart. Startup validates its disk location, fixes known database ownership, and runs migrations. Keep the prior directory until restored photos/evidence are verified. Never overwrite the active database. Workspace restore does not restore sessions; sign in again.

The public verifier's `--check-restart` checks that the same session/template/photo survive restart; use it only with persistent storage. `--live-ai` separately opts into potentially billed provider requests. Omit it for software-only verification.
