import { SEVERITY_COLOR, type Severity } from "@/app/lib/types";

interface Props {
  severity: Severity;
  className?: string;
}

export default function SeverityBadge({ severity, className = "" }: Props) {
  const color = SEVERITY_COLOR[severity];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${className}`}
      style={{ borderColor: `${color}55`, background: `${color}1f`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {severity}
    </span>
  );
}
