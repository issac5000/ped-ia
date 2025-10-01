import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { HttpError } from "../_shared/anon-children.ts";
import { processAnonMessagesRequest } from "../_shared/anon-messages.ts";
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
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  try {
    let bodyParseError: unknown = null;
    const payload = req.method === "POST"
      ? await req.json().catch((err) => {
          bodyParseError = err;
          return {};
        })
      : {};
    const context = await resolveUserContext(req, payload);
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405);
    }
    if (bodyParseError) {
      throw new HttpError(400, "Invalid JSON body", bodyParseError instanceof Error ? bodyParseError.message : bodyParseError);
    }
    if (context.kind === "anonymous") {
      throw new HttpError(403, "code required");
    }
    if (context.kind !== "code") {
      throw new HttpError(403, "anonymous profile required");
    }
    const normalizedPayload = { ...payload, code: context.code, anonCode: context.code };
    const result = await processAnonMessagesRequest(normalizedPayload ?? {});
    return formatResult(result?.status ?? 200, (result?.body as Record<string, unknown>) ?? {});
  } catch (error) {
    const status = error instanceof HttpError ? error.status || 400 : 500;
    const message = error instanceof HttpError ? error.message : "Server error";
    const details = error instanceof HttpError ? error.details : error instanceof Error ? error.message : undefined;
    console.error("[anon-messages] error", { status, message, details, error });
    const payload: Record<string, unknown> = { error: message };
    if (details) payload.details = details;
    return jsonResponse(payload, status);
  }
});
