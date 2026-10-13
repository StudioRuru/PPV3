import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { id: number; created_at: number; model: string; seed: number; file: string; state: string; params: string };

export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 200);
  const rows = db.prepare("SELECT * FROM generations ORDER BY id DESC LIMIT ?").all(limit) as Row[];
  return NextResponse.json({ items: rows.map((r) => ({ ...r, state: JSON.parse(r.state), params: JSON.parse(r.params) })) });
}
