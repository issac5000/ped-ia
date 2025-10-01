// @ts-nocheck

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { HttpError, supabaseRequest } from "../_shared/anon-children.ts";
import { resolveUserContext } from "../_shared/auth.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_KEY") ?? "";

if (!supabaseUrl || !serviceKey) {
  console.error("[likes-get] Missing Supabase configuration");
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
    console.log('[resolveUserContext] likes-get', {
      kind: context.kind,
      userId: context.userId ?? null,
      anon: context.anon ?? false,
    });
    const replyIdsRaw = Array.isArray(body?.replyIds)
      ? body.replyIds
      : Array.isArray(body?.reply_ids) ? body.reply_ids : [];
    const replyIds = replyIdsRaw
      .map((value) => (value != null ? String(value).trim() : ""))
      .filter((value) => Boolean(value));
    if (!replyIds.length) {
      throw new HttpError(400, "replyIds required");
    }
    if (replyIds.length > 200) {
      throw new HttpError(400, "Too many replyIds");
    }
    const uniqueIds = Array.from(new Set(replyIds));
    const safeList = uniqueIds.map((id) => `"${id.replace(/"/g, '""')}"`).join(',');
    const params = new URLSearchParams({ select: "reply_id,user_id" });
    params.append("reply_id", `in.(${safeList})`);
    const supaUrl = context.supaUrl ?? supabaseUrl;
    const headers = context.headers ?? { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    const rows = await supabaseRequest(
      `${supaUrl}/rest/v1/forum_reply_likes?${params.toString()}`,
      { headers },
    );
    const likes = Array.isArray(rows) ? rows : [];
    const result: Record<string, { count: number; liked: boolean }> = {};
    uniqueIds.forEach((id) => {
      result[id] = { count: 0, liked: false };
    });
    likes.forEach((row) => {
      const replyId = row?.reply_id != null ? String(row.reply_id) : "";
      if (!replyId || !(replyId in result)) return;
      result[replyId].count += 1;
      if (row?.user_id != null && String(row.user_id) === String(context.userId ?? "")) {
        result[replyId].liked = true;
      }
    });
    return jsonResponse({ success: true, data: result });
  } catch (error) {
    const status = error instanceof HttpError ? error.status || 400 : 500;
    const message = error instanceof HttpError ? error.message : "Server error";
    const details = error instanceof HttpError ? error.details : undefined;
    console.error("[likes-get] error", { status, message, details, error });
    return jsonResponse({ error: message, details }, status);
  }
});
