"use client";

import { SEVERITY_COLOR, type Severity } from "@/app/lib/types";

export type SeverityFilter = "all" | Severity;

const ORDER: SeverityFilter[] = [
  "all",
  "critical",
  "urgent",
  "moderate",
  "low",
  "normal",
];

const LABEL: Record<SeverityFilter, string> = {
  all: "All",
  critical: "Critical",
  urgent: "Urgent",
  moderate: "Moderate",
  low: "Low",
  normal: "Normal",
};

interface Props {
  value: SeverityFilter;
  onChange: (next: SeverityFilter) => void;
  /** Optional per-severity counts shown as a small "(N)" suffix. */
  counts?: Partial<Record<SeverityFilter, number>>;
}

export default function SeverityFilterChips({ value, onChange, counts }: Props) {
  return (
    <div role="group" aria-label="Severity filter" className="flex flex-wrap items-center gap-1.5">
      {ORDER.map((sev) => {
        const active = value === sev;
        const color = sev === "all" ? "#94a3b8" : SEVERITY_COLOR[sev];
        const style = active
          ? {
              backgroundColor: `${color}33`, // ~20% alpha
              boxShadow: `inset 0 0 0 1px ${color}`,
              color: "#f1f5f9",
            }
          : undefined;
        const count = counts?.[sev];
        return (
          <button
            key={sev}
            type="button"
            onClick={() => onChange(sev)}
            aria-pressed={active}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
              active
                ? ""
                : "border border-white/10 bg-[#0c0c12] text-slate-400 hover:border-white/25 hover:text-slate-200"
            }`}
            style={style}
          >
            {LABEL[sev]}
            {typeof count === "number" && count > 0 && (
              <span className="ml-1 text-slate-400">({count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
