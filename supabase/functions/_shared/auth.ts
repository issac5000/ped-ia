// @ts-nocheck

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { HttpError, fetchAnonProfile, normalizeCode } from "./anon-children.ts";

function readEnv(key) {
  try {
    return Deno.env.get(key) ?? "";
  } catch (_err) {
    return "";
  }
}

function getSupabaseUrl() {
  return readEnv("SUPABASE_URL") || readEnv("NEXT_PUBLIC_SUPABASE_URL") || "";
}

function getServiceKey() {
  return readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("SUPABASE_SERVICE_KEY") || "";
}

function getAnonKey() {
  return readEnv("SUPABASE_ANON_KEY") || readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") || "";
}

export function extractBearerToken(header) {
  if (typeof header !== "string") return "";
  const match = header.match(/^\s*Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  return header.trim();
}

function isLikelyJwt(token) {
  if (!token) return false;
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

let cachedClient = null;
let cachedClientKey = "";

function getSupabaseAdmin(supaUrl, serviceKey) {
  const cacheKey = `${supaUrl}::${serviceKey}`;
  if (!cachedClient || cachedClientKey !== cacheKey) {
    cachedClient = createClient(supaUrl, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: { Authorization: `Bearer ${serviceKey}` },
      },
    });
    cachedClientKey = cacheKey;
  }
  return cachedClient;
}

export async function resolveUserContext(req, body = {}) {
  const supaUrl = getSupabaseUrl();
  const serviceKey = getServiceKey();
  const anonKey = getAnonKey();

  const authorizationHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const clientAuthHeader = req.headers.get("x-client-authorization") || req.headers.get("X-Client-Authorization") || "";

  const clientToken = extractBearerToken(clientAuthHeader);
  const authToken = extractBearerToken(authorizationHeader);

  let jwt = "";
  if (clientToken && isLikelyJwt(clientToken)) {
    jwt = clientToken;
  } else if (
    authToken &&
    authToken !== serviceKey &&
    authToken !== anonKey &&
    isLikelyJwt(authToken)
  ) {
    jwt = authToken;
  }

  if (jwt) {
    if (!supaUrl || !serviceKey) {
      throw new HttpError(500, "Server misconfigured");
    }
    const supabaseAdmin = getSupabaseAdmin(supaUrl, serviceKey);
    const { data, error } = await supabaseAdmin.auth.getUser(jwt);
    if (error || !data?.user?.id) {
      const status = error?.status ?? 401;
      const message = error?.message || "Unauthorized";
      throw new HttpError(status, message, error);
    }
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    return {
      kind: "jwt",
      jwt,
      userId: String(data.user.id),
      supaUrl,
      serviceKey,
      headers,
      anon: false,
    };
  }

  const rawCode =
    typeof body?.anonCode === "string"
      ? body.anonCode
      : typeof body?.anon_code === "string"
        ? body.anon_code
        : typeof body?.code === "string"
          ? body.code
          : typeof body?.code_unique === "string"
            ? body.code_unique
            : typeof body?.codeUnique === "string"
              ? body.codeUnique
              : "";
  const code = normalizeCode(rawCode);

  if (code) {
    if (!supaUrl || !serviceKey) {
      throw new HttpError(500, "Server misconfigured");
    }
    const profile = await fetchAnonProfile(supaUrl, serviceKey, code);
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    return {
      kind: "code",
      code,
      profile,
      profileId: String(profile?.id ?? ""),
      userId: String(profile?.id ?? ""),
      supaUrl,
      serviceKey,
      headers,
      anon: true,
    };
  }

  return { kind: "anonymous" };
}

