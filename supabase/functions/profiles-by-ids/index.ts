// @ts-nocheck

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { HttpError } from "../_shared/anon-children.ts";
import { resolveUserContext } from "../_shared/likes-helpers.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_KEY") ?? "";

if (!supabaseUrl || !serviceKey) {
  console.error("[profiles-by-ids] Missing Supabase configuration");
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
    console.log('[resolveUserContext] profiles-by-ids', {
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
    const idsRaw = Array.isArray(body?.ids) ? body.ids : [];
    const ids = idsRaw.map((value) => String(value)).filter((value) => value.trim().length > 0);
    if (!ids.length) {
      throw new HttpError(400, "ids required");
    }
    if (ids.length > 200) {
      throw new HttpError(400, "too many ids");
    }
    let hasShowColumn = true;
    const { data: profilesData, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id,full_name,show_children_count")
      .in("id", ids);
    let profiles = profilesData ?? [];
    if (profilesError) {
      hasShowColumn = false;
      const fallback = await supabaseAdmin
        .from("profiles")
        .select("id,full_name")
        .in("id", ids);
      if (fallback.error) {
        throw new HttpError(fallback.error.status ?? 500, "Fetch profiles failed", fallback.error.message || fallback.error);
      }
      profiles = fallback.data ?? [];
    }
    const idList = Array.isArray(profiles) ? profiles.map((row) => row?.id).filter((id) => id != null) : [];
    const idsForCounts = idList.map((id) => String(id));
    const childCounts = new Map<string, number>();
    if (idsForCounts.length) {
      const { data: childRows, error: childError } = await supabaseAdmin
        .from("children")
        .select("user_id")
        .in("user_id", idsForCounts);
      if (childError) {
        throw new HttpError(childError.status ?? 500, "Fetch children failed", childError.message || childError);
      }
      (childRows ?? []).forEach((row) => {
        const key = row?.user_id != null ? String(row.user_id) : "";
        if (!key) return;
        childCounts.set(key, (childCounts.get(key) ?? 0) + 1);
      });
    }
    const enriched = (profiles ?? []).map((row) => {
      const id = row?.id != null ? String(row.id) : "";
      const count = childCounts.get(id) ?? 0;
      const rowAny = (row ?? {}) as Record<string, unknown>;
      const showFlag = hasShowColumn ? Boolean(rowAny.show_children_count) : false;
      return {
        ...rowAny,
        id,
        child_count: count,
        show_children_count: showFlag,
      };
    });
    return jsonResponse({ success: true, data: { profiles: enriched } });
  } catch (error) {
    const status = error instanceof HttpError ? error.status || 400 : 500;
    const message = error instanceof HttpError ? error.message : "Server error";
    const details = error instanceof HttpError ? error.details : error instanceof Error ? error.message : undefined;
    console.error("[profiles-by-ids] error", { status, message, details, error });
    const payload: Record<string, unknown> = { error: message };
    if (details) payload.details = details;
    return jsonResponse(payload, status);
  }
});
