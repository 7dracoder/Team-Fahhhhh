export interface BusEvent {
  type: string;
  data?: unknown;
}

export interface Subscriber {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
}

const globalAny = globalThis as unknown as {
  __sessionBus?: Map<string, Set<Subscriber>>;
};

const channels: Map<string, Set<Subscriber>> =
  globalAny.__sessionBus ?? (globalAny.__sessionBus = new Map());

export function subscribe(sessionId: string, sub: Subscriber): () => void {
  let set = channels.get(sessionId);
  if (!set) {
    set = new Set();
    channels.set(sessionId, set);
  }
  set.add(sub);
  return () => {
    const current = channels.get(sessionId);
    if (!current) return;
    current.delete(sub);
    if (current.size === 0) channels.delete(sessionId);
  };
}

export function publish(sessionId: string, payload: BusEvent): void {
  const set = channels.get(sessionId);
  if (!set || set.size === 0) return;
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const sub of set) {
    try {
      sub.controller.enqueue(sub.encoder.encode(line));
    } catch (err) {
      console.warn(`[sessionBus] dead subscriber for ${sessionId}:`, err);
      try {
        set.delete(sub);
      } catch {
        /* ignore */
      }
    }
  }
}

export function subscriberCount(sessionId: string): number {
  return channels.get(sessionId)?.size ?? 0;
}
