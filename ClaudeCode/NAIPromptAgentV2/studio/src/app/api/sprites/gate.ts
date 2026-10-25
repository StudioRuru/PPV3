import { NextResponse } from "next/server";
import { cachedModels } from "@/lib/comfy/client";
import { getEngine } from "@/lib/comfy/engine";
import { missingSpriteLoras } from "@/lib/sprites/loras";

/** 409 when Miyabi's LoRAs aren't on the pod yet; null to go ahead. */
export async function loraGate(): Promise<NextResponse | null> {
  const eng = getEngine();
  const loras = eng.view().main.phase === "ready" ? (await cachedModels(eng.base("main")).catch(() => null))?.loras : undefined;
  return loras && !missingSpriteLoras(loras).length ? null : NextResponse.json({ error: "Train Miyabi's LoRA first" }, { status: 409 });
}
