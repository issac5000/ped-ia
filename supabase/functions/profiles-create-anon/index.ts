// @ts-nocheck

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { HttpError } from "../_shared/anon-children.ts";
import { resolveUserContext } from "../_shared/likes-helpers.ts";

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
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
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
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }
  try {
    let context: Record<string, unknown> | null = null;
    try {
      const candidate = await resolveUserContext(req);
      if (candidate?.error) {
        const msg = String(candidate.error.message ?? '');
        if (/code or token required/i.test(msg)) {
          context = null;
        } else {
          const status = candidate.error.status ?? 400;
          return new Response(JSON.stringify(candidate.error), {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
          });
        }
      } else {
        context = candidate;
      }
    } catch (err) {
      console.error('[profiles-create-anon] resolveUserContext failed', err);
      context = null;
    }

    console.log('[resolveUserContext] profiles-create-anon', {
      userId: context?.userId ?? null,
      mode: context?.mode ?? 'public',
      anon: context?.anon ?? false,
    });
    const body = await req.json().catch(() => {
      throw new HttpError(400, "Invalid JSON body");
    });
    if (!supabaseUrl || !serviceKey) {
      throw new HttpError(500, "Server misconfigured");
    }
    const fullNameRaw = typeof body?.fullName === "string" ? body.fullName.trim() : "";
    const fullName = fullNameRaw ? fullNameRaw.slice(0, 120) : "";
    let lastError: unknown = null;

    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
      const code = generateAnonCode();
      const { data: existing, error: existingErr } = await supabaseAdmin
        .from('profiles')
        .select('id,code_unique,full_name,user_id')
        .eq('code_unique', code)
        .maybeSingle();
      if (existingErr && existingErr.code !== 'PGRST116') {
        throw new HttpError(existingErr.status ?? 500, 'Lookup failed', existingErr.message || existingErr);
      }
      if (existing) {
        console.log(`[Anon Debug] Profile reused for code ${code}`, { id: existing.id });
        const profile = {
          id: existing.id,
          code_unique: existing.code_unique,
          full_name: existing.full_name ?? fullName ?? '',
          user_id: existing.user_id ?? null,
        };
        return jsonResponse({ success: true, data: { profile } });
      }

      const insertPayload: Record<string, unknown> = {
        id: crypto.randomUUID(),
        code_unique: code,
      };
      if (fullName) insertPayload.full_name = fullName;

      const response = await supabaseAdmin
        .from('profiles')
        .insert(insertPayload)
        .select('id,code_unique,full_name,user_id')
        .single();

      if (!response.error && response.data) {
        console.log('[Anon Debug] Profile created', { id: response.data.id, code: response.data.code_unique });
        const profile = {
          id: response.data.id,
          code_unique: response.data.code_unique,
          full_name: response.data.full_name ?? fullName ?? '',
          user_id: response.data.user_id ?? null,
        };
        return jsonResponse({ success: true, data: { profile } });
      }

      if (shouldRetryDuplicate(response.error)) {
        lastError = response.error;
        continue;
      }

      throw new HttpError(
        response.error?.status ?? 500,
        'Create failed',
        response.error?.message || response.error,
      );
    }

    throw new HttpError(500, 'Create failed', lastError);
  } catch (error) {
    const status = error instanceof HttpError ? error.status || 400 : 500;
    const message = error instanceof HttpError ? error.message : "Server error";
    const details = error instanceof HttpError ? error.details : error instanceof Error ? error.message : undefined;
    console.error("[profiles-create-anon] error", { status, message, details, error });
    const payload: Record<string, unknown> = { error: message };
    if (details) payload.details = details;
    return jsonResponse(payload, status);
  }
});
