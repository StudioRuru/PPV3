# Natural Language & Hybrid Prompting — V4.5 Techniques

V4.5 understands more than strict Danbooru tags. This guide documents when and how to mix natural language with tags to achieve complex actions, temporal sequences, and nuanced scenarios that pure tags can't express.

---

## When to Use Pure Tags vs Hybrid

| Scenario | Approach | Why |
|----------|----------|-----|
| Static appearance (hair, eyes, outfit) | Pure Danbooru tags | V4.5 trained on these; highest accuracy |
| Standard poses and expressions | Pure Danbooru tags | Well-represented in training data |
| Complex multi-step actions | Hybrid: tags + sequential ordering | No single tag exists; order implies progression |
| Clothing being actively destroyed/removed | Hybrid: state tags + tool/cause descriptors | Combines verified states with narrative context |
| Temporal progression within a single image | Sequential tag stacking | Tag order influences V4.5's interpretation |
| Unusual interactions or scenarios | Natural language phrases | When no Danbooru tag exists for the concept |

---

## Technique 1: Sequential Tag Stacking

V4.5 processes tags left-to-right, and earlier tags carry slightly more weight. You can exploit this to imply a **temporal narrative** within a single image by ordering state tags as a progression.

### Principle
Place tags in the order things would happen. V4.5 interprets this sequence as a visual story, favoring the later tags (the "current state") while incorporating traces of the earlier ones.

### Examples

**Clothing being cut and sliding off:**
```
scissors, cutting, torn clothes, open clothes, clothes sliding off, partially undressed, strap slip
```
→ Implies: scissors caused the tear → clothes opened → now sliding off → partially undressed

**Wind escalation:**
```
wind, wind lift, skirt lift, clothes askew, panty peek, embarrassed, covering crotch
```
→ Implies: wind blew → skirt lifted → clothing shifted → exposure → reaction

**Gradual undressing under duress:**
```
reluctant, clothes pull, unbuttoned, open shirt, strap slip, partially undressed, covering breasts
```
→ Implies: forced/reluctant → pulling at clothes → shirt opening → straps falling → covering up

### Rules
- Place **cause/trigger** tags first (wind, scissors, tripping)
- Follow with **action** tags (cutting, pulling, lifting)
- Then **state** tags in escalating order (torn → open → sliding → partially undressed)
- End with **reaction** tags (embarrassed, covering, blushing)
- Limit to 5-7 sequential state tags — more than that dilutes the effect

---

## Technique 2: Compound State Combinations

Combine multiple state tags to create complex situations that don't exist as single tags. V4.5 composes these together visually.

### High-Impact Combinations

| Combination | Visual Effect |
|-------------|---------------|
| `torn clothes, wet clothes, see-through` | Damaged + soaked = maximum exposure through fabric |
| `strap slip, off shoulder, clothes sliding off` | Progressive shoulder/top failure |
| `unbuttoned, open shirt, no bra, sideboob` | Open shirt revealing bare chest from the side |
| `skirt lift, wind lift, panty peek, embarrassed` | Wind-caused upskirt with reaction |
| `torn pantyhose, skirt lift, panty peek` | Layered exposure — legwear damaged + skirt displaced |
| `clothes pull, reluctant, partially undressed` | Unwilling removal in progress |
| `wardrobe malfunction, public, onlookers, mortified` | Accidental exposure with social context |
| `scissors, cutting, torn clothes, clothes sliding off` | Active destruction + gravity taking over |

### Stacking Outfit States Across Garments
Apply different states to different clothing pieces simultaneously:
```
torn shirt, skirt lift, torn pantyhose, strap slip, off shoulder
```
→ Top is torn + falling off shoulder, skirt is lifted, legwear is damaged — creates a "multiple failures" scene

---

## Technique 3: Tool & Cause Descriptors

When clothing damage or removal has a specific cause, include the tool or agent responsible. V4.5 can understand these as natural language even without exact Danbooru tag matches.

### Verified Tags (in catalogs)
- `scissors` — Cutting tool (verified Danbooru tag)
- `knife` — Cutting/threatening tool
- `wind` — Natural cause for clothing displacement
- `rain` — Cause for wet/transparent clothing
- `splash` — Water hitting character

