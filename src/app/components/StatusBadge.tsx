import type { UploadStatus } from "@/app/lib/types";

const STATUS_STYLE: Record<UploadStatus, string> = {
  uploading: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  queued: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  analyzing: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  done: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-300 border-red-500/30",
};

export default function StatusBadge({ status }: { status: UploadStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLE[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}
