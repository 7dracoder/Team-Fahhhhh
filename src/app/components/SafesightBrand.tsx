import Image from "next/image";

const GREEN = "#22c55e";
const ICON = "/safesight-icon.png";

export function SafesightWordmark({
  className = "text-lg",
  showTagline = false,
  onLightBg = false,
}: {
  className?: string;
  showTagline?: boolean;
  onLightBg?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className={`font-bold tracking-[0.18em] ${className}`}>
        <span className={onLightBg ? "text-slate-900" : "text-white"}>SAFE</span>
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

function SafesightIcon({
  className = "h-10 w-auto",
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={ICON}
      alt=""
      width={164}
      height={98}
      priority={priority}
      className={`object-contain ${className}`}
    />
  );
}

/** Header: icon + wordmark side by side */
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
      <SafesightIcon className={iconClassName} priority />
      <SafesightWordmark showTagline={showTagline} />
    </div>
  );
}

/** Hero: icon only on white panel, wordmark rendered separately below */
export function SafesightLogoHero({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white px-8 py-12 sm:px-12 sm:py-14 ${className}`}
    >
      <SafesightIcon className="h-auto w-[min(100%,200px)]" priority />
      <div className="mt-6">
        <SafesightWordmark className="text-2xl sm:text-3xl" showTagline onLightBg />
      </div>
    </div>
  );
}
