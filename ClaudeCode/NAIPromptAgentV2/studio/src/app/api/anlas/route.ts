import { NextResponse } from "next/server";
import { NOVELAI_TOKEN } from "@/lib/env";
import { anlas, NovelAIError } from "@/lib/novelai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ anlas: await anlas(NOVELAI_TOKEN) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof NovelAIError ? e.status : 502 });
  }
}
