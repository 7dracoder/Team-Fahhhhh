"use client";

import { useMemo } from "react";
import type { AnalysisEvent, Severity } from "@/app/lib/types";
import SeverityBadge from "@/app/tab2/components/SeverityBadge";

interface Props {
  events: AnalysisEvent[];
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function sentenceCase(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const SEVERITY_RANK: Record<Severity, number> = {
  normal: 0,
  low: 1,
  moderate: 2,
  urgent: 3,
  critical: 4,
};

export default function KeyEventsSummary({ events }: Props) {
  // Latest event per patient, sorted by highest severity first
  const rows = useMemo(() => {
    const byPatient = new Map<string, AnalysisEvent>();
    for (const e of events) {
      const existing = byPatient.get(e.patientLabel);
      if (
        !existing ||
        e.createdAt > existing.createdAt
      ) {
        byPatient.set(e.patientLabel, e);
      }
    }
    return [...byPatient.values()].sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    );
  }, [events]);

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-[#0c0c12] px-3 py-4 text-center text-xs text-slate-500">
        No patients monitored yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div
          key={r.patientLabel}
          className="flex flex-col gap-1.5 rounded-md border border-white/10 bg-[#0c0c12] px-3 py-2.5"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-white">{r.patientLabel}</span>
              <span className="shrink-0 text-[11px] text-slate-500">{sentenceCase(r.eventType)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-[10px] text-slate-600">{formatClock(r.createdAt)}</span>
              <SeverityBadge severity={r.severity} />
            </div>
          </div>
          {r.summary && (
            <p className="text-xs text-slate-400 leading-relaxed">{r.summary}</p>
          )}
          {r.symptoms.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {r.symptoms.map((s) => (
                <span key={s} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
