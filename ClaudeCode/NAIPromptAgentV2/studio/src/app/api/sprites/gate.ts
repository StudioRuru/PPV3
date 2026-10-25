import { NextResponse } from "next/server";
import { listModels } from "@/lib/comfy/client";
import { getEngine } from "@/lib/comfy/engine";
import { missingSpriteLoras } from "@/lib/sprites/loras";

/** 409 when Miyabi's LoRAs aren't on the pod yet; null to go ahead. */
export async function loraGate(): Promise<NextResponse | null> {
  const eng = getEngine();
  // fails closed: queuing while the pod is off would boot a paid pod that then can't find her LoRA
  if (eng.view().main.phase !== "ready") return NextResponse.json({ error: "Start the main pod first, so Sprites can check Miyabi's LoRA" }, { status: 409 });
  // fresh, not the 60 s route cache: right after training finishes the new file must count
  const loras = (await listModels(eng.base("main")).catch(() => null))?.loras;
  if (!loras) return NextResponse.json({ error: "Couldn't read the pod's LoRA list. Try again." }, { status: 503 });
  return missingSpriteLoras(loras).length ? NextResponse.json({ error: "Train Miyabi's LoRA first" }, { status: 409 }) : null;
}
