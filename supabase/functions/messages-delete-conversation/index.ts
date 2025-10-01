// @ts-nocheck

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { HttpError } from "../_shared/anon-children.ts";
import { resolveUserContext } from "../_shared/auth.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_KEY") ?? "";

if (!supabaseUrl || !serviceKey) {
  console.error("[messages-delete-conversation] Missing Supabase configuration");
}

const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    headers: { Authorization: `Bearer ${serviceKey}` },
  },
});

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
    if (context.kind === "anonymous") {
      throw new HttpError(403, "Authentication required");
    }
    if (context.kind !== "jwt" && context.kind !== "code") {
      throw new HttpError(403, "Unsupported context");
    }
    console.log('[resolveUserContext] messages-delete-conversation', {
      kind: context.kind,
      userId: context.userId,
      anon: context.anon ?? false,
    });
    if (!supabaseUrl || !serviceKey) {
      throw new HttpError(500, "Server misconfigured");
    }
    const otherId = body?.otherId != null ? String(body.otherId).trim() : "";
    if (!otherId) {
      throw new HttpError(400, "otherId required");
    }
    const uid = String(context.userId);
    const { error: deleteForward } = await supabaseAdmin
      .from("messages")
      .delete({ returning: "minimal" })
      .match({ sender_id: uid, receiver_id: otherId });
    if (deleteForward) {
      throw new HttpError(500, "Delete failed", deleteForward.message || deleteForward);
    }
    const { error: deleteBackward } = await supabaseAdmin
      .from("messages")
      .delete({ returning: "minimal" })
      .match({ sender_id: otherId, receiver_id: uid });
    if (deleteBackward) {
      throw new HttpError(500, "Delete failed", deleteBackward.message || deleteBackward);
    }
    return jsonResponse({ success: true, data: { ok: true } });
  } catch (error) {
    const status = error instanceof HttpError ? error.status || 400 : 500;
    const message = error instanceof HttpError ? error.message : "Server error";
    const details = error instanceof HttpError ? error.details : error instanceof Error ? error.message : undefined;
    console.error("[messages-delete-conversation] error", { status, message, details, error });
    return jsonResponse({ error: message, details }, status);
  }
});