### Hybrid Descriptors (natural language, use with emphasis)
These are NOT verified Danbooru tags but V4.5 understands them in context:
- `cutting clothes` — Active destruction of clothing with a tool
- `clothes being cut` — Passive voice, clothing receiving damage
- `ripping clothes` — Tearing clothing apart by force
- `pulling off clothes` — Active removal by force
- `clothes falling off` — Gravity-based clothing failure
- `clothes sliding off` — Slow, gravity-based displacement
- `clothes slipping` — Gradual, unintentional displacement

**Usage rule**: When using unverified hybrid descriptors, always pair them with verified state tags as anchors:
```
scissors, cutting clothes, torn clothes, clothes sliding off, partially undressed
          ↑ hybrid          ↑ verified    ↑ hybrid            ↑ verified
```
The verified tags ground the generation; the hybrid descriptors add nuance.

---

## Technique 4: Emphasis to Control Action Focus

Use V4.5's weight syntax to control which part of the action sequence the image focuses on.

### Focus on the Cause
```
1.3::scissors::, 1.15::cutting::, torn clothes, clothes sliding off, partially undressed
```
→ Image emphasizes the scissors and cutting action

### Focus on the Result
```
scissors, cutting, 1.3::torn clothes::, 1.15::clothes sliding off::, partially undressed
```
→ Image emphasizes the aftermath — damaged, falling clothing

### Focus on the Reaction
```
scissors, torn clothes, clothes sliding off, 1.3::embarrassed::, 1.15::covering breasts::, blushing
```
→ Image emphasizes the emotional reaction

### Numeric Weight for Precision
```
0.7::scissors::, 0.7::cutting::, 1.3::torn clothes, clothes sliding off::, partially undressed, 1.15::embarrassed::
```
→ Tool is present but subtle; damage state is the visual focus

> All emphasis here is V4.5 numeric `weight::tag::`. Keep weighted tags few (≤3 per segment).

---

## Technique 5: Narrative Phrases in Base Prompt

V4.5's base prompt (before the `|`) can include short natural language phrases that set the narrative context. These work best as 2-4 word phrases.

### Effective Phrases
- `clothing destroyed` — General destruction context
- `wardrobe disaster` — Multiple clothing failures
- `caught undressing` — Discovery scenario
- `clothes stolen` — Missing clothing narrative
- `forced to strip` — Coercion context
- `losing clothes` — Progressive loss

### Placement
Put narrative phrases in the base prompt after setting tags but before `no text`:
```
masterpiece, very aesthetic, artist:name, 1girl, cowboy shot, 0.9::subway interior::, clothing destroyed, no text | girl, ...
```

**Caution**: These are suggestive, not precise. Always reinforce with specific state tags in the character prompt.

---

## Technique 6: Scene-by-Scene Progression (Story Mode)

For `/story` arcs, use sequential tag stacking differently across scenes to show progression over time.

### Scene Progression Pattern

**Scene 1 — Setup (pristine state):**
```
white shirt, pencil skirt, black pantyhose, high heels, neat, professional
```

**Scene 2 — Catalyst (first disturbance):**
```
white shirt, unbuttoned, pencil skirt, black pantyhose, high heels, strap slip, disheveled
```

**Scene 3 — Escalation (damage accumulates):**
```
white shirt, unbuttoned, open shirt, pencil skirt, skirt lift, torn pantyhose, high heels, strap slip, off shoulder, wet clothes
```

**Scene 4 — Peak (maximum state):**
```
open shirt, no bra, pencil skirt, skirt lift, torn pantyhose, missing shoe, strap slip, off shoulder, wet clothes, see-through, wardrobe malfunction
```

