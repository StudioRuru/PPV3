import { NextRequest, NextResponse } from "next/server";
import { AUTH_ENABLED, TAGGER_URL } from "@/lib/env";
import { brainLoaded, brainUp, captionUp, ping, power, setBrain, tipoUp } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function status() {
  const [brain, caption, tipo, tagger] = await Promise.all([brainUp(), captionUp(), tipoUp(), ping(`${TAGGER_URL}/health`)]);
  // power: the toggle starts/stops the servers too. Only behind the password gate — with auth off,
  // anyone who can reach the app could spawn processes on the Mac.
  return { on: brain && (await brainLoaded()), brain, caption, tipo, tagger, power: AUTH_ENABLED };
}

export async function GET() {
  return NextResponse.json(await status());
}

export async function POST(req: NextRequest) {
  const on = !!(await req.json().catch(() => null))?.on;
  if (AUTH_ENABLED) {
    const r = await power(on ? "up" : "down");
    return NextResponse.json({ ...(await status()), ...(r.ok ? {} : { error: r.err || "Power script failed — see studio/.run/*.log" }) }, { status: r.ok ? 200 : 503 });
  }
  try {
    await setBrain(on);
  } catch (e) {
    return NextResponse.json({ ...(await status()), error: `Brain offline — run \`npm run up\` on the Mac. (${(e as Error).message})` }, { status: 503 });
  }
  return NextResponse.json(await status());
}
