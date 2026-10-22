/** HTTP helpers: CORS, JSON responses and safe error reporting for Edge Functions. */

/** Error whose message is safe to show to the client. */
export class AppError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

const GENERIC_ERROR_MESSAGE = "Đã xảy ra lỗi máy chủ. Vui lòng thử lại sau.";
const HTTP_INTERNAL_ERROR = 500;

/**
 * CORS headers. Set the ALLOWED_ORIGINS secret (comma-separated origins) to restrict
 * browsers to the deployed site; without it any origin is allowed.
 */
export function corsHeaders(request: Request): Record<string, string> {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = request.headers.get("Origin") ?? "";
  const allowOrigin = allowed.length === 0 ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin"
  };
}

export function jsonResponse(request: Request, value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" }
  });
}

/**
 * Wraps a handler: answers CORS preflight, returns AppError messages as-is and hides every
 * other error behind a generic message (details go to the server log only).
 */
export function serveJson(
  handler: (request: Request) => Promise<unknown>
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === "OPTIONS") return jsonResponse(request, { ok: true });
    try {
      return jsonResponse(request, await handler(request));
    } catch (error) {
      if (error instanceof AppError) {
        return jsonResponse(request, { error: error.message }, error.status);
      }
      console.error("Unhandled Edge Function error:", error);
      return jsonResponse(request, { error: GENERIC_ERROR_MESSAGE }, HTTP_INTERNAL_ERROR);
    }
  };
}

/** Reads a JSON object body; anything else is a 400. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("Dữ liệu gửi lên không hợp lệ.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("Dữ liệu gửi lên không hợp lệ.");
  }
  return body as Record<string, unknown>;
}
