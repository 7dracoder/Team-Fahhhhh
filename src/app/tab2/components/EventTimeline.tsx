"use client";

import { useRef } from "react";
import { SEVERITY_COLOR, type AnalysisEvent, type Severity } from "@/app/lib/types";

const SEVERITIES: Severity[] = ["normal", "low", "moderate", "urgent", "critical"];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

interface Props {
  events: AnalysisEvent[];
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
}

export default function EventTimeline({ events, currentTime, duration, onSeek }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const safeDuration = duration > 0 ? duration : 1;
  const playheadPct = Math.max(0, Math.min(100, (currentTime / safeDuration) * 100));

  const handleSeek = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(ratio * safeDuration);
  };

  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-1 text-[10px] font-mono text-slate-500">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
      <div className="relative h-11 w-full overflow-hidden rounded-lg border border-white/10 bg-[#0c0c12]">
        <svg
          ref={svgRef}
          width="100%"
          height="44"
          className="block cursor-pointer"
          onClick={(e) => handleSeek(e.clientX)}
          role="slider"
          aria-label="Event timeline"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
        >
          <line
            x1="0"
            x2="100%"
            y1="22"
            y2="22"
            stroke="#ffffff"
            strokeOpacity="0.06"
            strokeWidth="1"
          />
          {events.map((evt) => {
            const xPct = (evt.startTs / safeDuration) * 100;
            const wPct = Math.max(0.6, ((evt.endTs - evt.startTs) / safeDuration) * 100);
            return (
              <rect
                key={evt.id}
                x={`${xPct}%`}
                y={6}
                width={`${wPct}%`}
                height={32}
                rx={2}
                fill={SEVERITY_COLOR[evt.severity]}
                fillOpacity={0.85}
              >
                <title>{`${formatTime(evt.startTs)} — ${evt.patientLabel} — ${evt.eventType}`}</title>
              </rect>
            );
          })}
          <line
            x1={`${playheadPct}%`}
            x2={`${playheadPct}%`}
            y1={0}
            y2={44}
            stroke="#ffffff"
            strokeWidth={2}
            pointerEvents="none"
          />
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-3">
        {SEVERITIES.map((sev) => (
          <div
            key={sev}
            className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400"
          >
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: SEVERITY_COLOR[sev] }}
            />
            {sev}
          </div>
        ))}
      </div>
    </div>
  );
}
