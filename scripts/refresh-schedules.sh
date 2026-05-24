#!/usr/bin/env bash
#
# Refresh CTA schedule data and push it so the live site redeploys.
#
# Pipeline:
#   1. fast-forward the repo        (so the eventual push isn't rejected)
#   2. rebuild public/data          (downloads the GTFS feed + bus patterns)
#   3. guard with tests + lint      (deploy.yml gates on these too)
#   4. commit + push public/data IF it changed -> GitHub Pages deploy fires
#
# Designed to run unattended from cron. GTFS changes only land on CTA
# service-change days, so weekly is plenty. See cron/crontab.txt for the
# ready-to-install entry and a safe-append one-liner.
#
# Prerequisites on the server:
#   - dependencies installed (`npm ci`).
#   - CTA_BUS_KEY present in this repo's .env (build-index reads it for bus
#     pattern geometry; the GTFS schedule download itself needs no key).
#   - `git push` can authenticate non-interactively (SSH remote or a stored
#     credential helper). The remote is https by default — switch to SSH or
#     configure a credential helper if cron pushes fail.

set -euo pipefail

# Strip ANSI color from tool output — this runs unattended into a log file, and
# vitest/biome/npm otherwise emit escape codes that render as noise (␛[31m…).
# NO_COLOR is the cross-tool standard; FORCE_COLOR=0 covers the stragglers.
export NO_COLOR=1
export FORCE_COLOR=0

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

log "=== schedule refresh starting ($REPO_DIR) ==="

# 1. Sync so the push at the end fast-forwards cleanly.
log "pulling latest…"
git pull --ff-only

# 2. Rebuild the static data layer. Calling build-index directly (not
#    `npm run build-index`) skips the og.png re-render, which has no schedule
#    dependency.
log "rebuilding data layer…"
node scripts/build-index.js

# 3. Never commit something red — deploy.yml runs these and a failure halts the
#    live site.
log "running tests…"
npm test -- --run
log "running lint…"
npm run lint

# 4. Commit + push only if the *schedule* actually changed. meta.json's
#    generatedAt timestamp bumps on every build, so it's excluded from the
#    check — otherwise every run would deploy even when nothing changed. The
#    --porcelain check catches modified, added, and removed pattern files.
CHANGES="$(git status --porcelain -- public/data ':(exclude)public/data/meta.json')"
if [ -z "$CHANGES" ]; then
  log "no schedule changes — discarding meta timestamp churn, nothing to deploy."
  git checkout -- public/data/meta.json 2>/dev/null || true
  log "=== schedule refresh done (no-op) ==="
  exit 0
fi

# Real changes — commit everything including the refreshed meta timestamp.
# Attribute to the cta-bot identity (per-commit, so manual commits in this repo
# still use your real identity) — matches the cta-insights data pipeline.
log "schedule changed — committing + pushing…"
git add -A public/data
git -c user.name="cta-bot" -c user.email="cta-bot@users.noreply.github.com" \
  commit -m "Refresh schedule data ($(date '+%Y-%m-%d'))"
git push

log "=== schedule refresh done — deploy workflow will pick up the push ==="
