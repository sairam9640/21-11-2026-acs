#!/bin/bash
# ==============================================================================
# ACS Continuous Auto-Deploy Daemon for VPS
# Watches GitHub repository on 'main' branch and automatically rebuilds Docker
# ==============================================================================

PROJECT_DIR="/root/21-11-2026-acs"
cd "$PROJECT_DIR" || exit 1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] ACS Auto-Deploy Daemon started for $PROJECT_DIR"

while true; do
  git fetch origin main --quiet 2>/dev/null
  LOCAL_COMMIT=$(git rev-parse HEAD 2>/dev/null)
  REMOTE_COMMIT=$(git rev-parse origin/main 2>/dev/null)

  if [ -n "$REMOTE_COMMIT" ] && [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Detected new GitHub commit: $REMOTE_COMMIT (current: $LOCAL_COMMIT)"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pulling latest changes..."
    git reset --hard origin/main

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuilding Docker containers..."
    docker compose build backend frontend
    docker compose up -d

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Auto-deployment completed successfully!"
  fi

  sleep 15
done
