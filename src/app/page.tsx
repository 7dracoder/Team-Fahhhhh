import type { Metadata } from "next";
import LandingPage from "@/app/components/LandingPage";

export const metadata: Metadata = {
  title: "SAFESIGHT — Vision Protection",
  description:
    "Real-time patient monitoring with pose detection, vision models, and clinical alerts via TTS and iMessage.",
};

export default function Home() {
  return <LandingPage />;
}
