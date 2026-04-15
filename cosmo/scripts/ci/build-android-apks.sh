#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
ANDROID_SIGNING_DIR="$ANDROID_DIR/signing"
ARTIFACT_DIR="$ROOT_DIR/artifacts/android"
KEYSTORE_DIR="$ARTIFACT_DIR/keystores"
CREDENTIAL_DIR="$ARTIFACT_DIR/credentials"
PERSISTENT_RELEASE_KEYSTORE="$ROOT_DIR/scripts/ci/signing/cosmo-release.keystore"

random_secret() {
  openssl rand -hex 16
}

gradle_common_args() {
  local args=(--no-daemon)

  if [[ -n "${ORG_GRADLE_PROJECT_reactNativeArchitectures:-}" ]]; then
    args+=("-PreactNativeArchitectures=${ORG_GRADLE_PROJECT_reactNativeArchitectures}")
  fi

  printf '%s\n' "${args[@]}"
}

build_android_variant() {
  local variant="$1"
  mapfile -t args < <(gradle_common_args)
  ./gradlew "${args[@]}" "$variant"
}

cleanup_android_intermediates() {
  rm -rf \
    "$ANDROID_DIR/app/.cxx" \
    "$ANDROID_DIR/app/build" \
    "$ANDROID_DIR/build"
}

write_local_properties() {
  local sdk_root=""

  if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
    sdk_root="${ANDROID_SDK_ROOT}"
  elif [[ -n "${ANDROID_HOME:-}" ]]; then
    sdk_root="${ANDROID_HOME}"
  fi

  if [[ -n "$sdk_root" ]]; then
    sdk_root="${sdk_root//\//\\/}"
    printf 'sdk.dir=%s\n' "$sdk_root" > "$ANDROID_DIR/local.properties"
  fi
}

mkdir -p "$KEYSTORE_DIR" "$CREDENTIAL_DIR"
rm -rf "$ARTIFACT_DIR"
mkdir -p "$KEYSTORE_DIR" "$CREDENTIAL_DIR"

pushd "$ROOT_DIR" >/dev/null

# Harden Node environment for Gradle/Reanimated
export NODE_BINARY="$(which node)"
echo ">>> CI DIAGNOSTIC: NODE_BINARY=$NODE_BINARY"
node -v || echo "Error: node not found"

node scripts/ci/patch-expo-dev-launcher-android.js
npx expo prebuild --platform android --clean --no-install
write_local_properties

if [[ -z "${ORG_GRADLE_PROJECT_reactNativeArchitectures:-}" && "${CI:-}" = "1" ]]; then
  export ORG_GRADLE_PROJECT_reactNativeArchitectures="${COSMO_ANDROID_CI_ABIS:-arm64-v8a}"
fi

mkdir -p "$ANDROID_SIGNING_DIR"
rm -f "$ANDROID_SIGNING_DIR"/debug.keystore "$ANDROID_SIGNING_DIR"/release.keystore "$ANDROID_SIGNING_DIR"/key.properties

DEBUG_STORE_PASSWORD="$(random_secret)"
DEBUG_KEY_PASSWORD="$(random_secret)"
DEBUG_KEY_ALIAS="cosmo-debug"

RELEASE_STORE_PASSWORD="88kMqDI8Y3YtbyFyOTBL6Ct1dl9f2O89wRkk2XySemY="
RELEASE_KEY_PASSWORD="88kMqDI8Y3YtbyFyOTBL6Ct1dl9f2O89wRkk2XySemY="
RELEASE_KEY_ALIAS="shubhjain"

KEY_DNAME="CN=Cosmo CI,O=Cosmo AI,OU=Mobile,C=IN"

keytool -genkeypair \
  -keystore "$ANDROID_SIGNING_DIR/debug.keystore" \
  -storetype JKS \
  -storepass "$DEBUG_STORE_PASSWORD" \
  -keypass "$DEBUG_KEY_PASSWORD" \
  -alias "$DEBUG_KEY_ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10950 \
  -dname "$KEY_DNAME"

