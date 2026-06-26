import { NextResponse } from "next/server";
import { getProgress } from "@/app/lib/analysisRunner";
import { readTable } from "@/app/lib/storage";
import type { Upload } from "@/app/lib/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const uploads = await readTable<Upload>("uploads");
    const upload = uploads.find((u) => u.id === id);
    if (!upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

    const { percent, message } = getProgress(id);
    return NextResponse.json({
      status: upload.status,
      percent,
      message,
      error: upload.error,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab2/uploads/[id]/progress]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
