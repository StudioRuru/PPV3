# Recreate, Danbooru Find, iOS Shell — Implementation Plan

> Executed inline (Native). Design approved in chat 2026-10-13.

**Goal:** turn any found image (tagger, Danbooru post, shared photo) into a V5 prompt in one tap, and wrap the web Studio in a sideloaded iOS app with Save to Photos and a "Tag in Studio" share extension.

**Spec:** `docs/superpowers/specs/2026-10-13-nai-v5-studio-design.md` §4.4, §4.8.

## Global constraints
- Recreate replaces Base + characters, keeps UC/rating, offers Undo (~10 s). Multi-character images → everything on Character 1.
- Danbooru via server proxy `/api/danbooru`, anonymous (2-tag limit), optional `DANBOORU_LOGIN`/`DANBOORU_API_KEY` in `.env`. Results follow the rating switch. Thumbnails load from cdn.donmai.us directly.
- iOS: bundle `com.philly95.naistudio`, extension `com.philly95.naistudio.share`, app group `group.com.philly95.naistudio`, team `9TL96DXFPC`, xcodegen project under `ios/`. Server URL from Settings.bundle (default tailnet :8443). No App Store.
- Commit only named files; home-dir repo; never push.

## Review focus
1. Recreate on an image with no character tags → Base only, no empty character box.
2. Danbooru 422 (too many tags) / network failure → readable message, not a crash.
3. Danbooru query injection: user text must be URL-encoded; limit/page clamped.
4. Save to Photos in a browser (no native bridge) → plain download, button still works.
5. Share extension when the app can't be opened → image waits; app imports it on next foreground exactly once.

## Tasks
1. **`lib/recreate.ts`** — `keepTags(tags, opts): RawTag[]` (filterTags refactored onto it), `recreate(tags, state): PromptState`, `danbooruTags(post, groupOf): RawTag[]`. Tests: layout of base/char lines, no-character case, keeps uc/rating, Danbooru mapping incl. artist → `artist:x`.
2. **Recreate in Tagger** — "Recreate" button in TaggerPane results; page applies with Undo toast.
3. **`/api/danbooru` + Find sheet** — proxy (encode, clamp, rating map safe→`rating:g`, nsfw→`rating:q,e`… within tag limit), FindSheet with search + grid + detail + Recreate. Test: `danbooruQuery(q, rating)` builder.
4. **Native bridge hooks (web)** — Save button (bridge or `<a download>`), `window.studioImport(dataUrl)` → TaggerPane tags the file.
5. **iOS app** — xcodegen `project.yml`, SwiftUI WKWebView, Settings.bundle, save handler (cookies → URLSession → PHPhotoLibrary addOnly), import of app-group inbox on foreground.
6. **Share extension** — accepts images, writes to app-group inbox, tries to open `naistudio://import`, else "Open Studio to continue".
7. **Build, install, final review** — `xcodebuild` for device; install via `devicectl` when Ruruphone reachable; fresh reviewer on the branch.
