import Image from "next/image";

const TEAL = "#2dd4bf";

export function SafesightEye({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 48" className={className} fill="none" aria-hidden>
      <ellipse cx="40" cy="24" rx="36" ry="20" stroke={TEAL} strokeWidth="1.5" />
      <circle cx="40" cy="24" r="14" stroke={TEAL} strokeWidth="1" opacity="0.45" />
      <circle cx="40" cy="24" r="9" stroke={TEAL} strokeWidth="1" opacity="0.7" />
      <circle cx="40" cy="24" r="5" fill="#f59e0b" />
      <path
        d="M38 24l1.5 1.5L43 22"
        stroke="#0a0a0a"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {[22, 26, 30, 34, 38, 42, 46, 50, 54].map((x) => (
        <circle key={x} cx={x} cy="11" r="1.2" fill={TEAL} opacity="0.85" />
      ))}
    </svg>
  );
}

export function SafesightWordmark({
  className = "text-lg",
  showTagline = false,
}: {
  className?: string;
  showTagline?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className={`font-bold tracking-[0.18em] ${className}`}>
        <span className="text-white">SAFE</span>
        <span style={{ color: TEAL }}>SIGHT</span>
      </span>
      {showTagline && (
        <>
          <div className="mt-1 h-px w-full max-w-[140px]" style={{ background: `${TEAL}55` }} />
          <span
            className="mt-1 text-[9px] font-medium tracking-[0.35em]"
            style={{ color: TEAL }}
          >
            VISION PROTECTION
          </span>
        </>
      )}
    </div>
  );
}

export function SafesightLogo({
  className = "",
  showTagline = false,
  iconClassName = "h-9 w-9",
}: {
  className?: string;
  showTagline?: boolean;
  iconClassName?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <SafesightEye className={iconClassName} />
      <SafesightWordmark showTagline={showTagline} />
    </div>
  );
}

export function SafesightLogoImage({
  className = "",
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/safesight-logo.png"
      alt="SAFESIGHT — Vision Protection"
      width={320}
      height={320}
      priority={priority}
      className={className}
    />
  );
}
