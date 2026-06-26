"use client";

import { forwardRef, useState } from "react";
import { SEVERITY_COLOR, type AnalysisEvent } from "@/app/lib/types";
import SeverityBadge from "@/app/tab2/components/SeverityBadge";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function sentenceCase(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

interface Props {
  event: AnalysisEvent;
  active?: boolean;
  onClick?: () => void;
  /**
   * Override what to render in the leading time slot. Defaults to MM:SS of `event.startTs`,
   * which is correct for upload-mode events. Live-mode callers can pass a wall-clock or
   * elapsed-second string.
   */
  timeLabel?: string;
}

const SharedEventCard = forwardRef<HTMLDivElement, Props>(function SharedEventCard(
  { event, active = false, onClick, timeLabel },
  ref,
) {
  const [open, setOpen] = useState(false);
  const color = SEVERITY_COLOR[event.severity];

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`group ${onClick ? "cursor-pointer" : ""} rounded-r-lg bg-[#0c0c12] px-3.5 py-2.5 transition-colors ${
        onClick ? "hover:bg-white/5" : ""
      } ${active ? "ring-2 ring-white/30" : ""}`}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-xs text-slate-500">
            {timeLabel ?? formatTime(event.startTs)}
          </span>
          <span className="truncate text-xs font-medium text-slate-200">
            {event.patientLabel}
          </span>
          <span className="truncate text-xs text-slate-400">
            {sentenceCase(event.eventType)}
          </span>
        </div>
        <SeverityBadge severity={event.severity} />
      </div>
      <p className="mt-1.5 text-sm leading-snug text-slate-300">{event.summary}</p>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((p) => !p);
        }}
        className="mt-1.5 text-[11px] text-slate-500 transition-colors hover:text-slate-300"
      >
        Symptoms {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {event.symptoms.length === 0 ? (
            <span className="text-[11px] text-slate-600">No symptoms recorded.</span>
          ) : (
            event.symptoms.map((s) => (
              <span
                key={s}
                className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300"
              >
                {s}
              </span>
            ))
          )}
        </div>
      )}
    </div>
  );
});

export default SharedEventCard;
