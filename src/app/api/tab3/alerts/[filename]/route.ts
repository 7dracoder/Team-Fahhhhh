import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { ALERTS_DIR } from "@/app/lib/storage";

export const runtime = "nodejs";

const FILENAME_RE = /^[a-z0-9-]+\.mp3$/;

type RouteContext = { params: Promise<{ filename: string }> };

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { filename } = await ctx.params;
    if (!FILENAME_RE.test(filename)) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    const file = path.join(ALERTS_DIR, filename);
    let buf: Buffer;
    try {
      buf = await fs.readFile(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json({ error: "Alert audio not found" }, { status: 404 });
      }
      throw err;
    }

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab3/alerts/[filename] GET]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
