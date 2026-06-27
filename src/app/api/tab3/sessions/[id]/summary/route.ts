import { NextResponse } from "next/server";
import { readTable } from "@/app/lib/storage";
import { generateHandoffSummary } from "@/app/lib/handoffSummary";
import type { AnalysisEvent, LiveSession } from "@/app/lib/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const [sessions, allEvents] = await Promise.all([
      readTable<LiveSession>("sessions"),
      readTable<AnalysisEvent>("events"),
    ]);
    const session = sessions.find((s) => s.id === id);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const events = allEvents
      .filter((e) => e.sessionId === id)
      .sort((a, b) => a.startTs - b.startTs);

    const summary = await generateHandoffSummary(session, events);
    return NextResponse.json({ summary, eventCount: events.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab3/sessions/[id]/summary POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
