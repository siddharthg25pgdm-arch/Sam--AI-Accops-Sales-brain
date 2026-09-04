# Encrypted secrets

`secrets.md.gpg` holds every credential SAM uses: logins, API tokens, database keys, model keys.
It is symmetrically encrypted with GnuPG (AES-256), so the file in this repository is useless without the passphrase.

**The passphrase is not in this repository and never will be.** Without it, this file cannot be decrypted by anyone.

> **Passphrase hint: search in your Teams for "Passphrase" sent to yourself.**
> A second copy belongs in the password manager under "SAM secrets passphrase".
> Lost both? `secrets/RECOVERY.md` rebuilds every value from the dashboards in about 20 minutes.

## Read the secrets

```bash
bash secrets/decrypt.sh          # prints to the terminal, writes nothing to disk
```

Or directly:

```bash
gpg --decrypt secrets/secrets.md.gpg
```

GnuPG prompts for the passphrase. Nothing is written to disk unless you redirect it, and you should not.

## Update the secrets after a value changes

```bash
bash secrets/edit.sh             # decrypt to a temp file, open it, re-encrypt, shred the temp file
```

Then commit `secrets/secrets.md.gpg` and push. Never commit a decrypted copy: `secrets/*.md` and
`secrets/*.txt` are gitignored so an accidental `secrets/secrets.md` cannot be committed.

## Rules

- Vercel's environment variables remain the source of truth for what the running app uses. This file is the human-readable backup.
- If the passphrase is ever lost, every value here can be re-read from the Vercel, Supabase and Groq dashboards, or regenerated.
- If this repository is ever made public or shared outside Accops, the encrypted file is safe, but rotate anyway as a precaution.
- Do not paste decrypted values into chat tools, tickets, or documents.

## Requirements

GnuPG. Already installed on Siddharth's laptop (2.4.9). Elsewhere: `winget install GnuPG.GnuPG`,
`brew install gnupg`, or `apt install gnupg`.
