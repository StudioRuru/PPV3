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
  const vocab = new Map(["blonde hair", "long hair", "hair", "pointy ears", "huge breasts", "green eyes", "red hair"].map((t) => [t, "appearance"]));
  const desc = "Gender: Female. Body: a curvy elf with Long blonde hair, pointy ears and huge breasts. Eyes: bright green eyes.";
  assert.equal(descriptionTags(desc, [...vocab.keys()]), "1girl, blonde hair, pointy ears, huge breasts, green eyes");
  const c = card({ outfitPrompt: "", description: desc } as Partial<RpCharacter>);
  assert.ok(photoPrompt(c, null, "", "selfie", 3, vocab).startsWith("1girl, blonde hair, "));
  const own = photoPrompt(card({ appearancePrompt: "1girl, red hair", description: desc } as Partial<RpCharacter>), null, "", "selfie", 3, vocab);
  assert.ok(own.startsWith("1girl, red hair, school uniform") && !own.includes("pointy ears"), "card tags still win");
});

test("conversation context: pose, scene, mood and a change of clothes become real tags", () => {
  const vocab = new Map([["bikini", "clothing"], ["lying", "poses"], ["beach", "settings"], ["blush", "appearance"], ["nude", "nudity"], ["red hair", "appearance"], ["yellow", "materials"]]);
  const ctx = "user: let's go to the beach!\nassistant: ok i changed into my new bikini 😳";
  const p = photoPrompt(card({ appearancePrompt: "1girl, red hair" }), null, "", "me lying on the sand with a blush", 3, vocab, ctx);
  assert.equal(p, "1girl, red hair, lying, blush, beach, bikini, me lying on the sand with a blush");
  assert.ok(photoPrompt(card(), null, "", "smiling at the camera", 3, vocab, ctx).includes("school uniform") === false, "new clothes replace the card outfit");
  assert.ok(photoPrompt(card(), null, "", "smiling", 3, vocab, "we talked about school").includes("school uniform"), "no clothes in context keeps the card outfit");
  assert.equal(photoPrompt(card(), null, "", "a yellow flower", 3, vocab), "school uniform, a yellow flower", "bare colours (materials) aren't scene tags");
  assert.ok(!photoPrompt(card(), null, "", "smiling", 1, vocab, "i'm nude").includes("nude"), "tame chats drop nudity tags");
});