if [[ ! -f "$PERSISTENT_RELEASE_KEYSTORE" ]]; then
  echo "Warning: Persistent release keystore not found at $PERSISTENT_RELEASE_KEYSTORE" >&2
  echo "Generating a temporary release keystore for this build..." >&2
  keytool -genkeypair \
    -keystore "$PERSISTENT_RELEASE_KEYSTORE" \
    -storetype JKS \
    -storepass "$RELEASE_STORE_PASSWORD" \
    -keypass "$RELEASE_KEY_PASSWORD" \
    -alias "$RELEASE_KEY_ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10950 \
    -dname "$KEY_DNAME"
fi

cp "$PERSISTENT_RELEASE_KEYSTORE" "$ANDROID_SIGNING_DIR/release.keystore"

cat > "$ANDROID_SIGNING_DIR/key.properties" <<EOF
DEBUG_STORE_FILE=signing/debug.keystore
DEBUG_STORE_PASSWORD=$DEBUG_STORE_PASSWORD
DEBUG_KEY_ALIAS=$DEBUG_KEY_ALIAS
DEBUG_KEY_PASSWORD=$DEBUG_KEY_PASSWORD
RELEASE_STORE_FILE=signing/release.keystore
RELEASE_STORE_PASSWORD=$RELEASE_STORE_PASSWORD
RELEASE_KEY_ALIAS=$RELEASE_KEY_ALIAS
RELEASE_KEY_PASSWORD=$RELEASE_KEY_PASSWORD
EOF

python3 scripts/ci/configure_android_signing.py "$ANDROID_DIR/app/build.gradle"

chmod +x "$ANDROID_DIR/gradlew"

pushd "$ANDROID_DIR" >/dev/null
mapfile -t args < <(gradle_common_args)
./gradlew "${args[@]}" clean
build_android_variant app:assembleDebug
popd >/dev/null

cp "$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk" "$ARTIFACT_DIR/cosmo-debug.apk"
cleanup_android_intermediates

pushd "$ANDROID_DIR" >/dev/null
build_android_variant app:assembleRelease
popd >/dev/null

cp "$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk" "$ARTIFACT_DIR/cosmo-release-signed.apk"
cp "$ANDROID_SIGNING_DIR/debug.keystore" "$KEYSTORE_DIR/debug.keystore"
cp "$ANDROID_SIGNING_DIR/release.keystore" "$KEYSTORE_DIR/release.keystore"
cp "$ANDROID_SIGNING_DIR/key.properties" "$CREDENTIAL_DIR/generated-key.properties"

keytool -list -v \
  -keystore "$ANDROID_SIGNING_DIR/debug.keystore" \
  -storepass "$DEBUG_STORE_PASSWORD" \
  -alias "$DEBUG_KEY_ALIAS" > "$CREDENTIAL_DIR/debug-key-info.txt"

keytool -list -v \
  -keystore "$ANDROID_SIGNING_DIR/release.keystore" \
  -storepass "$RELEASE_STORE_PASSWORD" \
  -alias "$RELEASE_KEY_ALIAS" > "$CREDENTIAL_DIR/release-key-info.txt"

APP_NAME="$(node -p "require('./app.json').expo.name")"
APP_VERSION="$(node -p "require('./app.json').expo.version")"
APP_PACKAGE="$(node -p "require('./app.json').expo.android.package")"
BUILD_TIME_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RUN_ID="${GITHUB_RUN_ID:-local}"
RUN_ATTEMPT="${GITHUB_RUN_ATTEMPT:-1}"
GIT_SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"

DEBUG_SHA1="$(grep -m1 'SHA1:' "$CREDENTIAL_DIR/debug-key-info.txt" | sed 's/^[[:space:]]*SHA1:[[:space:]]*//')"
DEBUG_SHA256="$(grep -m1 'SHA256:' "$CREDENTIAL_DIR/debug-key-info.txt" | sed 's/^[[:space:]]*SHA256:[[:space:]]*//')"
RELEASE_SHA1="$(grep -m1 'SHA1:' "$CREDENTIAL_DIR/release-key-info.txt" | sed 's/^[[:space:]]*SHA1:[[:space:]]*//')"
RELEASE_SHA256="$(grep -m1 'SHA256:' "$CREDENTIAL_DIR/release-key-info.txt" | sed 's/^[[:space:]]*SHA256:[[:space:]]*//')"

