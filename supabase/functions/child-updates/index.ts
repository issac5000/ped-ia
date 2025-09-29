// @ts-nocheck

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { HttpError, supabaseRequest } from "../_shared/anon-children.ts";
import { resolveUserContext } from "../_shared/likes-helpers.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_KEY") ?? "";

if (!supabaseUrl || !serviceKey) {
  console.error("[child-updates] Missing Supabase configuration");
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

function limitString(value: unknown, max = 600, options: { allowEmpty?: boolean } = {}) {
  const allowEmpty = options.allowEmpty ?? false;
  if (value == null) return allowEmpty ? "" : "";
  const str = typeof value === "string" ? value : String(value);
  const trimmed = str.trim();
  if (!trimmed && !allowEmpty) return "";
  return trimmed.slice(0, max);
}

function optionalString(value: unknown, max = 600) {
  if (value == null) return null;
  const str = typeof value === "string" ? value : String(value);
  const trimmed = str.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
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
    console.log('[resolveUserContext] child-updates', {
      userId: context.userId,
      mode: context.mode,
      anon: context.anon ?? false,
    });
    const body = await req.json().catch(() => {
      throw new HttpError(400, "Invalid JSON body");
    });
    const supaUrl = context.supaUrl || supabaseUrl;
    const serviceHeaders = context.headers || { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    if (!supaUrl || !serviceHeaders?.Authorization) {
      throw new HttpError(500, "Server misconfigured");
    }
    const childId = limitString(body?.childId ?? body?.child_id ?? "", 128);
    if (!childId) {
      throw new HttpError(400, "childId required");
    }
    const updateType = limitString(body?.updateType ?? body?.type ?? "update", 64, { allowEmpty: true }) || "update";
    const updateContent = typeof body?.updateContent === "string" ? body.updateContent : "";
    if (!updateContent) {
      throw new HttpError(400, "updateContent required");
    }
    const aiSummary = optionalString(body?.aiSummary ?? body?.ai_summary, 500);
    const aiCommentaire = optionalString(body?.aiCommentaire ?? body?.ai_commentaire, 2000);
    const userId = context.userId;
    const childRows = await supabaseRequest(
      `${supaUrl}/rest/v1/children?select=id,user_id&limit=1&id=eq.${encodeURIComponent(childId)}`,
      { headers: serviceHeaders },
    );
    const child = Array.isArray(childRows) ? childRows[0] : childRows;
    if (!child || !child.id) {
      throw new HttpError(404, "Child not found");
    }
    if (String(child.user_id) !== String(userId)) {
      throw new HttpError(403, "Forbidden");
    }
    const insertPayload: Record<string, unknown> = {
      child_id: childId,
      update_type: updateType || "update",
      update_content: updateContent,
    };
    if (aiSummary) insertPayload.ai_summary = aiSummary;
    if (aiCommentaire) insertPayload.ai_commentaire = aiCommentaire;
    const inserted = await supabaseRequest(
      `${supaUrl}/rest/v1/child_updates`,
      {
        method: "POST",
        headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify([insertPayload]),
      },
    );
    const row = Array.isArray(inserted) ? inserted[0] : inserted || null;
    return jsonResponse({ success: true, data: { update: row } });
  } catch (error) {
    const status = error instanceof HttpError ? error.status || 400 : 500;
    const message = error instanceof HttpError ? error.message : "Unable to log child update";
    const details = error instanceof HttpError ? error.details : error instanceof Error ? error.message : undefined;
    console.error("[child-updates] error", { status, message, details, error });
    return jsonResponse({ error: message, details }, status);
  }
});
