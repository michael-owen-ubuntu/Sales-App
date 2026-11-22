import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const endpoint = url && URL.canParse(url) ? new URL(url) : null;
const validEndpoint = endpoint && !endpoint.username && !endpoint.password && (
  endpoint.protocol === "https:" ||
  endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
);

function isPublicKey(value: string) {
  if (value.startsWith("sb_publishable_")) return true;
  try {
    const parts = value.split(".");
    if (parts.length !== 3) return false;
    const claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return claims.role === "anon";
  } catch {
    return false;
  }
}

export const configurationError = Boolean(url || key) && (!validEndpoint || !key || !isPublicKey(key));

export const supabase = url && key && !configurationError
  ? createClient(url, key, { auth: { detectSessionInUrl: false } })
  : null;
