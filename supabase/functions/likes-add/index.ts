// @ts-nocheck

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { HttpError, supabaseRequest } from "../_shared/anon-children.ts";
import { resolveUserContext, fetchLikeCount } from "../_shared/likes-helpers.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_KEY") ?? "";

if (!supabaseUrl || !serviceKey) {
  console.error("[likes-add] Missing Supabase configuration");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
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
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }
  try {
    const context = await resolveUserContext(req);
    if (context?.error) {
      const status = context.error.status ?? 400;
      return new Response(JSON.stringify(context.error), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
    }
    console.log('[resolveUserContext] likes-add', {
      userId: context.userId,
      mode: context.mode,
      anon: context.anon ?? false,
    });
    const body = await req.json().catch(() => {
      throw new HttpError(400, "Invalid JSON body");
    });
    if (!supabaseUrl || !serviceKey) {
      throw new HttpError(500, "Server misconfigured");
    }
    const rawReplyId = body?.replyId ?? body?.reply_id;
    const replyId = rawReplyId != null ? String(rawReplyId).trim() : "";
    if (!replyId) {
      throw new HttpError(400, "replyId required");
    }
    const payload = { reply_id: replyId, user_id: context.userId };
    await supabaseRequest(
      `${context.supaUrl}/rest/v1/forum_reply_likes`,
      {
        method: "POST",
        headers: { ...context.headers, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(payload),
      },
    );
    const count = await fetchLikeCount(context.supaUrl, context.headers, replyId);
    return jsonResponse({ success: true, data: { count, liked: true } });
  } catch (error) {
    const status = error instanceof HttpError ? error.status || 400 : 500;
    const message = error instanceof HttpError ? error.message : "Server error";
    const details = error instanceof HttpError ? error.details : undefined;
    console.error("[likes-add] error", { status, message, details, error });
    return jsonResponse({ error: message, details }, status);
  }
});
