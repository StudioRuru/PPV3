# Tag Lookup Guide

## How to Use the Tag Catalogs

The `tags/` directory contains verified Danbooru tag catalogs organized by category:

| File | Contents |
|------|----------|
| `tags/clothing.yaml` | Tops, bottoms, dresses, uniforms, swimwear, outerwear, bodysuits, lingerie, traditional, fantasy — with theme + exposure metadata |
| `tags/appearance.yaml` | Hair (color, style), eyes (color, style), body type, skin, facial features, other features |
| `tags/footwear.yaml` | Heels, boots, shoes, legwear — with theme + exposure metadata |
| `tags/accessories.yaml` | Head, neck, hands, eyewear, ears, waist, bags, other items |
| `tags/materials.yaml` | Fabrics, patterns, textures/effects, colors |
| `tags/poses.yaml` | Standing, sitting, lying, kneeling, dynamic, camera angles, expressions |
| `tags/settings.yaml` | Indoor, outdoor, background types, lighting, weather, framing, art style |
| `tags/states.yaml` | Clothing states — torn, wet, disheveled, pulled, lifted, wardrobe malfunction |
| `tags/scenarios.yaml` | Situation/context tags — public, crowd, embarrassment, exposure contexts |

## Lookup Protocol

When building a prompt:

1. **Always read the relevant YAML files** before suggesting tags to the user
2. **Cross-reference user descriptions** against catalog entries:
   - User says "tight dress" → look up `tags/clothing.yaml` → find `bodycon dress` or `skin tight` in materials
   - User says "knee socks" → look up `tags/footwear.yaml` → find `kneehighs`
   - User says "sharp eyes" → look up `tags/appearance.yaml` → find `tsurime`
3. **Use the `aliases` field** to match informal descriptions to correct tags
4. **Check `notes` field** for usage context and gotchas
5. **Never guess at tags** — if unsure, check the catalog first

## Filtering by Theme & Exposure

Clothing and footwear catalogs include metadata for filtering:

- **theme**: Filter by style category (gothic, office, casual, fantasy, streetwear, lingerie, athletic, traditional, fetish, school, swimwear)
- **exposure**: Filter by coverage level (full, partial, minimal, none)

When the user asks for items matching a theme or exposure level, filter the catalog entries by these fields.

## Handling Unknown Tags

If a user requests something not in any catalog:
1. Search catalogs for the closest match
2. If no close match exists, include the user's tag but **flag it as unverified**:
   - "Note: `cyberpunk visor` is not in the verified catalog. NAI may still recognize it, but results may vary."
3. Suggest the closest verified alternative alongside the unverified tag
4. If the unverified tag works well, the user can request it be added to the catalog

## Tag Selection Best Practices

- **Be specific over generic**: `pleated skirt` is better than just `skirt`
- **Layer clothing tags logically**: top → bottom → footwear → accessories
- **Don't duplicate meaning**: if using `school uniform`, don't also add redundant tags like `student`
- **Use material tags to enhance**: `lace trim` on a `blouse` gives more detail than `blouse` alone
- **Check for conflicts**: don't combine `indoors` with outdoor-only settings
- **Completeness matters**: specify footwear, legwear, and accessories to prevent NAI from hallucinating them

## Token-Conscious Tag Selection

V5 Full allows ~1,471 effective tokens (V4.5: ~512 shared). Every tag still costs tokens — drop duplicates, keep useful detail.

### Prefer Compound Tags
Use single Danbooru compound tags instead of multiple separate tags:
- `blue pleated skirt` (1 concept) > `blue` + `pleated` + `skirt` (3 tags)
- `white long-sleeved shirt` > `white` + `long sleeves` + `shirt`
- `black thighhigh boots` > `black` + `thighhigh` + `boots`

### Eliminate Redundancy
Tags that imply other tags — use only the most specific one:
- `completely nude` → implies `bare shoulders`, `bare arms`, `bare back`, `bare legs` — don't add those
- `body blush` → implies `blushing` — don't add both
- `wedding dress` → implies `white dress`, `long dress` — don't add those
- `serafuku` → implies `sailor collar` — only add `sailor collar` if you need to emphasize it
- `school uniform` → often implies specific garments — only add specifics if overriding defaults

### Tag Priority When Trimming
If approaching token limits, cut in this order (least to most important):
1. Redundant/implied tags (cut first)
2. Secondary accessories (hairband, bracelet)
3. Material/pattern tags (unless essential to the look)
4. Setting detail tags (keep 1-2 max)
5. Secondary hair details (bangs, sidelocks)
6. Pose modifiers (keep primary pose only)
7. Primary outfit tags (cut last — these define the character)
