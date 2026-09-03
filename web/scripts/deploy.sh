#!/usr/bin/env bash
# Link (or re-link) the SAM project on the currently logged-in Vercel account, push env vars from .env.deploy.local,
# and deploy to production. Idempotent: re-running just redeploys.
#   usage: bash scripts/deploy.sh [scope]     e.g. bash scripts/deploy.sh siddharth-g25pgdm-gmail-projects
set -euo pipefail
cd "$(dirname "$0")/.."
SCOPE="${1:-}"
[ -f .env.deploy.local ] || { echo "missing .env.deploy.local (SAM_USERS, SAM_SESSION_SECRET, SAM_API_TOKENS)"; exit 1; }

if [ ! -f .vercel/project.json ]; then
  if [ -n "$SCOPE" ]; then vercel link --yes --project sam-accops --scope "$SCOPE"; else vercel link --yes --project sam-accops; fi
fi

# Push each variable in .env.deploy.local (last occurrence wins). Remove-then-add so re-runs update instead of failing.
declare -A vars
while IFS='=' read -r k v; do [ -n "$k" ] && [[ "$k" != \#* ]] && vars["$k"]="$v"; done < .env.deploy.local
vars["CLAUDE_MODEL"]="${vars[CLAUDE_MODEL]:-claude-sonnet-5}"
for k in "${!vars[@]}"; do
  vercel env rm "$k" production --yes >/dev/null 2>&1 || true
  printf '%s' "${vars[$k]}" | vercel env add "$k" production >/dev/null
  echo "env set: $k"
done

timeout 600 vercel deploy --prod --yes | tee /tmp/sam-deploy.log | grep -E "Production:|Error" || true
echo "done. Aliases:"; vercel ls --prod 2>/dev/null | grep -oE "https://[^ ]+" | head -1
