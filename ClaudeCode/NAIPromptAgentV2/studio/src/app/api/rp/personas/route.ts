import { NextRequest, NextResponse } from "next/server";
import { rp } from "@/lib/rp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ personas: rp.personas() });
}

/** Your user persona(s): `{ id?, name, description, relationship, addressAs, boundaries }`. */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (typeof b?.name !== "string" || !b.name.trim()) return NextResponse.json({ error: "A persona needs a name." }, { status: 400 });
  const s = (v: unknown) => (typeof v === "string" ? v : undefined);
  const id = rp.savePersona({ id: b.id ? Number(b.id) : undefined, name: b.name.trim().slice(0, 80), description: s(b.description), relationship: s(b.relationship), addressAs: s(b.addressAs), boundaries: s(b.boundaries) });
  return NextResponse.json({ id, personas: rp.personas() });
}
