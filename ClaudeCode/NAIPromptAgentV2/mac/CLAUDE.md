# MiyabiOverlay (macOS)

- Swift 6, macOS 15+, AppKit. XcodeGen: edit `project.yml`, run `xcodegen generate`; `MiyabiOverlay.xcodeproj` and `build/` are not committed.
- Build/test via the `xcode-runner` agent, never raw `xcodebuild` in the main thread:
  `xcodebuild test -scheme MiyabiOverlay -destination 'platform=macOS' -derivedDataPath build`
- Tests compile the app sources directly (minus `App.swift`), so they never launch the overlay. Do not launch the app without the owner's OK.
- `Resources/behaviour.js` is built from `studio/src/lib/sprites/behaviour.ts`; never edit it by hand. BState is kept as an opaque JSON string.
- Keychain holds only the session cookie, never the password. Tests use `MemoryCookieStore`, a `URLProtocol` stub and a temp cache dir.
- Surgical edits; no unrequested comments or refactors.