cat > "$ARTIFACT_DIR/signing-summary.txt" <<EOF
Cosmo Android CI signing summary
Built at (UTC): $BUILD_TIME_UTC
Git SHA: $GIT_SHA
Run: $RUN_ID attempt $RUN_ATTEMPT
Application ID: $APP_PACKAGE
Version: $APP_VERSION

Debug signing
- Keystore: debug.keystore
- Alias: $DEBUG_KEY_ALIAS
- Store password: $DEBUG_STORE_PASSWORD
- Key password: $DEBUG_KEY_PASSWORD
- SHA1: $DEBUG_SHA1
- SHA256: $DEBUG_SHA256

Release signing
- Keystore: release.keystore
- Alias: $RELEASE_KEY_ALIAS
- Store password: $RELEASE_STORE_PASSWORD
- Key password: $RELEASE_KEY_PASSWORD
- SHA1: $RELEASE_SHA1
- SHA256: $RELEASE_SHA256

Note: The release key is persistent.
It is stored with the CI assets for stable release signatures.
EOF

export APP_NAME APP_VERSION APP_PACKAGE BUILD_TIME_UTC RUN_ID RUN_ATTEMPT GIT_SHA
export ARTIFACT_DIR
export DEBUG_KEY_ALIAS DEBUG_STORE_PASSWORD DEBUG_KEY_PASSWORD DEBUG_SHA1 DEBUG_SHA256
export RELEASE_KEY_ALIAS RELEASE_STORE_PASSWORD RELEASE_KEY_PASSWORD RELEASE_SHA1 RELEASE_SHA256

python3 - <<'PY'
import json
import os
from pathlib import Path

artifact_dir = Path(os.environ["ARTIFACT_DIR"])
payload = {
    "appName": os.environ["APP_NAME"],
    "version": os.environ["APP_VERSION"],
    "applicationId": os.environ["APP_PACKAGE"],
    "builtAtUtc": os.environ["BUILD_TIME_UTC"],
    "gitSha": os.environ["GIT_SHA"],
    "runId": os.environ["RUN_ID"],
    "runAttempt": os.environ["RUN_ATTEMPT"],
    "artifacts": {
        "debugApk": "cosmo-debug.apk",
        "releaseApk": "cosmo-release-signed.apk",
    },
    "debugSigning": {
        "alias": os.environ["DEBUG_KEY_ALIAS"],
        "storePassword": os.environ["DEBUG_STORE_PASSWORD"],
        "keyPassword": os.environ["DEBUG_KEY_PASSWORD"],
        "sha1": os.environ["DEBUG_SHA1"],
        "sha256": os.environ["DEBUG_SHA256"],
    },
    "releaseSigning": {
        "alias": os.environ["RELEASE_KEY_ALIAS"],
        "storePassword": os.environ["RELEASE_STORE_PASSWORD"],
        "keyPassword": os.environ["RELEASE_KEY_PASSWORD"],
        "sha1": os.environ["RELEASE_SHA1"],
        "sha256": os.environ["RELEASE_SHA256"],
    },
}

(artifact_dir / "build-metadata.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat >> "$GITHUB_STEP_SUMMARY" <<EOF
## Android APK build
- App: $APP_NAME
- Version: $APP_VERSION
- Application ID: $APP_PACKAGE
- Debug APK: \`artifacts/android/cosmo-debug.apk\`
- Signed release APK: \`artifacts/android/cosmo-release-signed.apk\`
- Debug SHA1: \`$DEBUG_SHA1\`
- Release SHA1: \`$RELEASE_SHA1\`

The release keystore is persistent and the build uses alias \`$RELEASE_KEY_ALIAS\`.
EOF
fi

popd >/dev/null
