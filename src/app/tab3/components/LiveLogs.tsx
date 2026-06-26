"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisEvent } from "@/app/lib/types";
import SharedEventCard from "@/app/components/SharedEventCard";

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

/** Same visible “message” for back-to-back merge in the live log. */
function isSameLogMessage(a: AnalysisEvent, b: AnalysisEvent): boolean {
  return (
    a.patientLabel === b.patientLabel &&
    a.eventType === b.eventType &&
    a.severity === b.severity &&
    a.summary === b.summary
  );
}

function mergeConsecutiveDuplicateLogs(
  events: AnalysisEvent[],
): Array<{ event: AnalysisEvent; timeLabel: string }> {
  if (events.length === 0) return [];
  const rows: Array<{ event: AnalysisEvent; timeLabel: string }> = [];
  let i = 0;
  while (i < events.length) {
    const start = events[i];
    let j = i + 1;
    while (j < events.length && isSameLogMessage(start, events[j])) {
      j++;
    }
    const end = events[j - 1];
    const timeLabel =
      j > i + 1
        ? `${formatClock(start.createdAt)}–${formatClock(end.createdAt)}`
        : formatClock(start.createdAt);
    rows.push({ event: start, timeLabel });
    i = j;
  }
  return rows;
}

const STICK_THRESHOLD_PX = 50;

export default function LiveLogs({ events }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoStick, setAutoStick] = useState(true);
  const autoStickRef = useRef(autoStick);

  useEffect(() => {
    autoStickRef.current = autoStick;
  }, [autoStick]);

  /** Chronological merge, then newest-first for display. */
  const mergedRows = useMemo(() => {
    const merged = mergeConsecutiveDuplicateLogs(events);
    return merged.slice().reverse();
  }, [events]);

  useEffect(() => {
    if (!autoStickRef.current) return;
    containerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [mergedRows.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromTop = el.scrollTop;
    const stick = distanceFromTop < STICK_THRESHOLD_PX;
    if (stick !== autoStickRef.current) setAutoStick(stick);
  };

  if (events.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-[#0c0c12] px-3 py-6 text-center text-xs text-slate-500">
        Waiting for events…
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="-mr-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-2"
      >
{mergedRows.map(({ event: evt, timeLabel }) => (
          <SharedEventCard
            key={evt.id}
            event={evt}
            timeLabel={timeLabel}
          />
        ))}
      </div>
      {!autoStick && (
        <button
          type="button"
          onClick={() => {
            setAutoStick(true);
            containerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="absolute top-2 right-2 rounded-full border border-white/20 bg-black/70 px-3 py-1 text-[11px] text-slate-200 shadow-lg backdrop-blur hover:bg-black/90"
        >
          ↑ Newest
        </button>
      )}
    </div>
  );
}
