import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { insert } from "@/app/lib/storage";
import type { LiveSession } from "@/app/lib/types";

export const runtime = "nodejs";

interface CreateBody {
  patientLabel?: unknown;
}

export async function POST(req: Request) {
  try {
    let body: CreateBody = {};
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      body = {};
    }
    const raw =
      typeof body.patientLabel === "string" ? body.patientLabel.trim() : "";
    const patientLabel = raw.length > 0 ? raw : "Patient";

    const session: LiveSession = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      status: "active",
      patientLabel,
    };
    await insert<LiveSession>("sessions", session);
    return NextResponse.json({ sessionId: session.id, patientLabel: session.patientLabel });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/tab3/sessions POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
