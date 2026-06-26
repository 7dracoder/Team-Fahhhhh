"use client";

import { useEffect, useRef } from "react";
import type { AnalysisEvent } from "@/app/lib/types";
import SharedEventCard from "@/app/components/SharedEventCard";

interface Props {
  events: AnalysisEvent[];
  activeEventId: string | null;
  onSelect?: (event: AnalysisEvent) => void;
}

export default function EventLogs({ events, activeEventId, onSelect }: Props) {
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const prevActiveRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeEventId && activeEventId !== prevActiveRef.current) {
      const el = itemRefs.current[activeEventId];
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    prevActiveRef.current = activeEventId;
  }, [activeEventId]);

  if (events.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-[#0c0c12] px-3 py-6 text-center text-xs text-slate-500">
        No events yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {events.map((evt) => (
        <SharedEventCard
          key={evt.id}
          ref={(el) => {
            itemRefs.current[evt.id] = el;
          }}
          event={evt}
          active={evt.id === activeEventId}
          onClick={onSelect ? () => onSelect(evt) : undefined}
        />
      ))}
    </div>
  );
}
