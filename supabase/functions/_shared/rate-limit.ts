/** Per-client rate limiting backed by public.consume_rate_limit (service role only). */
import { AppError } from "./http.ts";
import type { SupabaseClient } from "./supabase.ts";

const HTTP_TOO_MANY_REQUESTS = 429;
const BUCKET_HASH_LENGTH = 32;

/**
 * Requests allowed per window, per client address and action. Limits are generous because
 * a whole classroom may share one public IP address.
 */
export const RATE_LIMITS = {
  check: { limit: 600, windowSeconds: 60 },
  review: { limit: 120, windowSeconds: 60 },
  start: { limit: 120, windowSeconds: 60 },
  submit: { limit: 120, windowSeconds: 60 }
} as const;

export type RateLimitedAction = keyof typeof RATE_LIMITS;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientAddress(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/** Throws AppError(429) when the caller exceeded the limit for this action. */
export async function enforceRateLimit(
  admin: SupabaseClient,
  request: Request,
  action: RateLimitedAction
): Promise<void> {
  const { limit, windowSeconds } = RATE_LIMITS[action];
  const addressHash = (await sha256Hex(clientAddress(request))).slice(0, BUCKET_HASH_LENGTH);
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_bucket: `${action}:${addressHash}`,
    p_limit: limit,
    p_window_seconds: windowSeconds
  });
  if (error) throw new Error(`Rate limiter unavailable: ${error.message}`);
  if (data !== true) {
    throw new AppError(
      "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.",
      HTTP_TOO_MANY_REQUESTS
    );
  }
}
