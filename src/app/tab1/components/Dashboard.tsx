"use client";

import { useState, useEffect } from "react";
import type { Patient, TriageLevel } from "@/app/tab1/types";

const DISPLAY: Record<TriageLevel, { label: string; borderColor: string; cardBg: string; pillBg: string; pillText: string; pillBorder: string; badgeBg: string; badgeText: string; dot: string; thumbBg: string }> = {
  CRITICAL:   { label: "URGENT",      borderColor: "#ef4444", cardBg: "#0e0708", pillBg: "#2a0a0a", pillText: "#fca5a5", pillBorder: "#7f1d1d", badgeBg: "#7f1d1d", badgeText: "#fca5a5", dot: "#ef4444", thumbBg: "#180508" },
  URGENT:     { label: "CONCERNING",  borderColor: "#d97706", cardBg: "#0d0c07", pillBg: "#1c1500", pillText: "#fcd34d", pillBorder: "#78350f", badgeBg: "#78350f", badgeText: "#fcd34d", dot: "#d97706", thumbBg: "#110c00" },
  STABLE:     { label: "STABLE",      borderColor: "#10b981", cardBg: "#04100a", pillBg: "#001a0f", pillText: "#6ee7b7", pillBorder: "#064e3b", badgeBg: "#065f46", badgeText: "#6ee7b7", dot: "#10b981", thumbBg: "#000e07" },
  MONITORING: { label: "STABLE",      borderColor: "#10b981", cardBg: "#04100a", pillBg: "#001a0f", pillText: "#6ee7b7", pillBorder: "#064e3b", badgeBg: "#065f46", badgeText: "#6ee7b7", dot: "#10b981", thumbBg: "#000e07" },
};

const BODY_PALETTES = [
  ["#ef4444", "#7f1d1d"], ["#7c3aed", "#ef4444"], ["#3b82f6", "#6d28d9"],
  ["#f59e0b", "#3b82f6"], ["#10b981", "#3b82f6"], ["#ec4899", "#7c3aed"],
];

function Thumbnail({ triage, index }: { triage: TriageLevel; index: number }) {
  const cfg = DISPLAY[triage];
  const [c1, c2] = BODY_PALETTES[index % BODY_PALETTES.length];
  return (
    <div className="flex-shrink-0 w-[76px] rounded-xl flex flex-col items-center justify-center gap-1.5 py-3 self-stretch" style={{ background: cfg.thumbBg }}>
      <div className="w-8 h-8 rounded-full" style={{ background: "rgba(255,255,255,0.75)" }} />
      <div className="w-12 h-6 rounded-md" style={{ background: c1 }} />
      <div className="flex gap-1">
        <div className="w-[22px] h-8 rounded-md" style={{ background: c2 }} />
        <div className="w-[22px] h-8 rounded-md" style={{ background: c1 }} />
      </div>
      <div className="w-11 h-[3px] rounded-full" style={{ background: cfg.dot, opacity: 0.7 }} />
    </div>
  );
}

function minutesSince(timeStr: string): number {
  const [h, m, s] = timeStr.split(":").map(Number);
  const then = new Date();
  then.setHours(h, m, s, 0);
  return Math.max(0, Math.floor((Date.now() - then.getTime()) / 60000));
}

function WaitingTimer({ firstSeen }: { firstSeen: string }) {
  const [mins, setMins] = useState(() => minutesSince(firstSeen));
  useEffect(() => {
    const id = setInterval(() => setMins(minutesSince(firstSeen)), 30000);
    return () => clearInterval(id);
  }, [firstSeen]);
  return (
    <div className="text-right flex-shrink-0">
      <div className="text-[9px] text-slate-500 uppercase tracking-widest">WAITING</div>
      <div className="text-sm font-bold text-slate-300">{mins}m</div>
    </div>
  );
}

