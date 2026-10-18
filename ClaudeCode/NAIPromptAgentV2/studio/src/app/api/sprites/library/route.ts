import { NextResponse } from "next/server";
import { SPRITE_LIB } from "@/lib/env";
import { cutQueue } from "@/lib/sprites/cutout";
import { library } from "@/lib/sprites/library";
import { spritesDb } from "@/lib/sprites/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  cutQueue(); // resumes clips approved but not yet cut (e.g. after a restart)
  return NextResponse.json(library(spritesDb(), SPRITE_LIB));
}
