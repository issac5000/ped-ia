import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
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
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }
  try {
    const url = Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    return jsonResponse({ success: true, data: { url, anonKey } });
  } catch (error) {
    console.error("[env] unexpected error", error);
    return jsonResponse({ error: "Unable to resolve Supabase env" }, 500);
  }
});
