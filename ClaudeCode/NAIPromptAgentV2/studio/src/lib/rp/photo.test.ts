import { test } from "node:test";
import assert from "node:assert/strict";
import { photoDue, photoPrompt } from "./photo";
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
