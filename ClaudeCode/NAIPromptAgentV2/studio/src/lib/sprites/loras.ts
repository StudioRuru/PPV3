// Miyabi's trained sprite LoRAs (Task 1 recon filenames). Client-safe.
type SpriteLora = { name: string; strength: number; expert?: "high" | "low" }; // ponytail: Task 5 moves `expert` into recipe.ts's Lora type
export const SPRITE_LORAS = {
  trigger: "miyabi_sprite",
  // ponytail: tune strengths from the cheap tests
  image: { name: "miyabi_sprite_img.safetensors", strength: 0.9 } as SpriteLora,
  wan: [
    { name: "miyabi_sprite_wan_high_noise.safetensors", strength: 1, expert: "high" },
    { name: "miyabi_sprite_wan_low_noise.safetensors", strength: 1, expert: "low" },
  ] as SpriteLora[],
};

export const missingSpriteLoras = (available: string[]): string[] =>
  [SPRITE_LORAS.image, ...SPRITE_LORAS.wan].map((l) => l.name).filter((n) => !available.includes(n));
