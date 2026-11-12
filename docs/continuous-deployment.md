# Continuous deployment

GitHub Actions workflow **CD** publishes a production release after **CI** succeeds
on a push to `main`. It checks that the successful commit is still current `main`,
builds the Linux amd64 Go API, packages the committed source and a `REVISION` file,
and publishes `sibk-<full commit SHA>` with `sibk-linux-amd64.tar.gz` and
`SHA256SUMS`. Drafts hide incomplete uploads. Pull requests never publish releases.
The manual **Run workflow** button also requires passing push CI for current `main`.

The host `malwildan-MacBookAir` checks GitHub every two minutes with
`sibk-update.timer`. It uses outbound HTTPS and public release downloads, so no SSH
key, personal access token, production secret, or self-hosted Actions runner is
needed in GitHub. After publication, CD waits for the host's public revision and
checks the rendered login in Chromium for disappearing content, JavaScript errors,
and accidental development-client resources. CD succeeds only after that check.
The host independently requires an Actions-authored release and assets, verifies
that the tag resolves to its named commit on `main`, and checks successful push
CI for that exact commit before staging it.

## Host layout and activation

- Original app and persistent data: `/home/malwildan/apps/sibk`.
- Releases: `.deploy/releases/<SHA>`; active release: `.deploy/current`.
- `backend/.env`, `backend/storage`, `ai-service/.env`, and `ai-service/models`
  stay in the original directory and are linked into each release. Models remain
  host-managed: install compatible weights and manifest together when changing models.
- Python dependencies reuse the original virtualenv when the pinned lock is
  unchanged. A changed lock gets its own virtualenv under `.deploy/venvs`.
- Frontend dependencies use `bun install --frozen-lockfile`; a frontend build must
  pass before activation. The web service runs `bun run preview` on the same port,
  serving compiled, hashed assets and preserving Vite's same-origin API proxy.
  CI also exercises the compiled frontend in its browser suite.
- After staging, the updater stops only the three `sibk-*` app services, backs up
  SQLite through its backup API, runs dbmate migrations, switches `current`, and
  restarts. It checks API/database health, frontend proxy health, public HTTPS,
  frontend revision, and real-mode AI model readiness.
- Failure restores the previous symlink and pre-migration SQLite snapshot, then
  restarts and checks the old version. A failed activation is not retried on every
  timer tick. Preparation failures leave the running app untouched and can retry.

The updater itself lives outside releases at
`~/.local/share/sibk/update.py`. User service drop-ins override `WorkingDirectory`
and `ExecStart` to use `.deploy/current` while retaining existing environment,
dependencies, restart policy, and persistent env files.

## Operations

```sh
systemctl --user status sibk-update.timer sibk-update.service
journalctl --user -u sibk-update.service -n 80 --no-pager
cat ~/apps/sibk/.deploy/status.json
curl -fsS "https://sibk.hailmary.my.id/deployment.json?check=$(date +%s)"
systemctl --user start sibk-update.service  # check immediately
systemctl --user stop sibk-update.timer    # pause automatic updates
```

Prefer reverting a bad commit on `main`: CI then publishes a fresh release.
For an activation failure that has been repaired on the host, remove the
`failed_revision` field from `.deploy/status.json` and start the updater to retry.
Backups are `.deploy/backups/<SHA>.sqlite`; prior releases and virtualenvs are kept
for recovery and require occasional disk-space maintenance. Deployments briefly
interrupt active inspection sessions while services restart. Rollback restores
the snapshot taken while writers were stopped; it is not a backup of later user work.

## Bootstrap on an already provisioned host

1. Copy `scripts/update.py` to `~/.local/share/sibk/update.py`, and the two
   `scripts/sibk-update.*` units to `~/.config/systemd/user/`.
2. Create `.deploy/current` as a symlink to the original app directory. Back up
   the three original SIBK units, then add drop-ins pointing their working
   directories and executable paths into `.deploy/current`. Install
   `scripts/sibk-web.conf` as `sibk-web.service.d/10-deploy-current.conf` so the web
   unit serves the compiled frontend. Keep existing `EnvironmentFile` paths and
   web/API environment settings.
3. Reload user units and enable `sibk-update.timer`. Start the updater once and
   verify its journal, status file, public revision, and application health.

Prerequisites: Linux x86_64, systemd user services with lingering enabled, Python
3.12 with venv support, Bun matching `frontend/package.json`, and dbmate on PATH.
Python dependency changes also need access to the configured CPU wheel index.

The CI gate follows GitHub's
[workflow_run event semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).
