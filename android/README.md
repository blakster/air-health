# Air Health Sync (Android)

Sideloaded companion app. Reads **Health Connect** and POSTs day-level (+ optional intraday HR) summaries to your Air Health dashboard at `POST /api/hc/ingest`.

## Install (recommended)

1. Download **`AirHealthSync-1.1.0.apk`** from [GitHub Releases](https://github.com/blakster/air-health/releases/latest)
2. Sideload on your phone (Files / browser → allow install from that source)
3. Open **Air Health Sync** → set **Server URL** to your dashboard, e.g.

   ```text
   http://YOUR_TAILSCALE_IP:4870
   ```

   Replace `YOUR_TAILSCALE_IP` with the IPv4 from `tailscale ip -4` on the machine running the dashboard. If you set `PUBLIC_SYNC_URL` / `TAILSCALE_URL` in the dashboard `.env`, the pairing QR already embeds that host.
4. On the dashboard: **Data → Phone sync → Pair phone** → scan QR or enter the code
5. Grant Health Connect permissions → **Sync now** (or wait for background sync ~15 min)

Keep **Tailscale connected** on the phone when you want sync or to open the dashboard from the phone. Health Connect still collects while Tailscale is off; the next online session uploads the gap.

Do **not** install the debug APK on a real phone (it includes a synthetic seed activity).

## Build from source

```bash
export JAVA_HOME=~/opt/jdk17 ANDROID_HOME=~/android-sdk   # adjust paths
./gradlew :app:testDebugUnitTest :app:lintRelease :app:assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../dist/AirHealthSync.apk
```

- Release builds are signed with `keystore/release.jks`. Passwords live in `keystore/signing.properties` (mode 600). **Never commit** either file.
- Create a keystore once: `./make-keystore.sh`
- **Keep the keystore.** An update signed with another key will not install over the existing app.
- Default server string is set in `app/build.gradle.kts` as `DEFAULT_SERVER` (`http://YOUR_TAILSCALE_IP:4870`). Change it in the app UI, or rebuild with your IP.

## How it works

- **Pairing.** Dashboard shows a one-time code (10 minutes) + QR for `airhealth://pair?server=…&code=…`. The app swaps the code for a 256-bit device token (AndroidKeystore AES-GCM). The server stores only the SHA-256 hash.
- **First sync (backfill).** Last 30 days, or 365 if “past data” access is granted. Day by day (newest first); heart rate downsampled to 1-minute averages; gzip + batching for light days.
- **Later syncs.** Health Connect Changes API + WorkManager (~15 minutes when networked). **Sync now** runs on demand.
- **Server merge.** Per local day / metric, one origin wins (Fitbit/Google Health app first) so totals are not double-counted. Health Connect replaces Takeout for the same day and field.
- **Network.** Cleartext HTTP allowed for Tailscale/LAN (tailnet traffic is WireGuard-encrypted).
