"use client";

import { useEffect, useState } from "react";
import LandingPage from "@/app/components/LandingPage";
import { SafesightLogoImage } from "@/app/components/SafesightBrand";

const INTRO_KEY = "safesight-intro-seen";
const INTRO_MS = 1500;

export default function SafesightIntro() {
  const [phase, setPhase] = useState<"splash" | "exit" | "done">("splash");
  const [skipIntro, setSkipIntro] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(INTRO_KEY) === "1") {
        setSkipIntro(true);
        setPhase("done");
        return;
      }
    } catch {
      /* private browsing */
    }

    const exitTimer = window.setTimeout(() => setPhase("exit"), INTRO_MS - 400);
    const doneTimer = window.setTimeout(() => {
      setPhase("done");
      try {
        sessionStorage.setItem(INTRO_KEY, "1");
      } catch {
        /* ignore */
      }
    }, INTRO_MS);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  if (skipIntro || phase === "done") {
    return <LandingPage />;
  }

  return (
    <>
      <style>{`
        @keyframes safesight-splash-in {
          0% { opacity: 0; transform: scale(0.88); filter: blur(6px); }
          100% { opacity: 1; transform: scale(1); filter: blur(0); }
        }
        @keyframes safesight-splash-pulse {
          0%, 100% { filter: drop-shadow(0 0 18px rgba(45, 212, 191, 0.25)); }
          50% { filter: drop-shadow(0 0 28px rgba(45, 212, 191, 0.45)); }
        }
        @keyframes safesight-overlay-out {
          0% { opacity: 1; }
          100% { opacity: 0; pointer-events: none; }
        }
        @keyframes safesight-page-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        .safesight-splash-logo {
          animation:
            safesight-splash-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) forwards,
            safesight-splash-pulse 0.9s ease-in-out 0.45s 1;
        }
        .safesight-splash-overlay-exit {
          animation: safesight-overlay-out 0.4s ease forwards;
        }
        .safesight-page-enter {
          animation: safesight-page-in 0.45s ease forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .safesight-splash-logo,
          .safesight-splash-overlay-exit,
          .safesight-page-enter {
            animation: none !important;
          }
        }
      `}</style>

      <div
        className={`fixed inset-0 z-[100] flex items-center justify-center bg-black ${
          phase === "exit" ? "safesight-splash-overlay-exit" : ""
        }`}
        aria-hidden={phase === "exit"}
      >
        <SafesightLogoImage
          priority
          className={`safesight-splash-logo h-auto w-[min(72vw,320px)] max-w-[320px]`}
        />
      </div>

      <div className={phase === "exit" ? "safesight-page-enter opacity-0" : "opacity-0"}>
        <LandingPage />
      </div>
    </>
  );
}
