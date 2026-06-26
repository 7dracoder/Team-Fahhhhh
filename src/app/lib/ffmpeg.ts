import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function ensureBinary(bin: "ffmpeg" | "ffprobe"): Promise<void> {
  try {
    await execFileAsync(bin, ["-version"]);
  } catch {
    throw new Error(
      `${bin} not found on PATH. Install it (e.g. \`brew install ffmpeg\`) and retry.`,
    );
  }
}

export async function getDuration(videoPath: string): Promise<number> {
  await ensureBinary("ffprobe");
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const seconds = parseFloat(stdout.trim());
  if (!Number.isFinite(seconds)) {
    throw new Error(`ffprobe could not parse duration for ${videoPath}`);
  }
  return seconds;
}

export async function extractFrames(
  videoPath: string,
  outDir: string,
  fps: number,
): Promise<string[]> {
  await ensureBinary("ffmpeg");
  await fs.mkdir(outDir, { recursive: true });
  const pattern = path.join(outDir, "frame-%05d.jpg");
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-vf",
    `fps=${fps}`,
    "-q:v",
    "3",
    pattern,
  ]);
  const entries = await fs.readdir(outDir);
  return entries
    .filter((f) => /^frame-\d{5}\.jpg$/.test(f))
    .sort()
    .map((f) => path.join(outDir, f));
}

export async function extractThumbnail(
  videoPath: string,
  outPath: string,
  atSeconds = 1,
): Promise<void> {
  await ensureBinary("ffmpeg");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await execFileAsync("ffmpeg", [
    "-y",
    "-ss",
    String(atSeconds),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    outPath,
  ]);
}
