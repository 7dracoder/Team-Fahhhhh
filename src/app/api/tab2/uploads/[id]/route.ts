import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { readTable, remove, writeTable } from "@/app/lib/storage";
import type { AnalysisEvent, Upload } from "@/app/lib/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const [uploads, allEvents] = await Promise.all([
      readTable<Upload>("uploads"),
      readTable<AnalysisEvent>("events"),
    ]);
    const upload = uploads.find((u) => u.id === id);
    if (!upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    const events = allEvents
      .filter((e) => e.uploadId === id)
      .sort((a, b) => a.startTs - b.startTs);
    return NextResponse.json({ upload, events });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab2/uploads/[id] GET]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const uploads = await readTable<Upload>("uploads");
    const upload = uploads.find((u) => u.id === id);
    if (!upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

    await fs.rm(upload.storagePath, { force: true });
    if (upload.thumbnailPath) await fs.rm(upload.thumbnailPath, { force: true });
    await remove("uploads", id);

    const events = await readTable<AnalysisEvent>("events");
    const remaining = events.filter((e) => e.uploadId !== id);
    if (remaining.length !== events.length) {
      await writeTable<AnalysisEvent>("events", remaining);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab2/uploads/[id] DELETE]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
