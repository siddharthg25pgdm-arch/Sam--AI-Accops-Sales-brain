#!/usr/bin/env bash
# Print SAM's secrets to the terminal. Writes nothing to disk. Prompts for the passphrase.
set -euo pipefail
cd "$(dirname "$0")"
[ -f secrets.md.gpg ] || { echo "secrets.md.gpg not found"; exit 1; }
gpg --quiet --decrypt secrets.md.gpg
