# Air Health

Personal, local-first dashboard for **Fitbit Air / Google Health** data: sleep & recovery, steps & activity, heart rate & HRV, plus an optional AI coach.

Health data stays on **your machine**. There is no cloud backend for metrics — only optional Coach calls you configure (SuperGrok or an API key).

## Features

- **Today / Sleep / Heart / Activity** views with charts (vanilla JS + Chart.js)
- **Google Takeout** import (Fitbit / Google Health zip or extracted folder)
- **Phone sync** via an Android companion app that reads **Health Connect** and pushes day-level (+ optional intraday HR) summaries to this dashboard over your private network (typically **Tailscale**)
- **AI Coach** — SuperGrok device-code login, or XAI / OpenAI / Anthropic / Gemini API keys
- Single-user passcode gate; secrets and stores live under `data/` (gitignored)

## Quick start

```bash
cp .env.example .env   # optional
npm install
./start.sh             # background on port 4870 (override with PORT=…)
open http://localhost:4870
```

Passcode is printed to `data/.passcode` on first run (or set `APP_PASSCODE` in `.env`).

Stack: Node 22 + Express, no frontend build step. JSON store: `data/store.json`.

## Data sources

### Google Takeout

1. Export Fitbit / Google Health from [Google Takeout](https://takeout.google.com/)
2. On the **Data** page, upload the zip(s), an extracted folder, or loose JSON/CSV
3. Parser: `lib/parser.js` (+ `lib/sources/takeout.js`)

Until you import, the app ships with clearly labelled **sample data** (~60 days).

### Phone sync (Health Connect)

1. Build or install the APK from `android/` (see `android/README.md`)
2. Run the dashboard so your phone can reach it (Tailscale is the usual path: `tailscale ip -4` on the host)
3. Set `PUBLIC_SYNC_URL` / `TAILSCALE_URL` in `.env` if you open the UI via localhost but pair from the phone
4. **Data → Phone sync → Pair phone** — scan the QR or enter the one-time code
5. The phone stores a device token (Android Keystore); the server stores only a hash

Default Android server placeholder is `http://YOUR_TAILSCALE_IP:4870` — replace with your real Tailscale IPv4 in the app UI (or rebuild with `DEFAULT_SERVER` in `android/app/build.gradle.kts`).

## Coach

On the **Coach** page:

1. **Connect SuperGrok** — device-code login (tokens in `data/.coach-oauth.json`)
2. **API key** — saved to `data/.coach-secrets.json`, or set keys in `.env`

Keys and OAuth tokens never go to the browser. Coach receives a compact snapshot of your loaded metrics (not the raw Takeout zip). Wellness guidance only — not medical advice.

## Privacy

- Metrics and exports live in `data/` on the machine running the server — **not** committed to git
- Phone sync talks only to the dashboard URL you configure; no analytics SDK in the Android app
- Optional Coach providers receive only the prompt context the app builds; see in-app “What the coach sees”

## Tests

```bash
python3 scripts/make_synthetic_export.py /tmp/synthetic_takeout.zip
node scripts/test_parser.js /tmp/synthetic_takeout.zip
node scripts/test_coach_oauth.js
node scripts/test_hc_ingest.js
```

## Android companion

See [`android/README.md`](android/README.md). Release signing keystores and passwords are **not** in this repo (`android/keystore/` is gitignored); run `android/make-keystore.sh` locally once.

## License

MIT — see [LICENSE](LICENSE).
