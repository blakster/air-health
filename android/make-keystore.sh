#!/usr/bin/env bash
# One-time: create the release signing key in android/keystore/ (mode 700/600). Keep it: Android only accepts
# updates signed with the same key. The password lives in keystore/signing.properties (git-ignored).
set -euo pipefail
cd "$(dirname "$0")"
[ -f keystore/release.jks ] && { echo "keystore/release.jks already exists"; exit 0; }
umask 077
mkdir -p keystore && chmod 700 keystore
PW="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
"${JAVA_HOME:-$HOME/opt/jdk17}/bin/keytool" -genkeypair -v -keystore keystore/release.jks -storetype PKCS12 \
  -alias airhealth -keyalg RSA -keysize 3072 -validity 36500 -storepass "$PW" -keypass "$PW" \
  -dname "CN=Air Health Sync, O=Vansh Aggarwal, C=IN" >/dev/null 2>&1
printf 'storeFile=keystore/release.jks\nstorePassword=%s\nkeyAlias=airhealth\nkeyPassword=%s\n' "$PW" "$PW" > keystore/signing.properties
chmod 600 keystore/release.jks keystore/signing.properties
echo "created keystore/release.jks"
