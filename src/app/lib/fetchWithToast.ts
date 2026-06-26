"use client";

import { toast } from "@/app/lib/ui/useToast";

interface ToastFetchOptions {
  /** Toast message shown when the response is not ok. Defaults to "Something went wrong". */
  errorMessage?: string;
  /** Toast message shown when the network call throws (e.g. offline). Defaults to errorMessage. */
  networkErrorMessage?: string;
  /** Suppress the toast entirely (still throws on non-ok). */
  silent?: boolean;
}

/**
 * Thin wrapper around fetch that fires a toast on non-ok responses or
 * network errors. Returns the original Response on success so callers
 * can read JSON / blobs themselves.
 */
export async function fetchWithToast(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: ToastFetchOptions = {},
): Promise<Response> {
  const errorMessage = opts.errorMessage ?? "Something went wrong";
  const networkErrorMessage = opts.networkErrorMessage ?? errorMessage;

  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    if (!opts.silent) toast(networkErrorMessage, "error");
    throw err;
  }

  if (!res.ok) {
    if (!opts.silent) {
      // Try to surface a server-supplied message if available.
      let serverMsg: string | undefined;
      try {
        const cloned = res.clone();
        const ct = cloned.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const body = (await cloned.json().catch(() => null)) as
            | { error?: unknown }
            | null;
          if (body && typeof body.error === "string") serverMsg = body.error;
        }
      } catch {
        // ignore
      }
      toast(serverMsg ?? errorMessage, "error");
    }
  }

  return res;
}
