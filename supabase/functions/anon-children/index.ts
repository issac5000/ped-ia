import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { HttpError } from "../_shared/anon-children.ts";
import { processAnonChildrenRequest } from "../_shared/anon-children.ts";
import { resolveUserContext } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Client-Authorization",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function formatResult(status: number, body: Record<string, unknown> | null) {
  const safeBody = body ?? {};
  if (status >= 200 && status < 400) {
    return jsonResponse({ success: true, data: safeBody }, status);
  }
  const bodyAny = safeBody as { error?: unknown; details?: unknown };
  const errorMessage = typeof bodyAny.error === "string" ? bodyAny.error : "Request failed";
  const payload: Record<string, unknown> = { error: errorMessage };
  if (bodyAny.details != null) payload.details = bodyAny.details;
  return jsonResponse(payload, status);
}

serve(async (req) => {
  let parseError = false;
  const rawBody =
    req.method === "POST"
      ? await req.json().catch(() => {
          parseError = true;
          return {};
        })
      : {};
  const baseBody = rawBody && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};
  const hasValidBody = !parseError && (req.method !== "POST" || typeof rawBody === "object");
  const ctx = await resolveUserContext(req, baseBody);
  const payload: Record<string, unknown> = { ...baseBody };
  if (ctx.kind === "code" && typeof payload.code !== "string" && typeof payload.anonCode !== "string") {
    payload.code = ctx.code;
  }
  console.log("[anon-children] request", {
    method: req.method,
    action: typeof payload.action === "string" ? payload.action : null,
    ctxKind: ctx.kind,
    hasCode: typeof payload.code === "string",
  });
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }
  try {
    if (!hasValidBody) {
      throw new HttpError(400, "Invalid JSON body");
    }
    const result = await processAnonChildrenRequest(payload ?? {});
    return formatResult(result?.status ?? 200, (result?.body as Record<string, unknown>) ?? {});
  } catch (error) {
    const status = error instanceof HttpError ? error.status || 400 : 500;
    const message = error instanceof HttpError ? error.message : "Server error";
    const details = error instanceof HttpError ? error.details : error instanceof Error ? error.message : undefined;
    console.error("[anon-children] error", { status, message, hasCode: ctx.kind === "code", error: String(details ?? message) });
    const response: Record<string, unknown> = { error: message };
    if (details) response.details = details;
    return jsonResponse(response, status);
  }
});
