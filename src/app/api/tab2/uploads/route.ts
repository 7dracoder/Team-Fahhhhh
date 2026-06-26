import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { THUMBNAILS_DIR, VIDEOS_DIR, insert, readTable } from "@/app/lib/storage";
import { startAnalysis } from "@/app/lib/analysisRunner";
import { extractThumbnail, getDuration } from "@/app/lib/ffmpeg";
import type { AnalysisEvent, Upload } from "@/app/lib/types";

export const runtime = "nodejs";

const MAX_BYTES = 500 * 1024 * 1024;
const ALLOWED_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v"]);

function safeExt(filename: string): string {
  const ext = path.extname(filename || "").toLowerCase();
  if (!ext || !ALLOWED_EXT.has(ext)) return ".mp4";
  return ext;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "Empty upload" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 500MB limit" }, { status: 413 });
    }
    if (file.type && !file.type.startsWith("video/")) {
      return NextResponse.json({ error: `Unsupported media type: ${file.type}` }, { status: 415 });
    }

    const id = randomUUID();
    const ext = safeExt(file.name);
    const storagePath = path.join(VIDEOS_DIR, `${id}${ext}`);

    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(storagePath, buf);

    let durationSeconds: number | undefined;
    try {
      durationSeconds = await getDuration(storagePath);
    } catch (err) {
      console.warn(
        `[uploads POST] ffprobe failed (non-fatal, will retry in analyzer):`,
        err instanceof Error ? err.message : err,
      );
    }

    let thumbnailPath: string | undefined;
    try {
      const thumb = path.join(THUMBNAILS_DIR, `${id}.jpg`);
      await extractThumbnail(storagePath, thumb, 1);
      thumbnailPath = thumb;
    } catch (err) {
      console.warn(
        `[uploads POST] thumbnail extraction failed (non-fatal):`,
        err instanceof Error ? err.message : err,
      );
    }

    const row: Upload = {
      id,
      filename: file.name || `${id}${ext}`,
      storagePath,
      durationSeconds,
      thumbnailPath,
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    await insert<Upload>("uploads", row);

    void startAnalysis(id);

    return NextResponse.json({ uploadId: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab2/uploads POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const [uploads, events] = await Promise.all([
      readTable<Upload>("uploads"),
      readTable<AnalysisEvent>("events"),
    ]);
    const counts = new Map<string, number>();
    for (const e of events) {
      if (!e.uploadId) continue;
      counts.set(e.uploadId, (counts.get(e.uploadId) ?? 0) + 1);
    }
    const rows = uploads
      .map((u) => ({ ...u, eventCount: counts.get(u.id) ?? 0 }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json({ uploads: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab2/uploads GET]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
