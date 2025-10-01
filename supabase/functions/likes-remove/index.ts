// @ts-nocheck

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { HttpError, supabaseRequest } from "../_shared/anon-children.ts";
import { resolveUserContext } from "../_shared/auth.ts";
import { fetchLikeCount } from "../_shared/likes-helpers.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_KEY") ?? "";

if (!supabaseUrl || !serviceKey) {
  console.error("[likes-remove] Missing Supabase configuration");
}

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  try {
    let bodyParseError: unknown = null;
    const body = req.method === "POST"
      ? await req.json().catch((err) => {
          bodyParseError = err;
          return {};
        })
      : {};
    const context = await resolveUserContext(req, body);
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405);
    }
    if (bodyParseError) {
      throw new HttpError(400, "Invalid JSON body", bodyParseError instanceof Error ? bodyParseError.message : bodyParseError);
    }
    if (!supabaseUrl || !serviceKey) {
      throw new HttpError(500, "Server misconfigured");
    }
    if (context.kind === "anonymous") {
      throw new HttpError(403, "Authentication required");
    }
    if (context.kind !== "jwt" && context.kind !== "code") {
      throw new HttpError(403, "Unsupported context");
    }
    console.log('[resolveUserContext] likes-remove', {
      kind: context.kind,
      userId: context.userId,
      anon: context.anon ?? false,
    });
    const rawReplyId = body?.replyId ?? body?.reply_id;
    const replyId = rawReplyId != null ? String(rawReplyId).trim() : "";
    if (!replyId) {
      throw new HttpError(400, "replyId required");
    }
    const params = new URLSearchParams();
    params.append("reply_id", `eq.${replyId}`);
    params.append("user_id", `eq.${String(context.userId ?? "")}`);
    const supaUrl = context.supaUrl ?? supabaseUrl;
    const headers = context.headers ?? { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    await supabaseRequest(
      `${supaUrl}/rest/v1/forum_reply_likes?${params.toString()}`,
      { method: "DELETE", headers },
    );
    const count = await fetchLikeCount(supaUrl, headers, replyId);
    return jsonResponse({ success: true, data: { count, liked: false } });
  } catch (error) {
    const status = error instanceof HttpError ? error.status || 400 : 500;
    const message = error instanceof HttpError ? error.message : "Server error";
    const details = error instanceof HttpError ? error.details : undefined;
    console.error("[likes-remove] error", { status, message, details, error });
    return jsonResponse({ error: message, details }, status);
  }
});
