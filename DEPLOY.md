# Shipping PaperPilot

## Desktop installer (Windows)

```bash
npm run desktop:build        # → release/dist/PaperPilot Setup <version>.exe
```

### Code signing

Without a certificate, Windows SmartScreen shows "Unknown publisher". To sign, buy an
OV/EV code-signing certificate (or use Azure Trusted Signing), export it as a `.pfx`, then:

```bash
set CSC_LINK=C:\path\to\cert.pfx          # or base64 of the file
set CSC_KEY_PASSWORD=your-pfx-password
set PAPERPILOT_REQUIRE_SIGNING=1          # fail the build instead of shipping unsigned
npm run desktop:build
```

Signatures are SHA-256 and timestamped, so they stay valid after the certificate expires.
Never commit the `.pfx` or its password.

### Auto-update

1. Pick an HTTPS folder you control (S3/R2 bucket, GitHub Pages, any static host).
2. Bump `version` in `electron/package.json`.
3. Build with the folder baked in:
   ```bash
   set PAPERPILOT_UPDATE_URL=https://downloads.example.com/paperpilot
   npm run desktop:build
   ```
4. Upload `release/dist/latest.yml` **and** `release/dist/PaperPilot Setup <version>.exe` to that folder.

Installed copies check `latest.yml` ~8 s after start, ask the user, download the installer,
verify its sha512, and reinstall silently. Logs: *File → Open logs folder* → `updater.log`.
API keys entered in Settings live in `%APPDATA%/PaperPilot/keys.env` and survive updates.

## Hosted PaperPilot AI server

The `/api/v1` OpenAI-compatible endpoint, with `pp_live_` keys, per-day and per-minute limits.

On a VPS with Docker:

```bash
git clone https://github.com/Vishnuvardhan-978/paperpilot.git && cd paperpilot
cp .env.example .env.server          # fill in GROQ_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY …
# edit Caddyfile: replace ai.example.com with your domain (DNS A record → this server)
docker compose up -d --build
docker compose exec app node scripts/pp-keys.mjs create "Ravi" --daily 200 --per-minute 30
docker compose exec app node scripts/pp-keys.mjs usage
```

Caddy gets the HTTPS certificate automatically. Keys and usage are in the `paperpilot-data` volume.

Clients (the desktop app, or another PaperPilot) use it with:

```
PAPERPILOT_AI_URL=https://ai.example.com/api/v1
PAPERPILOT_AI_KEY=pp_live_…
```

Notes:
- The settings screen and the training endpoint only answer requests from the server machine itself,
  so they are not exposed through the proxy.
- Usage is stored in JSON files, which fits one container. Moving to several instances needs a shared
  database for keys and usage.
