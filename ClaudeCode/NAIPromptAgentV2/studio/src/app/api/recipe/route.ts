import { NextRequest, NextResponse } from "next/server";
import { readRecipe, recipeToState } from "@/lib/recipe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  const recipe = await readRecipe(Buffer.from(await file.arrayBuffer())).catch(() => null);
  if (!recipe)
    return NextResponse.json(
      { error: "No NovelAI recipe in this image — it was probably screenshotted or re-saved, which strips it." },
      { status: 422 },
    );
  return NextResponse.json({ recipe, ...recipeToState(recipe) });
}
