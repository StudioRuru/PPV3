import { NextRequest, NextResponse } from "next/server";
import { rebuildProfile } from "@/lib/rp/profile";
import { askHeavy, avatarForModel, rp } from "@/lib/rp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Rebuild the character's profile from its card + avatar. `{ force: true }` overwrites a hand-edited one (else 409). */
export async function POST(req: NextRequest, { params }: Ctx) {
  const id = Number((await params).id);
  const force = (await req.json().catch(() => null))?.force === true;
  const c = rp.character(id);
  const r = await rebuildProfile(rp, id, c ? await avatarForModel(c.avatarPath) : null, askHeavy, force).catch((e: Error) => ({ status: 502, body: { error: e.message } }));
  return NextResponse.json(r.body, { status: r.status });
}
