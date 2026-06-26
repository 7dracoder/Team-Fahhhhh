import { readTable } from "@/app/lib/storage";
import { subscribe, type Subscriber } from "@/app/lib/sessionBus";
import type { LiveSession } from "@/app/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const HEARTBEAT_INTERVAL_MS = 15_000;

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;

  const sessions = await readTable<LiveSession>("sessions");
  const session = sessions.find((s) => s.id === id);
  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sub: Subscriber = { controller, encoder };
      unsubscribe = subscribe(id, sub);

      try {
        controller.enqueue(encoder.encode(":ok\n\n"));
      } catch {
        /* ignore */
      }

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_INTERVAL_MS);

      const onAbort = () => cleanup();
      if (req.signal) {
        if (req.signal.aborted) cleanup();
        else req.signal.addEventListener("abort", onAbort, { once: true });
      }
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    if (closed) return;
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (unsubscribe) {
      try {
        unsubscribe();
      } catch {
        /* ignore */
      }
      unsubscribe = null;
    }
  }

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
