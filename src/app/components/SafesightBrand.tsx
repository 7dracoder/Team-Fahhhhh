import Image from "next/image";

const GREEN = "#22c55e";

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
        <span style={{ color: GREEN }}>SIGHT</span>
      </span>
      {showTagline && (
        <>
          <div className="mt-1 h-px w-full max-w-[140px]" style={{ background: `${GREEN}55` }} />
          <span
            className="mt-1 text-[9px] font-medium tracking-[0.35em]"
            style={{ color: GREEN }}
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
  iconClassName = "h-10 w-auto",
}: {
  className?: string;
  showTagline?: boolean;
  iconClassName?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Image
        src="/safesight-logo.png"
        alt=""
        width={204}
        height={192}
        className={`object-contain ${iconClassName}`}
      />
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
      alt="SAFESIGHT"
      width={204}
      height={192}
      priority={priority}
      className={className}
    />
  );
}
