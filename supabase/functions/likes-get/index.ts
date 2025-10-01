// @ts-nocheck

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import {
  HttpError,
  fetchAnonProfile,
  normalizeCode,
  supabaseRequest,
} from "../_shared/anon-children.ts";
import { resolveUserContext, type UserContext } from "../_shared/auth.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? "";

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

async function fetchUserIdFromJwt(jwt: string): Promise<string> {
  if (!supabaseUrl || !serviceKey) {
    throw new HttpError(500, "Server misconfigured");
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${jwt}`,
  };
  const apiKey = anonKey || serviceKey;
  if (apiKey) headers.apikey = apiKey;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  if (!response.ok) {
    const status = response.status === 401 ? 401 : 400;
    throw new HttpError(status, "Invalid token");
  }
  const data = await response.json().catch(() => null);
  const userId = data?.id ?? data?.user?.id ?? "";
  const trimmed = typeof userId === "string" ? userId.trim() : "";
  if (!trimmed) {
    throw new HttpError(401, "Invalid token");
  }
  return trimmed;
}

async function resolveLikeContext(ctx: UserContext) {
  if (!supabaseUrl || !serviceKey) {
    throw new HttpError(500, "Server misconfigured");
  }
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };
  if (ctx.kind === "jwt") {
    const userId = await fetchUserIdFromJwt(ctx.jwt);
    return { supaUrl: supabaseUrl, headers, userId };
  }
  if (ctx.kind === "code") {
    const code = normalizeCode(ctx.code);
    if (!code) {
      throw new HttpError(400, "code required");
    }
    const profile = await fetchAnonProfile(supabaseUrl, serviceKey, code);
    const profileId = profile?.id != null ? String(profile.id).trim() : "";
    if (!profileId) {
      throw new HttpError(404, "Profile not found");
    }
    return { supaUrl: supabaseUrl, headers, userId: profileId };
  }
  throw new HttpError(400, "code or token required");
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
  const body = rawBody && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};
  const hasValidBody = !parseError && (req.method !== "POST" || typeof rawBody === "object");
  const hasBody = Object.keys(body).length > 0;
  const ctx = await resolveUserContext(req, body);
  console.log("[likes-get] request", {
    method: req.method,
    hasBody,
    ctxKind: ctx.kind,
    hasCode: ctx.kind === "code",
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
    const context = await resolveLikeContext(ctx);
    const replyIdsRaw = Array.isArray(body?.replyIds)
      ? body.replyIds
      : Array.isArray(body?.reply_ids)
        ? body.reply_ids
        : [];
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
    const rows = await supabaseRequest(
      `${context.supaUrl}/rest/v1/forum_reply_likes?${params.toString()}`,
      { headers: context.headers },
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
      if (row?.user_id != null && String(row.user_id) === context.userId) {
        result[replyId].liked = true;
      }
    });
    return jsonResponse({ success: true, data: result });
  } catch (error) {
    const status = error instanceof HttpError ? error.status || 400 : 500;
    const message = error instanceof HttpError ? error.message : "Server error";
    const details = error instanceof HttpError ? error.details : undefined;
    console.error("[likes-get] error", { status, message, hasCode: ctx.kind === "code", error: String(details ?? message) });
    return jsonResponse({ error: message, details }, status);
  }
});
