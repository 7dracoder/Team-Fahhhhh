"use client";

import { useCallback, useState } from "react";
import { fetchWithToast } from "@/app/lib/fetchWithToast";

interface WeeklyStats {
  windowStart: string;
  windowEnd: string;
  totalIncidents: number;
  bySeverity: Record<string, number>;
  byEventType: Record<string, number>;
  sessionCount: number;
  bySource: Record<string, number>;
}

interface ReportResponse {
  report: string;
  stats: WeeklyStats;
  incidentCount: number;
  error?: string;
}

const RANGE_OPTIONS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 14 days", days: 14 },
  { label: "Last 30 days", days: 30 },
];

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-300 border-red-500/30",
  urgent: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  moderate: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  low: "bg-blue-500/20 text-blue-300 border-blue-500/30",
};

const SEVERITY_ORDER = ["critical", "urgent", "moderate", "low"];

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function WeeklyReport() {
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithToast(
        `/api/reports/weekly?days=${days}`,
        { method: "GET" },
        { errorMessage: "Could not generate weekly report" },
      );
      const body = (await res.json()) as ReportResponse;
      if (!res.ok || body.error) throw new Error(body.error || `Failed (${res.status})`);
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, days]);

  const copyReport = useCallback(() => {
    if (data?.report) {
      void navigator.clipboard.writeText(data.report).catch(() => undefined);
    }
  }, [data]);

  const stats = data?.stats;
  const eventTypeEntries = stats
    ? Object.entries(stats.byEventType).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto bg-[#09090f] p-6 text-[15px] text-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Quality &amp; Incident Report</h1>
          <p className="mt-1 max-w-2xl text-xs text-slate-400">
            Weekly aggregate incident report for quality &amp; safety review. Summarizes all
            detected incidents across live monitoring and uploaded footage in the selected window.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            disabled={busy}
            className="rounded-md border border-white/15 bg-[#0c0c12] px-2.5 py-1.5 text-xs text-slate-200 focus:border-emerald-500/40 focus:outline-none disabled:opacity-50"
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-4 py-1.5 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {busy ? "Generating…" : "Generate report"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {!data && !busy && (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-white/10 text-center text-sm text-slate-500">
          Select a window and generate a report to review incident trends.
        </div>
      )}

      {stats && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-[#0c0c12] px-4 py-3">
              <div className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
                Total incidents
              </div>
              <div className="mt-1 text-2xl font-semibold text-white">{stats.totalIncidents}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#0c0c12] px-4 py-3">
              <div className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
                Critical + Urgent
              </div>
              <div className="mt-1 text-2xl font-semibold text-red-300">
                {(stats.bySeverity.critical ?? 0) + (stats.bySeverity.urgent ?? 0)}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#0c0c12] px-4 py-3">
              <div className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
                Sessions / sources
              </div>
              <div className="mt-1 text-2xl font-semibold text-white">{stats.sessionCount}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#0c0c12] px-4 py-3">
              <div className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
                Window
              </div>
              <div className="mt-1 text-xs font-medium text-slate-300">
                {formatDate(stats.windowStart)} – {formatDate(stats.windowEnd)}
              </div>
            </div>
          </div>

          {/* Severity + type breakdown */}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-[#0c0c12] px-4 py-3">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-slate-500">
                By severity
              </div>
              <div className="flex flex-wrap gap-2">
                {SEVERITY_ORDER.map((sev) => (
                  <span
                    key={sev}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium capitalize ${
                      SEVERITY_COLORS[sev] ?? "border-white/10 text-slate-300"
                    }`}
                  >
                    {sev}: {stats.bySeverity[sev] ?? 0}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#0c0c12] px-4 py-3">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-slate-500">
                Top incident types
              </div>
              {eventTypeEntries.length === 0 ? (
                <div className="text-xs text-slate-500">No incidents in window.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {eventTypeEntries.slice(0, 8).map(([type, count]) => (
                    <span
                      key={type}
                      className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs capitalize text-slate-300"
                    >
                      {type.replace(/_/g, " ")}: {count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Narrative report */}
          <div className="flex flex-col rounded-lg border border-sky-500/20 bg-sky-500/5">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2">
              <span className="text-[10px] font-medium uppercase tracking-widest text-sky-300/80">
                Generated report
              </span>
              <button
                type="button"
                onClick={copyReport}
                className="text-[10px] text-slate-400 hover:text-slate-200"
              >
                Copy
              </button>
            </div>
            <pre className="whitespace-pre-wrap px-4 py-3 font-sans text-sm leading-relaxed text-slate-200">
              {data.report}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
