import { NextResponse } from "next/server";
import { readTable, update } from "@/app/lib/storage";
import { publish } from "@/app/lib/sessionBus";
import type { LiveSession } from "@/app/lib/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const sessions = await readTable<LiveSession>("sessions");
    const session = sessions.find((s) => s.id === id);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.status === "ended") {
      publish(id, { type: "session_ended" });
      return NextResponse.json({ session });
    }
    const updated = await update<LiveSession>("sessions", id, {
      status: "ended",
      endedAt: new Date().toISOString(),
    });
    publish(id, { type: "session_ended" });
    return NextResponse.json({ session: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab3/sessions/[id]/end POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
