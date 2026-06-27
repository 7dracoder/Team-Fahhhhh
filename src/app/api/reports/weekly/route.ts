/**
 * Weekly quality/incident report for a healthcare quality professional.
 *
 * Aggregates ALL incident events (live sessions + uploads) within a reporting
 * window (default: last 7 days) and generates a narrative report plus the raw
 * stats for charting.
 *
 * GET  /api/reports/weekly            → last 7 days
 * GET  /api/reports/weekly?days=30    → last 30 days
 * GET  /api/reports/weekly?start=ISO&end=ISO → explicit window
 */
import { NextResponse } from "next/server";
import { readTable } from "@/app/lib/storage";
import {
  computeWeeklyStats,
  generateWeeklyReport,
} from "@/app/lib/weeklyReport";
import type { AnalysisEvent } from "@/app/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseWindow(req: Request): { start: Date; end: Date } {
  const url = new URL(req.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const daysParam = url.searchParams.get("days");

  const end = endParam ? new Date(endParam) : new Date();
  let start: Date;
  if (startParam) {
    start = new Date(startParam);
  } else {
    const days = Number(daysParam);
    const lookback = Number.isFinite(days) && days > 0 ? days : 7;
    start = new Date(end.getTime() - lookback * 24 * 60 * 60 * 1000);
  }
  return { start, end };
}

export async function GET(req: Request) {
  try {
    const { start, end } = parseWindow(req);
    const startMs = start.getTime();
    const endMs = end.getTime();

    const allEvents = await readTable<AnalysisEvent>("events");

    // Quality reporting is about real incidents, so exclude "normal" noise.
    const windowEvents = allEvents
      .filter((e) => {
        const t = new Date(e.createdAt).getTime();
        return Number.isFinite(t) && t >= startMs && t <= endMs;
      })
      .filter((e) => e.severity !== "normal" && e.eventType !== "normal")
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

    const stats = computeWeeklyStats(
      windowEvents,
      start.toISOString(),
      end.toISOString(),
    );
    const report = await generateWeeklyReport(stats, windowEvents);

    return NextResponse.json({ report, stats, incidentCount: windowEvents.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/reports/weekly GET]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
