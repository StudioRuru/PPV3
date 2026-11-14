import { test } from "node:test";
import assert from "node:assert/strict";
import { descriptionTags, photoDue, photoPrompt } from "./photo";
import { parseProfile } from "./profile";
import type { RpCharacter, RpMessage } from "./types";

const card = (o: Partial<RpCharacter> = {}) => ({ appearancePrompt: "", outfitPrompt: "school uniform", ...o }) as RpCharacter;
const profile = parseProfile({ appearanceTags: "1girl, blonde hair", cast: [{ name: "Mio", appearanceTags: "1girl, black hair, twintails" }] });

test("photoPrompt order + speaker", () => {
  assert.equal(photoPrompt(card(), profile, "mio", "pouting by a tree", 3), "1girl, black hair, twintails, school uniform, pouting by a tree");
  assert.ok(photoPrompt(card(), profile, "", "selfie", 3).startsWith("1girl, blonde hair, "));
  assert.ok(photoPrompt(card({ appearancePrompt: "1girl, red hair" }), profile, "Mio", "selfie", 3).startsWith("1girl, red hair, "));
});

test("photoPrompt spice gate", () => {
  const p = photoPrompt(card(), profile, "", "nude selfie, nsfw, in bed", 1);
  assert.ok(!/\bnude\b|\bnsfw\b/.test(p), p);
  assert.ok(p.includes("in bed") && p.includes("rating:general"), p);
  assert.ok(photoPrompt(card(), profile, "", "nude selfie", 3).includes("nude selfie"));
});

test("photoDue", () => {
  const m = (role: "user" | "assistant", imageId: number | null = null) => ({ role, imageId }) as RpMessage;
  const eight = Array.from({ length: 8 }, () => m("assistant"));
  assert.equal(photoDue([m("assistant", 5), ...eight], "hey"), true);
  assert.equal(photoDue([m("assistant", 5), ...eight.slice(1)], "hey"), false);
  assert.equal(photoDue([], "send a pic?"), true);
  assert.equal(photoDue([m("assistant")], "how was school"), false);
  assert.equal(photoDue([m("assistant", 0), ...eight.slice(1)], "hey"), false, "a failed photo still counts as sent");
});

test("no appearance tags: the card description's real appearance tags stand in", () => {
  const vocab = ["blonde hair", "long hair", "hair", "pointy ears", "huge breasts", "green eyes", "red hair"];
  const desc = "Gender: Female. Body: a curvy elf with Long blonde hair, pointy ears and huge breasts. Eyes: bright green eyes.";
  assert.equal(descriptionTags(desc, vocab), "1girl, blonde hair, pointy ears, huge breasts, green eyes");
  const c = card({ outfitPrompt: "", description: desc } as Partial<RpCharacter>);
  assert.ok(photoPrompt(c, null, "", "selfie", 3, vocab).startsWith("1girl, blonde hair, "));
  const own = photoPrompt(card({ appearancePrompt: "1girl, red hair", description: desc } as Partial<RpCharacter>), null, "", "selfie", 3, vocab);
  assert.ok(own.startsWith("1girl, red hair, school uniform") && !own.includes("pointy ears"), "card tags still win");
});
