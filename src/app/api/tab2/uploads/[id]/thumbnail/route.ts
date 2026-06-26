import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { THUMBNAILS_DIR } from "@/app/lib/storage";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const file = path.join(THUMBNAILS_DIR, `${id}.jpg`);
    let buf: Buffer;
    try {
      buf = await fs.readFile(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });
      }
      throw err;
    }
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(buf.length),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab2/uploads/[id]/thumbnail GET]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