### Key Principles for Arc Progression
1. **States accumulate** — torn stays torn, wet stays wet
2. **Add 1-2 new states per scene** — don't jump from pristine to destroyed
3. **Remove clothing tags** as garments are lost (delete `blazer` when it's gone)
4. **Add reaction tags** that escalate with the situation
5. **Shift setting tags** to increase social pressure (office → elevator → lobby)

---

## Token Budget for Hybrid Prompts

Hybrid prompts use more tokens because natural language phrases are less token-efficient than single tags. Budget accordingly:

| Prompt Type | Base Tags | Character Tags | Total |
|-------------|-----------|---------------|-------|
| Standard (pure tags) | 10-12 | 25-35 | 35-47 |
| Hybrid (tags + descriptors) | 10-12 | 20-30 | 30-42 |
| Heavy narrative | 8-10 | 18-25 | 26-35 |

**Rule**: When using hybrid descriptors, cut redundant/implied tags more aggressively. The descriptors add context that compensates for fewer explicit tags.

---

## Technique 7: Combat Clothing Destruction

> **Canonical method: use the reusable themes in `data/themes/` via `references/scene-themes.md`.**
> That system is built on count-verified tags and an apply algorithm; it exists because the
> earlier recipes here leaned on tags NAI does not know. **Verified-tag rule:** anchor on
> `torn clothes` (+ the garment-specific `torn_<garment>` variant), `open clothes`, `broken armor`,
> `broken weapon`/`broken sword`, `slashing`, `battle damage`. **Never** use `armor break`,
> `split clothes`, `slashed clothes`, `sword slash`, `energy slash`, `clothes cut` — they are
> near-zero on Danbooru and render nothing. Tag order only *nudges* emphasis; the verified anchor +
> garment-specific torn tag does the real work.

Combat scenes with clothing damage are among the most complex multi-element compositions. The challenge: weapon interaction + weapon destruction + clothing bisection + character reaction must ALL coexist in one frame.

### The Core Problem
V4.5 has no single concept for "powerful attack that breaks a weapon and cuts through clothing." You must compose it from layered tag groups that each handle one visual element.

### Layered Composition Strategy

Break the scene into **4 independent visual layers**, each handled by a cluster of tags:

| Layer | Purpose | Tag Cluster |
|-------|---------|-------------|
| **1. Action Context** | What's happening | `battle`, `slashing`, `blocking`, `motion lines`, `speed lines` |
| **2. Weapon State** | Weapon destruction | `broken weapon`, `broken sword`, `sparks`, `debris` |
| **3. Clothing State** | Clothing cut/parting | `torn clothes`, `torn <garment>`, `open clothes`, `battle damage`, `clothes sliding off` |
| **4. Character State** | Reaction, body | `shocked`, `no injury`, `bare skin visible`, pose tags |

### Sequential Stacking for Combat Cuts

The tag order tells V4.5 the story of the attack:

```
slashing → broken weapon → torn clothes → open clothes → clothes sliding off → partially undressed
   cause        weapon result     initial damage    parting        falling away         final state
```

### Weapon + Clothing Destruction Recipe

**For "attack breaks weapon and cuts clothing down the middle":**

> **Placement rule (important):** scene-effect / camera tags — `motion lines`, `speed lines`,
> `slashing`, `slashing`, `sparks`, `debris`, `motion blur`, `wind`, `shockwave` — belong
> in the **base** segment, never in a character box. The character box is a per-figure
> conditioning stream; global effects there bind to the figure and dilute both. Keep only
> body/weapon-held/clothing-state/expression tags in the character segment.

**Base prompt** — establish the combat context and visual power (all scene effects live here):
```
masterpiece, very aesthetic, artist:name, 1girl, full body,
1.15::motion lines::, speed lines, slashing, sparks, debris,
battle, 0.9::setting::, light particles, no text
```

**Character prompt** — layer the body/weapon/clothing elements in sequence (no scene effects):
```
girl, [appearance tags],
blocking, holding weapon, 1.3::broken weapon::,
1.15::battle damage::, torn clothes, open clothes,
clothes sliding off, partially undressed,
[bare skin exposure tags as appropriate],
shocked, wide eyes, open mouth,
-1::injury::, -1::blood::, -1::wound::
```

**Key techniques used:**
- `broken weapon` grounds the weapon destruction (verified Danbooru tag)
- `slashing` + `motion lines` (in BASE) convey the attack power
- `torn clothes` → `open clothes` → `clothes sliding off` = sequential stacking for the clothing bisection
- `-1::injury::` and `-1::blood::` in negative emphasis prevent body damage
- `sparks` + `debris` (in BASE) sell the impact moment
- `light particles` enhances the action atmosphere

### Emphasis Strategy for Combat Scenes

The main challenge: too many competing visual elements. Use emphasis to declare the **focal point**:

**Focus on the IMPACT MOMENT (weapon breaking):**
```
base: 1.15::motion lines::, sparks, slashing · char: 1.3::broken weapon::, battle damage, torn clothes, open clothes, ...
```

**Focus on the CLOTHING RESULT (clothes parting):**
```
base: motion lines, sparks, slashing · char: broken weapon, 1.15::battle damage::, 1.3::torn clothes::, open clothes, 1.15::clothes sliding off::, partially undressed, ...
```

**Focus on the CHARACTER REACTION (shock/exposure):**
```
base: motion lines, sparks · char: broken weapon, battle damage, torn clothes, open clothes, clothes sliding off, partially undressed, 1.3::shocked::, covering, 1.15::embarrassed::, ...
```

### Weapon-Specific Variations

**Axe/staff blocked, snapped in half:** (scene effects `slashing, debris` in base)
```
char: blocking, holding staff, 1.3::broken weapon::, 1.15::battle damage::, 1.15::torn clothes::, open clothes, ...
```
- `holding staff` + `broken weapon` = staff being destroyed
- Works the same with `holding axe` or any weapon

**Sword caught mid-block, shattered:** (scene effects `sparks, debris` in base)
```
char: blocking, holding sword, 1.3::broken sword::, 1.15::torn clothes::, open clothes, ...
```
- `broken sword` is its own verified tag — more specific than `broken weapon`

**Shield destroyed, attack continues through:** (scene effect `shockwave` in base)
```
char: blocking, shield, 1.3::broken weapon::, 1.15::battle damage::, 1.15::torn clothes::, open clothes, ...
```

### The "Clean Cut" Aesthetic

For clothing that parts **cleanly** (not ragged/messy), emphasize precision:
```
..., 1.3::torn clothes::, 1.15::open clothes::, clothes sliding off, ...
-1::tattered::, -1::shredded::
```
- The negative emphasis on `tattered` and `shredded` steers away from messy destruction
- `open clothes` + `torn clothes` together suggest a clean parting rather than chaotic ripping
- Consider adding `clean cut` as a hybrid descriptor before the state tags

### Multi-Scene Combat Arc Pattern

**Scene 1 — The Block (tension):**
```
blocking, holding sword, fighting stance, battle, determined
```
Outfit intact, weapon raised in defense.

**Scene 2 — The Impact (weapon breaks):** (`sparks, shockwave, motion lines` in base)
```
char: blocking, 1.3::broken weapon::, shocked
```
Weapon shatters, force visible. Clothing still intact or just beginning to tear.

**Scene 3 — The Cut (clothing parts):** (`slashing, debris` in base)
```
char: broken weapon, 1.3::torn clothes::, 1.15::open clothes::,
clothes sliding off, partially undressed, wide eyes
```
Clothing bisected down the middle, falling away to both sides.

**Scene 4 — The Aftermath (exposed):** (`debris` in base)
```
char: broken weapon on floor, torn clothes, open clothes,
1.3::partially undressed::, bare skin, shocked, 1.15::covering::, embarrassed
```
Fully exposed result, character reacting. Weapon pieces on the ground.

---

## Technique 8: Before/After as Two Generations (NOT one split image)

NAI V4.5 cannot reliably render a before/after, split-screen, or 2koma panel — it renders a
single coherent image, so a "split panel" prompt collapses into one muddy averaged subject
(this is the #1 cause of weak before/after results). **Always do a before/after as two
separate generations** anchored to the same character, then composite them side-by-side
outside NAI if you want a single deliverable.

### The recipe

1. **Gen A — "before"**: full character at the intact/initial state. Generate this first.
2. **Anchor identity** off Gen A so the "after" is unmistakably the same character:
   - **Best:** if the character has a `/sheet` `beauty_shot`, use **Precise Reference** (fidelity 0.65–0.80) on *both* gens.
   - **Otherwise:** use Gen A's output as **Character Reference** for Gen B (fidelity 0.7–0.8). Vibe Transfer from A→B also helps match palette/mood (but VT ⊥ Precise Reference).
3. **Gen B — "after"**: keep the **same base** (artist, setting, framing, seed if you want a tight pair) and the **same character identity**; change only the state/expression tags that differ.
4. **Negatives**: keep `2koma, split screen, before and after, multiple views, comic, panel` in the negative on BOTH gens — you are making two clean single-subject images, not a panel.

### Worked example — "instant-loss": whole self → emptied husk

**Gen A (before):**
```
Base: masterpiece, very aesthetic, year 2025, artist:ke-ta, 1girl, cowboy shot, 0.9::rooftop::, no text
Character: girl, [locked appearance], 1.3::magical girl::, frilled dress, thighhighs, confident, smug, hands on hips, sharp gaze, looking at viewer
Undesired: [default] , 2koma, split screen, before and after, multiple views, comic, panel
```

**Gen B (after)** — same base + same identity (anchored to Gen A), only the state changes:
```
Base: masterpiece, very aesthetic, year 2025, artist:ke-ta, 1girl, cowboy shot, 0.9::rooftop::, no text
Character: girl, [locked appearance], magical girl, frilled dress, thighhighs, 1.3::empty eyes::, thousand-yard stare, ahegao, drooling, body blush, limp, arms at sides, trembling, defeated
Undesired: [default] , 2koma, split screen, before and after, multiple views, comic, panel
```

Composite A|B side-by-side afterward. Result: two clean, on-model figures instead of one
blurred two-headed mess.

## Quick Reference: Complex Action Recipes

### "Clothing cut with scissors, slowly sliding off"
```
Base: ..., scissors, clothing destroyed, ...
Character: ..., scissors, cutting, 1.3::torn clothes::, 1.15::clothes sliding off::, open clothes, partially undressed, strap slip, off shoulder, embarrassed, covering, ...
```

### "Caught in the rain, clothes becoming transparent"
```
Base: ..., rain, wet, ...
Character: ..., 1.3::wet clothes::, 1.15::wet shirt::, see-through, see-through shirt, bra visible, clinging clothes, shivering, embarrassed, covering breasts, ...
```

### "Wind ripping skirt away in public" (wind/strong wind stays in base)
```
Base: ..., strong wind, crowded street, ...
Character: ..., 1.3::skirt lift::, wind lift, torn skirt, clothes askew, panty peek, onlookers, 1.15::mortified::, covering crotch, ...
```

### "Gradually undressing under orders"
```
Base: ..., indoors, ...
Character: ..., reluctant, 1.15::unbuttoned::, 1.3::open shirt::, clothes pull, strap slip, partially undressed, blushing, looking away, trembling, ...
```

### "Tripping and clothes catching/tearing" (motion blur stays in base)
```
Base: ..., motion blur, ...
Character: ..., tripping, falling, 1.3::torn clothes::, 1.15::torn skirt::, clothes askew, wardrobe malfunction, scraped knee, embarrassed, ...
```

### "Powerful sword strike breaks weapon, cuts clothes down the middle"
```
Base: masterpiece, very aesthetic, artist:name, 1girl, full body, 1.15::motion lines::, speed lines, slashing, sparks, debris, battle, light particles, 0.9::ruins::, no text
Character: girl, [appearance], blocking, holding sword, 1.3::broken sword::, 1.15::battle damage::, torn clothes, open clothes, clothes sliding off, partially undressed, shocked, wide eyes, -1::injury::, -1::blood::
Undesired: worst quality, bad quality, displeasing, very displeasing, lowres, bad anatomy, bad hands, wound, scar, blood, bruise
```

### "Axe/staff shattered by attack, armor and clothes destroyed"
```
Base: masterpiece, very aesthetic, artist:name, 1girl, full body, 1.15::motion lines::, shockwave, sparks, debris, battle, light particles, no text
Character: girl, [appearance], blocking, holding staff, 1.3::broken weapon::, 1.15::battle damage::, torn clothes, open clothes, clothes sliding off, partially undressed, staggering, shocked, -1::injury::, -1::blood::, -1::tattered::
Undesired: worst quality, bad quality, displeasing, very displeasing, lowres, bad anatomy, wound, scar, blood
```

### "Energy attack slicing through clothing only" (slashing, motion lines, wind in base)
```
Base: masterpiece, very aesthetic, artist:name, 1girl, cowboy shot, 1.15::slashing::, motion lines, wind, aura, light trail, light particles, no text
Character: girl, [appearance], [outfit tags], 1.15::battle damage::, 1.3::torn clothes::, open clothes, clothes sliding off, partially undressed, shocked, -1::injury::, -1::blood::
Undesired: worst quality, bad quality, displeasing, very displeasing, lowres, bad anatomy, wound, blood, scar
```
