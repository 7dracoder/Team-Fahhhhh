import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { LIVE_RECORDINGS_DIR, readTable, update } from "@/app/lib/storage";
import type { LiveSession } from "@/app/lib/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const MIME: Record<string, string> = {
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};

function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? "video/webm";
}

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, sRaw, eRaw] = match;
  let start: number;
  let end: number;
  if (sRaw === "" && eRaw === "") return null;
  if (sRaw === "") {
    const suffix = parseInt(eRaw, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(sRaw, 10);
    end = eRaw === "" ? size - 1 : parseInt(eRaw, 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || start >= size) return null;
  if (end >= size) end = size - 1;
  return { start, end };
}

/**
 * POST multipart: file (video blob), sessionOffsetSec, durationSec, mimeType (optional).
 * Saves under storage/videos/live/{id}.webm and updates the live session row.
 */
export async function POST(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const sessions = await readTable<LiveSession>("sessions");
    const session = sessions.find((s) => s.id === id);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.status !== "active") {
      return NextResponse.json(
        { error: "Session is not active; upload before ending the session" },
        { status: 400 },
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const offsetRaw = form.get("sessionOffsetSec");
    const durationRaw = form.get("durationSec");
    const mimeRaw = form.get("mimeType");
    const sessionOffsetSec =
      typeof offsetRaw === "string" && Number.isFinite(parseFloat(offsetRaw))
        ? parseFloat(offsetRaw)
        : 0;
    const durationSec =
      typeof durationRaw === "string" && Number.isFinite(parseFloat(durationRaw))
        ? parseFloat(durationRaw)
        : undefined;
    const mimeType =
      typeof mimeRaw === "string" && mimeRaw.length > 0 ? mimeRaw : file.type || "video/webm";

    const ext = mimeType.includes("webm") ? ".webm" : ".mp4";
    const absPath = path.join(LIVE_RECORDINGS_DIR, `${id}${ext}`);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > 500 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large" }, { status: 413 });
    }
    await writeFile(absPath, buf);

    const updated = await update<LiveSession>("sessions", id, {
      recordingStoragePath: absPath,
      recordingMimeType: mimeType,
      recordingDurationSec: durationSec,
      recordingSessionOffsetSec: sessionOffsetSec,
    });

    return NextResponse.json({ ok: true, session: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab3/sessions/[id]/recording POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Stream the saved session recording (Range-capable for HTML video). `?download=1` sets Content-Disposition: attachment. */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const sessions = await readTable<LiveSession>("sessions");
    const session = sessions.find((s) => s.id === id);
    if (!session?.recordingStoragePath) {
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    }

    const filePath = session.recordingStoragePath;
    const stats = await stat(filePath);
    const size = stats.size;
    const contentType = session.recordingMimeType ?? mimeFor(filePath);
    const download =
      new URL(req.url).searchParams.get("download") === "1" ||
      new URL(req.url).searchParams.get("download") === "true";
    const ext = path.extname(filePath).toLowerCase() || ".webm";
    const filename = `session-${id.slice(0, 8)}${ext}`;

    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      const range = parseRange(rangeHeader, size);
      if (!range) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${size}`,
            "Accept-Ranges": "bytes",
          },
        });
      }
      const { start, end } = range;
      const stream = createReadStream(filePath, { start, end });
      const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      };
      if (download) {
        headers["Content-Disposition"] = `attachment; filename="${filename}"`;
      }
      return new Response(webStream, {
        status: 206,
        headers,
      });
    }

    const stream = createReadStream(filePath);
    const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    const fullHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    };
    if (download) {
      fullHeaders["Content-Disposition"] = `attachment; filename="${filename}"`;
    }
    return new Response(webStream, {
      status: 200,
      headers: fullHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Recording file missing" }, { status: 404 });
    }
    console.error("[/api/tab3/sessions/[id]/recording GET]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
