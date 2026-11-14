#!/usr/bin/env bash
# Deploys Living Window: Cloud Run (API) + Firebase Hosting (pages) at https://livingwindow.web.app
# Usage: PROJECT=<gcp-project-id> ./deploy.sh      (reads keys from .env)
set -euo pipefail
: "${PROJECT:?set PROJECT to the Google Cloud project id}"
REGION=us-central1
SERVICE=living-window-api
set -a; source .env; set +a

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  speech.googleapis.com --project "$PROJECT"

# One always-on instance: story state lives in memory and must be shared by headset + console.
gcloud run deploy "$SERVICE" --source . --project "$PROJECT" --region "$REGION" \
  --allow-unauthenticated --min-instances 1 --max-instances 1 --timeout 3600 --session-affinity \
  --set-env-vars "REACTOR_API_KEY=${REACTOR_API_KEY},ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-},ORBIS_SESSION_SECONDS=${ORBIS_SESSION_SECONDS:-1800},MAX_PORTALS=${MAX_PORTALS:-3}"

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')
gcloud run services update "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --update-env-vars "WS_URL=${URL/https:/wss:}/ws"

npx vite build
firebase deploy --only hosting --project "$PROJECT"
echo "Live: https://livingwindow.web.app  (console: https://livingwindow.web.app/console.html)"
