# Backups

PiLedger stores everything in a single SQLite file. Backing up is a matter of copying that file safely; restoring is copying it back.

## Important: use SQLite's `.backup`, not a plain file copy

SQLite uses write-ahead logging and may have uncommitted pages in memory or in the WAL file at any moment. A plain `cp` of the database file while the server is running can produce a corrupt copy. The SQLite CLI's `.backup` command produces a consistent snapshot even with concurrent writes — always use it instead of a raw file copy.

## Docker: one-shot backup

Shell into the running container and use the SQLite CLI:

```bash
docker compose exec piledger \
  sqlite3 /data/piledger.db ".backup '/data/backups/piledger-$(date +%Y-%m-%d).db'"
```

Then copy the backup out to the host:

```bash
docker compose cp piledger:/data/backups/ ./backups/
```

## Bare-metal: one-shot backup

```bash
sqlite3 /path/to/piledger/piledger.db \
  ".backup '/path/to/backups/piledger-$(date +%Y-%m-%d).db'"
```

## Automated backups with cron

A daily cron job with weekly rotation keeps the last seven days on disk without manual intervention.

```bash
# Edit the crontab for the user that owns the database
crontab -e
```

Add the following line (adjust paths as needed):

```cron
0 3 * * * sqlite3 /path/to/piledger/piledger.db ".backup '/path/to/backups/piledger-$(date +\%Y-\%m-\%d).db'" && find /path/to/backups -name 'piledger-*.db' -mtime +7 -delete
```

This runs at 03:00 daily, creates a date-stamped backup, and deletes any backup older than seven days.

For a Docker deployment, wrap the `docker compose exec` form in a host-side cron entry instead:

```cron
0 3 * * * docker compose -f /path/to/piledger/docker-compose.yml exec -T piledger sqlite3 /data/piledger.db ".backup '/data/backups/piledger-$(date +\%Y-\%m-\%d).db'"
```

## Restoring from a backup

1. **Stop the application** so nothing is writing to the database.

   ```bash
   # Docker
   docker compose down

   # Bare-metal / systemd
   sudo systemctl stop piledger
   ```

2. **Replace the live database with the backup.**

   ```bash
   # Docker — copy the backup into the volume
   docker compose cp ./backups/piledger-2026-05-20.db piledger:/data/piledger.db

   # Bare-metal — direct file copy (server is stopped, so cp is safe)
   cp /path/to/backups/piledger-YYYY-MM-DD.db /path/to/piledger/piledger.db
   ```

3. **Start the application.**

   ```bash
   docker compose up -d
   # or
   sudo systemctl start piledger
   ```

4. **Verify the restore.** Log in with the credentials that existed at backup time, hit `/healthz` (should return 200), and check `/api/summary` to confirm totals match the pre-backup state.

## Per-user data export

For individual user portability (as opposed to a whole-database backup), PiLedger also provides `GET /api/export` (shipped in v0.20.0). This returns a JSON dump of a single user's accounts, balance history, budget items, and exchange rates — useful for migrating one user's data or for the user themselves to keep a personal archive. See [API Reference — Data lifecycle](api-reference.md#data-lifecycle).
