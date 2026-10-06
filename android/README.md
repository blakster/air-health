# Air Health Sync (Android)

A small sideloaded app. It reads Health Connect and sends the data to the Air Health dashboard at `POST /api/hc/ingest`.

## Build
    export JAVA_HOME=~/opt/jdk17 ANDROID_HOME=~/android-sdk
    ./gradlew :app:testDebugUnitTest :app:lintRelease :app:assembleRelease :app:assembleDebug
    cp app/build/outputs/apk/release/app-release.apk ../dist/AirHealthSync.apk

- The release build is signed with `keystore/release.jks`. Its password is in `keystore/signing.properties` (both files are mode 600 and must never be committed).
- **Keep the keystore.** An update signed with any other key will not install over the app; you would have to uninstall it first.
- The keystore is created once by `make-keystore.sh`.

## How it works
- **Pairing.** The dashboard (Data › Phone sync › Pair phone) shows a single-use code that lasts 10 minutes, plus a QR code for `airhealth://pair?server=…&code=…`. The app swaps the code for its own 256-bit device token. The token is stored encrypted with an AndroidKeyStore AES-GCM key, and the server keeps only its SHA-256 hash.
- **First sync (backfill).** The app reads the last 30 days, or 365 days if "past data" access is granted. It reads day by day (newest first), downsamples heart rate to 1-minute averages, gzips, and packs light days into fewer requests.
- **Later syncs.** After the backfill, the app uses the Changes API with a change token. WorkManager runs it about every 15 minutes when there is a network connection, and **Sync now** runs it on demand.
- **Server merge.** Records are stored per local day. For each day and metric, only one origin counts (Fitbit/Google Health app first), so totals are never double counted. Health Connect values replace Takeout values for the same day and field.
- **Network.** Cleartext HTTP is allowed for Tailscale/LAN sync (traffic on the tailnet is encrypted by WireGuard). Set the dashboard URL in the app (default placeholder: http://YOUR_TAILSCALE_IP:4870).
- **Debug build.** The debug APK includes `DebugSeedActivity`, which writes synthetic test data. Do not install it on a real phone.