function PatientCard({ patient, index, onDismiss }: { patient: Patient; index: number; onDismiss: (key: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = DISPLAY[patient.triage];
  const key = `${patient.cameraLabel}:${patient.id}`;
  const pills = [patient.posture, patient.movement, patient.visible_distress ? "visible distress" : ""].filter(Boolean);

  return (
    <div className="rounded-2xl p-3.5 flex gap-3" style={{ background: cfg.cardBg, border: `1px solid ${cfg.borderColor}55` }}>
      {patient.thumbnail ? (
        <div className="flex-shrink-0 w-[76px] rounded-xl overflow-hidden self-stretch" style={{ background: cfg.thumbBg, border: `1px solid ${cfg.borderColor}30` }}>
          <img src={patient.thumbnail} alt={patient.id} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
      ) : (
        <Thumbnail triage={patient.triage} index={index} />
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md capitalize" style={{ background: cfg.thumbBg, color: cfg.dot, border: `1px solid ${cfg.dot}35` }}>
            {patient.id}
          </span>
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1" style={{ background: cfg.badgeBg, color: cfg.badgeText, border: `1px solid ${cfg.dot}50` }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: cfg.dot }} />
            {cfg.label}
          </span>
          <button onClick={() => setExpanded(!expanded)} className="ml-auto text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-0.5 cursor-pointer flex-shrink-0">
            Details {expanded ? "▲" : "▼"}
          </button>
        </div>

        <p className="text-[13px] text-white font-medium leading-snug mb-2.5 line-clamp-2">{patient.reason}</p>

        <div className="flex flex-wrap gap-1.5 mb-auto">
          {pills.map((f) => (
            <span key={f} className="text-[11px] px-2.5 py-0.5 rounded-full" style={{ background: cfg.pillBg, color: cfg.pillText, border: `1px solid ${cfg.pillBorder}` }}>
              {f}
            </span>
          ))}
        </div>

        {expanded && (
          <div className="mt-2.5 mb-2.5 text-xs text-slate-500 space-y-1 border-t border-white/5 pt-2.5">
            <div className="flex justify-between"><span>Location</span><span className="text-slate-400">{patient.location}</span></div>
            <div className="flex justify-between"><span>Source</span><span className="text-slate-400">{patient.cameraLabel}</span></div>
            <div className="flex justify-between"><span>First seen</span><span className="text-slate-400">{patient.firstSeen}</span></div>
            {patient.confidence > 0 && <div className="flex justify-between"><span>Confidence</span><span className="text-slate-400">{Math.round(patient.confidence * 100)}%</span></div>}
          </div>
        )}

        <div className="flex items-end justify-between mt-3">
          <button onClick={() => onDismiss(key)} className="text-[11px] text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 px-3 py-1.5 rounded-lg transition-colors cursor-pointer">
            Mark as receiving care
          </button>
          <WaitingTimer firstSeen={patient.firstSeen} />
        </div>
      </div>
    </div>
  );
}

interface DashboardProps { patients: Patient[]; onDismiss: (key: string) => void; }

export default function Dashboard({ patients, onDismiss }: DashboardProps) {
  const criticalCount = patients.filter((p) => p.triage === "CRITICAL").length;

  return (
    <div>
      {criticalCount > 0 && (
        <div className="mb-5 px-5 py-3.5 rounded-xl flex items-center gap-3" style={{ background: "#3d0c0c", border: "1px solid #7f1d1d", animation: "alert-pulse 1.6s ease-in-out infinite" }}>
          <style>{`@keyframes alert-pulse { 0%,100%{opacity:1;border-color:#7f1d1d} 50%{opacity:0.6;border-color:#ef4444} }`}</style>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="flex-shrink-0">
            <path d="M9 2.5L16 15H2L9 2.5Z" stroke="#fca5a5" strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
            <path d="M9 7.5v3.5" stroke="#fca5a5" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="9" cy="13" r="0.75" fill="#fca5a5"/>
          </svg>
          <span className="text-[#fca5a5] text-sm">
            Immediate attention recommended for <strong>{criticalCount}</strong> patient{criticalCount > 1 ? "s" : ""} based on the latest visible cues.
          </span>
        </div>
      )}

      {patients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-28 gap-3 text-slate-700">
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
            <rect x="2" y="9" width="30" height="26" rx="3" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M32 16l10-6v24l-10-6V16z" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="17" cy="22" r="6" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          <span className="text-sm">No patients detected yet.</span>
          <span className="text-xs">Go to Sources and start a camera or video simulation.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {patients.map((p, i) => (
            <PatientCard key={`${p.cameraLabel}:${p.id}`} patient={p} index={i} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </div>
  );
}
