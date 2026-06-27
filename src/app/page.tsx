import type { Metadata } from "next";
import SafesightIntro from "@/app/components/SafesightIntro";

export const metadata: Metadata = {
  title: "SAFESIGHT — Vision Protection",
  description:
    "Real-time patient monitoring with pose detection, vision models, and clinical alerts via TTS and iMessage.",
};

export default function Home() {
  return <SafesightIntro />;
}
