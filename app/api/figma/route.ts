import { NextRequest, NextResponse } from "next/server";
import { fetchFigmaImage } from "@/lib/figma";

export async function POST(req: NextRequest) {
  try {
    const { figmaUrl, figmaToken } = await req.json();

    if (!figmaUrl || !figmaToken) {
      return NextResponse.json(
        { error: "figmaUrl and figmaToken are required" },
        { status: 400 }
      );
    }

    const result = await fetchFigmaImage(figmaUrl, figmaToken);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch Figma design";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
