import { NextRequest, NextResponse } from "next/server";
import { mascotStore } from "@/lib/mascot/quip";
import { getMascotSettings, saveMascotSettings } from "@/lib/mascot/settings-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const state = () => NextResponse.json({ settings: getMascotSettings(), facts: mascotStore.facts() });

export async function GET() {
  return state();
}

/** { settings?: patch, facts?: string[] (replace all), deleteFact?: id, clearFacts?: true } */
export async function POST(req: NextRequest) {
  const b = ((await req.json().catch(() => null)) ?? {}) as { settings?: unknown; facts?: unknown; deleteFact?: unknown; clearFacts?: unknown };
  // Empty is owned by the slime shelf (insert/remove), never set directly.
  if (b.settings !== undefined) saveMascotSettings(b.settings && typeof b.settings === "object" ? { ...b.settings, empty: undefined } : b.settings);
  if (Array.isArray(b.facts)) mascotStore.setFacts(b.facts.filter((f): f is string => typeof f === "string"));
  if (Number.isInteger(b.deleteFact)) mascotStore.deleteFact(b.deleteFact as number);
  if (b.clearFacts === true) mascotStore.clearFacts();
  return state();
}
