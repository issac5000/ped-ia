// @ts-nocheck

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { HttpError } from "../_shared/anon-children.ts";
import { resolveUserContext } from "../_shared/auth.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_KEY") ?? "";

if (!supabaseUrl || !serviceKey) {
  console.error("[profiles-create-anon] Missing Supabase configuration");
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

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_DIGITS = "23456789";
const MAX_CREATE_ATTEMPTS = 5;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function generateAnonCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 12; i += 1) {
    const alphabet = i % 2 === 0 ? CODE_LETTERS : CODE_DIGITS;
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function shouldRetryDuplicate(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  if (error.code === "23505") return true;
  if (typeof error.message === "string" && /code_unique/i.test(error.message)) return true;
  return false;
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
  const ctx = await resolveUserContext(req, body);
  console.log("[profiles-create-anon] request", {
    method: req.method,
    hasBody: Object.keys(body).length > 0,
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
    if (!supabaseUrl || !serviceKey) {
      throw new HttpError(500, "Server misconfigured");
    }
    const fullNameRaw = typeof body?.fullName === "string" ? body.fullName.trim() : "";
    const fullName = fullNameRaw ? fullNameRaw.slice(0, 120) : "";
    let lastError: unknown = null;

    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
      const insertPayload: Record<string, unknown> = {
        id: crypto.randomUUID(),
        code_unique: generateAnonCode(),
      };
      if (fullName) insertPayload.full_name = fullName;

      const response = await supabaseAdmin
        .from("profiles")
        .insert(insertPayload)
        .select("id,code_unique,full_name,user_id")
        .single();

      if (!response.error && response.data) {
        const profile = {
          id: response.data.id,
          code_unique: response.data.code_unique,
          full_name: response.data.full_name ?? fullName ?? "",
          user_id: response.data.user_id ?? null,
        };
        return jsonResponse({ success: true, data: { profile } }, 200);
      }

      if (shouldRetryDuplicate(response.error)) {
        lastError = response.error;
        continue;
      }

      throw new HttpError(
        response.error?.status ?? 500,
        "Create failed",
        response.error?.message || response.error,
      );
    }

    throw new HttpError(500, "Create failed", lastError);
  } catch (error) {
    const status = error instanceof HttpError ? error.status || 400 : 500;
    const message = error instanceof HttpError ? error.message : "Server error";
    const details = error instanceof HttpError ? error.details : error instanceof Error ? error.message : undefined;
    console.error("[profiles-create-anon] error", { status, message, error: String(details ?? message) });
    const payload: Record<string, unknown> = { success: false, error: message };
    if (details) payload.details = details;
    return jsonResponse(payload, status);
  }
});
