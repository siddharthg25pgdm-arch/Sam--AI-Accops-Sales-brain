# Lost the passphrase? Read this.

`secrets/secrets.md.gpg` is AES-256 encrypted. **Nobody can decrypt it without the passphrase — not Anthropic,
not Claude, not GitHub, not Accops IT.** There is no reset link and no backdoor. That is the point of it.

The good news: **nothing in that file is unrecoverable.** Every value can be re-read from a dashboard you
already control, or regenerated. Losing the passphrase costs about 20 minutes, not the project.

## Where the passphrase should be

1. Siddharth's password manager, entry name **"SAM secrets passphrase"**. This is the primary copy.
2. Nowhere else. Not in this repository, not in chat tools, not in Teams, not in email, not in a note app
   that syncs in plaintext.

If it is not in the password manager, assume it is gone and follow the rebuild below.

## Rebuild the file from scratch (about 20 minutes)

Every value lives in a dashboard. Collect them, write a new file, encrypt with a new passphrase.

| Value | Where to get it again |
|---|---|
| App logins (`SAM_USERS`) | Vercel > sam-accops > Settings > Environment Variables > reveal `SAM_USERS`. Or just set a new password there. |
| `SAM_SESSION_SECRET` | Vercel, same place. Or generate a new one; the only effect is that everyone is logged out once. |
| `SAM_API_TOKENS` | Vercel, same place. Or generate a new token and update the Dwight extension / MCP config. |
| `WHATSAPP_VERIFY_TOKEN` | Vercel, same place. Or set a new one and re-verify the webhook in Meta. |
| WhatsApp phone ID, access token, app secret | Meta app dashboard: WhatsApp > API Setup, and App settings > Basic. |
| `SUPABASE_URL` | Fixed: `https://iwqhayuoxnrhqzozznes.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase > accops-marketing-dashboard > Project Settings > API Keys > Secret keys. Can be rotated there. |
| `OPENAI_COMPAT_API_KEY` | console.groq.com > API Keys. Old keys can be revoked and a new one created. |

Then:

```bash
bash secrets/edit.sh        # starts a fresh file if none can be decrypted
```

Enter a new passphrase when prompted, save it in the password manager first, then commit and push
`secrets/secrets.md.gpg`.

## Why the passphrase is not stored anywhere automated

Anywhere convenient enough for a program to fetch it is also somewhere an attacker can fetch it. A passphrase in
Teams, email, a repository file, or a chat transcript is searchable, synced to a cloud, visible to IT through
eDiscovery, and permanent. Storing it there would mean the encrypted file protects nothing.

A password manager is the correct home: encrypted at rest, unlocked only by you, and designed for exactly this.

## If Claude is asked for the passphrase in a future session

Claude cannot retrieve it. The passphrase was generated once, shown to Siddharth once, and deleted from the
laptop. No copy exists in this repository, in Claude's memory, or in any file. The honest answer is: check the
password manager, and if it is not there, rebuild using the table above.
