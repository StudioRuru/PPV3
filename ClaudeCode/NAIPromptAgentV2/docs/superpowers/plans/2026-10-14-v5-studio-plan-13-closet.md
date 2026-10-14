# Closet / Workshop — Plan 13 (sub-project 4 of 6)

> Executed inline. Approved in chat 2026-10-14: edits go to the same data/ files the skills use; co-pilot actions Modify/Add on/Remove, Combine, Mutate/escalate. Design canvas boards 5a/5b.

**Goal:** a Closet tab to browse, build, edit, duplicate, delete and enhance scenes (arcs), outfits, themes and clusters — saved to the shared `data/` YAML so the `/prompt` and `/story` skills see the same library.

## Global constraints
- Files: `data/arcs/*.yaml`, `data/outfits/*.yaml`, `data/themes/*.yaml`, `data/clusters/*.yaml`. Edits use `yaml` `parseDocument` and set only the edited paths, so comments, key order and untouched fields survive. Writes are atomic (tmp + rename) and the previous version is kept as `<file>.bak`.
- Delete never erases: the file moves to `data/.trash/<kind>/<slug>.<timestamp>.yaml` (restorable by hand).
- Editable fields per kind (everything else in the file is preserved untouched):
  - cluster: name, notes, tags
  - outfit: name, description, tags by slot (`tags.<slot>`), emphasized (`weight_overrides.emphasized`)
  - theme: name, description, base effects (`base_layer.effects`), anchors, support (`character_layer.*`), negatives (`clean_cut_negatives`)
  - arc: name, description, artist, scenes[] (title, narrative, prompt.base / prompt.character / prompt.undesired); add/remove scenes
- Co-pilot enhance (needs the brain on): the item's fields go to the brain with the action (modify/add/remove/combine with another item/mutate); it returns the same field shape as JSON; the UI shows a per-field diff (+added / −removed) with Apply/Discard; Apply edits the form, Save writes the file.
- Slugs from names via `slugify`; a new/duplicated item never overwrites an existing file (suffix -2, -3…).

## Review focus
1. Round-trip: open → save without changes → file byte-identical (or only whitespace-normalised by yaml) with comments intact.
2. Path safety: kind and slug are whitelisted (no `..`, no other directories).
3. A brain reply with junk / wrong shape → readable error, form untouched.
4. Arc edit that removes a scene the Studio's drawer was showing → drawer just refreshes.
5. Concurrent edit by a skill on disk between open and save → don't silently clobber (mtime check → "changed on disk, reload?").

## Tasks
1. `lib/closet.ts`: fields ↔ document per kind, diff, enhance-reply parser. Tests (incl. comment preservation).
2. `/api/closet` (list, get, save, create/duplicate, delete→trash) with mtime guard. Tests for path safety via the lib.
3. `/api/closet/enhance` (brain, non-streamed).
4. Closet screen (filters, cards) + editor sheet + enhance panel + "Use in Studio".
5. Verify, review, deploy.
