import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { readTable } from "@/app/lib/storage";
import type { Upload } from "@/app/lib/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
};

function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
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

export async function GET(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const uploads = await readTable<Upload>("uploads");
    const upload = uploads.find((u) => u.id === id);
    if (!upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

    const filePath = upload.storagePath;
    const stats = await stat(filePath);
    const size = stats.size;
    const contentType = mimeFor(filePath);

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
      return new Response(webStream, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
      });
    }

    const stream = createReadStream(filePath);
    const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Video file missing on disk" }, { status: 404 });
    }
    console.error("[/api/tab2/uploads/[id]/video]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
