#!/usr/bin/env bash
# Decrypt to a temp file, open it in an editor, re-encrypt, then shred the temp file.
set -euo pipefail
cd "$(dirname "$0")"
TMP="$(mktemp -t sam-secrets-XXXXXX.md)"
cleanup() { command -v shred >/dev/null 2>&1 && shred -u "$TMP" 2>/dev/null || rm -f "$TMP"; }
trap cleanup EXIT
if [ -f secrets.md.gpg ]; then gpg --quiet --decrypt secrets.md.gpg > "$TMP"; else echo "# SAM secrets" > "$TMP"; fi
"${EDITOR:-notepad}" "$TMP"
gpg --batch --yes --symmetric --cipher-algo AES256 --output secrets.md.gpg "$TMP"
echo "re-encrypted secrets/secrets.md.gpg — now: git add secrets/secrets.md.gpg && git commit && git push"
