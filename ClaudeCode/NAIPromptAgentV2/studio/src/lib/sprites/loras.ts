// Miyabi's trained sprite LoRAs (Task 1 recon filenames). Client-safe.
import type { Lora } from "../comfy/recipe";
export const SPRITE_LORAS = {
  trigger: "miyabi_sprite",
  // ponytail: tune strengths from the cheap tests
  image: { name: "miyabi_sprite_img.safetensors", strength: 0.9 } as Lora,
  // Owner 2026-10-26: no Wan LoRA unless clips drift with first+last frames alone. If trained, list
  // miyabi_sprite_wan_high_noise / _low_noise here (strength 1, expert high/low) and the gate requires them.
  wan: [] as Lora[],
};

export const missingSpriteLoras = (available: string[]): string[] =>
  [SPRITE_LORAS.image, ...SPRITE_LORAS.wan].map((l) => l.name).filter((n) => !available.includes(n));
