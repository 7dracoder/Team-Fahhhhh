/**
 * Demo readiness check.
 *
 * Verifies the things that are easy to forget right before a hackathon
 * demo: API keys, ffmpeg/ffprobe on PATH, the demo sample files, and
 * required storage directories. Prints a green check or red X per item
 * and exits with code 1 if any check fails.
 *
 * Run with: npm run doctor (uses tsx to execute this TypeScript file).
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

interface CheckResult {
  label: string;
  ok: boolean;
  detail?: string;
}

function pass(label: string, detail?: string): CheckResult {
  return { label, ok: true, detail };
}

function fail(label: string, detail?: string): CheckResult {
  return { label, ok: false, detail };
}

async function checkEnv(name: string): Promise<CheckResult> {
  // Best-effort: load .env.local so people who only set keys there
  // don't get a false negative. We don't bring in a dependency for this.
  const root = process.cwd();
  for (const file of [".env.local", ".env"]) {
    try {
      const raw = await fs.readFile(path.join(root, file), "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        const [, key, valueRaw] = m;
        if (process.env[key] !== undefined) continue;
        const value = valueRaw.replace(/^['"]|['"]$/g, "");
        process.env[key] = value;
      }
    } catch {
      // file may not exist; that's fine
    }
  }

  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return fail(`${name} is set`, "missing or empty");
  }
  return pass(`${name} is set`, `${value.length} chars`);
}

async function checkBinary(bin: string): Promise<CheckResult> {
  try {
    const { stdout } = await execFileP(bin, ["-version"]);
    const firstLine = stdout.split(/\r?\n/)[0]?.trim();
    return pass(`${bin} on PATH`, firstLine);
  } catch (err) {
    return fail(`${bin} on PATH`, err instanceof Error ? err.message : String(err));
  }
}

async function checkFile(label: string, p: string): Promise<CheckResult> {
  try {
    const stat = await fs.stat(p);
    if (!stat.isFile()) return fail(label, `${p} is not a file`);
    return pass(label, `${(stat.size / 1024 / 1024).toFixed(2)} MB`);
  } catch {
    return fail(label, `not found at ${p}`);
  }
}

async function checkDir(label: string, p: string): Promise<CheckResult> {
  try {
    const stat = await fs.stat(p);
    if (!stat.isDirectory()) return fail(label, `${p} exists but is not a directory`);
    return pass(label, p);
  } catch {
    // Try to create it; missing storage dirs are fine to create on demand.
    try {
      await fs.mkdir(p, { recursive: true });
      return pass(label, `${p} (created)`);
    } catch (err) {
      return fail(label, `could not create ${p}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function render(results: CheckResult[]): boolean {
  console.log("");
  console.log("Demo readiness check");
  console.log("--------------------");
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    const mark = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const detail = r.detail ? ` ${DIM}— ${r.detail}${RESET}` : "";
    console.log(`  ${mark} ${r.label}${detail}`);
  }
  console.log("");
  console.log(
    allOk
      ? `${GREEN}All checks passed. You're good to go.${RESET}`
      : `${RED}One or more checks failed. Fix the items above before demoing.${RESET}`,
  );
  console.log("");
  return allOk;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const samplesDir = path.join(root, "storage", "samples");

  const results: CheckResult[] = [];
  results.push(await checkEnv("ANTHROPIC_API_KEY"));
  results.push(await checkBinary("ffmpeg"));
  results.push(await checkBinary("ffprobe"));
  results.push(await checkFile("storage/samples/demo.mp4 exists", path.join(samplesDir, "demo.mp4")));
  results.push(
    await checkFile(
      "storage/samples/demo-events.json exists",
      path.join(samplesDir, "demo-events.json"),
    ),
  );
  results.push(await checkDir("storage/videos directory", path.join(root, "storage", "videos")));
  results.push(
    await checkDir("storage/thumbnails directory", path.join(root, "storage", "thumbnails")),
  );
  results.push(await checkDir("storage/alerts directory", path.join(root, "storage", "alerts")));
  results.push(await checkDir("storage/db directory", path.join(root, "storage", "db")));

  const ok = render(results);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`${RED}doctor crashed:${RESET}`, err);
  process.exit(1);
});
