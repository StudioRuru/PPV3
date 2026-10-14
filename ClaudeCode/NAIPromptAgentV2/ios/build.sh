#!/usr/bin/env bash
# Build the iOS shell and install it on Ruruphone (must be unlocked and reachable). Usage: ios/build.sh [device-id]
set -euo pipefail
cd "$(dirname "$0")"
DEVICE=${1:-00008150-0011611C0A20401C}
xcodegen generate --quiet
xcodebuild -project NAIStudio.xcodeproj -scheme NAIStudio -configuration Release -destination generic/platform=iOS \
  -derivedDataPath build -allowProvisioningUpdates -quiet build
xcrun devicectl device install app --device "$DEVICE" build/Build/Products/Release-iphoneos/NAIStudio.app
xcrun devicectl device process launch --device "$DEVICE" com.philly95.naistudio || true
