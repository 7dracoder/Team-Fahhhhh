import { readdir } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".mkv"]);

export async function GET() {
  const dir = join(process.cwd(), "public", "video_samples");
  try {
    const files = await readdir(dir);
    const videos = files.filter((f) => VIDEO_EXTS.has(f.slice(f.lastIndexOf("."))));
    return NextResponse.json({ videos });
  } catch {
    return NextResponse.json({ videos: [] });
  }
}
