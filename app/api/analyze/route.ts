import { NextRequest, NextResponse } from "next/server";
import { TestCaseFormat } from "@/lib/claude";
import { analyzeDesign, analyzeDesignStream } from "@/lib/gemini";
import type { ImageInput } from "@/lib/gemini";
import { exportToExcel } from "@/lib/exporters";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { format, context } = body as {
      format: TestCaseFormat;
      context?: string;
    };

    // Build imageInputs from either the single-image or multi-image payload
    let imageInputs: ImageInput[] = [];

    if (body.images && Array.isArray(body.images) && body.images.length > 0) {
      // Multi-image: { images: [{ imageBase64, mediaType }, ...] }
      imageInputs = body.images.map((img: { imageBase64: string; mediaType: string }) => ({
        imageBase64: img.imageBase64,
        mediaType: img.mediaType,
      }));
    } else if (body.imageBase64 && body.mediaType) {
      // Single image (backward compat): { imageBase64, mediaType }
      imageInputs = [{ imageBase64: body.imageBase64, mediaType: body.mediaType }];
    }

    if (imageInputs.length === 0 || !format) {
      return NextResponse.json(
        { error: "Missing required fields: at least one image and format" },
        { status: 400 }
      );
    }

    // Excel needs the full text first to convert — use non-streaming
    if (format === "excel") {
      const result = await analyzeDesign(imageInputs, format, context);
      try {
        const buffer = exportToExcel(result);
        return new NextResponse(buffer as unknown as BodyInit, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": "attachment; filename=test-cases.xlsx",
          },
        });
      } catch {
        return NextResponse.json({ text: result, format });
      }
    }

    // All other formats: stream the response
    const stream = await analyzeDesignStream(imageInputs, format, context);
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("Analyze error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
