import "./spectrum-alert-worker-env";
import { createServer } from "node:http";
import { Spectrum, type Space } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { directChat } from "@photon-ai/advanced-imessage";
import type { AnalysisEvent } from "@/app/lib/types";
import { buildRichAlertBody } from "@/app/lib/alertMessageText";
import {
  findAlertThreadForReply,
  upsertAlertThread,
  updateAlertThread,
  type AlertThreadRow,
} from "@/app/lib/alertThreads";
import { generateNurseReply } from "@/app/lib/nurseReply";

function normalizePhone(s: string): string {
  return s.replace(/\D/g, "");
}

function phonesMatch(a: string, b: string): boolean {
  return normalizePhone(a) === normalizePhone(b);
}

type SpectrumApp = Awaited<ReturnType<typeof Spectrum>>;

async function createSpectrumApp(): Promise<SpectrumApp> {
  const local = process.env.PHOTON_IMESSAGE_LOCAL === "true";
  if (local) {
    return Spectrum({
      providers: [imessage.config({ local: true })],
    });
  }
  const projectId = process.env.PHOTON_PROJECT_ID;
  const projectSecret = process.env.PHOTON_PROJECT_SECRET;
  if (!projectId || !projectSecret) {
    throw new Error(
      "PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET are required unless PHOTON_IMESSAGE_LOCAL=true",
    );
  }
  return Spectrum({
    projectId,
    projectSecret,
    providers: [imessage.config()],
  });
}

const isLocalMode = (): boolean => process.env.PHOTON_IMESSAGE_LOCAL === "true";

/**
 * Local-mode SDK accessor. In local mode the iMessage client is an IMessageSDK
 * instance stored on the app internals; it can send to a phone number directly
 * via AppleScript ("buddy" method), which Spectrum's space.resolve() refuses to
 * do. We use it to send the initial alert (Spectrum local mode only allows
 * replying to existing threads, not creating them).
 */
interface LocalImessageClient {
  send: (req: { to: string; text: string }) => Promise<{ chatId: string }>;
}

function getLocalClient(app: SpectrumApp): LocalImessageClient | null {
  const internal = (app as unknown as {
    __internal?: { platforms?: Map<string, { client?: unknown }> };
  }).__internal;
  const client = internal?.platforms?.get("iMessage")?.client as
    | LocalImessageClient
    | undefined;
  return client && typeof client.send === "function" ? client : null;
}

function readJsonBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function checkAuth(req: import("node:http").IncomingMessage): boolean {
  const secret = process.env.SPECTRUM_ALERT_WORKER_SECRET;
  if (!secret) return true;
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return false;
  return h.slice(7) === secret;
}

async function handleSendAlert(
  app: SpectrumApp,
  event: AnalysisEvent,
): Promise<{ ok: boolean; error?: string; skipped?: string }> {
  if (event.severity !== "critical" && event.severity !== "urgent") {
    return { ok: false, error: "severity_not_alertable" };
  }

  const nurseRaw = process.env.NURSE_PHONE?.trim();
  if (!nurseRaw) {
    return { ok: false, error: "NURSE_PHONE missing" };
  }

  const body = buildRichAlertBody(event);
  let spaceId: string;

  if (isLocalMode()) {
    // Local mode: Spectrum can't create a space, so send directly via the SDK.
    const local = getLocalClient(app);
    if (!local) {
      return { ok: false, error: "local iMessage client unavailable" };
    }
    const result = await local.send({ to: nurseRaw, text: body });
    // Match the inbound message space.id (the SDK-reported chatId) so replies
    // resolve to this thread; fall back to the deterministic direct-chat guid.
    spaceId = result?.chatId ?? directChat(nurseRaw);
  } else {
    const im = imessage(app);
    const user = await im.user(nurseRaw);
    const space = await im.space(user);
    await space.send(body);
    spaceId = space.id;
  }

  const row: AlertThreadRow = {
    id: event.id,
    spaceId,
    nursePhone: nurseRaw,
    eventSnapshot: { ...event },
    repliesRemaining: 2,
    updatedAt: new Date().toISOString(),
    notifiedClosed: false,
  };
  await upsertAlertThread(row);
  return { ok: true };
}

async function handleInboundMessage(
  space: Space,
  message: {
    content: { type: string; text?: string };
    sender: { id: string };
    platform: string;
  },
): Promise<void> {
  const nurseRaw = process.env.NURSE_PHONE?.trim();
  if (!nurseRaw) return;
  if (!phonesMatch(message.sender.id, nurseRaw)) return;
  if (message.content.type !== "text" || !message.content.text?.trim()) return;

  const thread = await findAlertThreadForReply(space.id, message.sender.id);
  if (!thread) {
    return;
  }

  if (thread.repliesRemaining <= 0) {
    if (!thread.notifiedClosed) {
      await space.send(
        "Automated replies for this alert are closed (2 follow-ups used). Escalate in person, by phone, or per facility protocol.",
      );
      await updateAlertThread(thread.id, { notifiedClosed: true });
    }
    return;
  }

  const question = message.content.text.trim();
  let reply: string;
  try {
    reply = await generateNurseReply(thread.eventSnapshot, question);
  } catch (err) {
    console.error("[spectrum-alert-worker] nurse reply failed:", err);
    reply =
      "Could not generate a reply. Escalate to a clinician or EMS per protocol.";
  }

  const nextRemaining = thread.repliesRemaining - 1;
  await space.send(reply);
  await updateAlertThread(thread.id, { repliesRemaining: nextRemaining });
}

async function main(): Promise<void> {
  const app = await createSpectrumApp();
  const port = Number(process.env.SPECTRUM_ALERT_WORKER_PORT ?? "39847");

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method !== "POST" || req.url !== "/send-alert") {
      res.writeHead(req.method === "POST" ? 404 : 405);
      res.end();
      return;
    }

    if (!checkAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return;
    }

    let raw: string;
    try {
      raw = await readJsonBody(req);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }

    let event: AnalysisEvent;
    try {
      event = JSON.parse(raw) as AnalysisEvent;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
      return;
    }

    try {
      const result = await handleSendAlert(app, event);
      res.writeHead(result.ok ? 200 : 400, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error("[spectrum-alert-worker] send-alert error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      console.log(
        `[spectrum-alert-worker] listening on http://127.0.0.1:${port} (POST /send-alert, GET /health)`,
      );
      resolve();
    });
  });

  (async () => {
    try {
      for await (const [space, message] of app.messages) {
        try {
          await handleInboundMessage(space, message);
        } catch (err) {
          console.error("[spectrum-alert-worker] message handler:", err);
        }
      }
    } catch (err) {
      console.error("[spectrum-alert-worker] messages loop ended:", err);
    }
  })();

  const shutdown = async () => {
    console.log("[spectrum-alert-worker] shutting down…");
    server.close();
    await app.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[spectrum-alert-worker] fatal:", err);
  process.exit(1);
});
