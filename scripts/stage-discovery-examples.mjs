import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const samples = JSON.parse(await readFile(new URL("../src/features/discovery/examples.json", import.meta.url), "utf8"));

function isPublicKey(key) {
  if (key.startsWith("sb_publishable_")) return true;
  try {
    const parts = key.split(".");
    return parts.length === 3 && JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role === "anon";
  } catch {
    return false;
  }
}

async function main() {
  if (process.argv.includes("--dry-run")) {
    for (const sample of samples) console.log(`${sample.content_fingerprint}  ${sample.company_name}`);
    return;
  }

  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key,
    DISCOVERY_TEST_EMAIL: email, DISCOVERY_TEST_PASSWORD: password } = process.env;
  if (!url || !key || !email || !password) {
    throw new Error("Supply the Supabase project URL, publishable key, and confirmed test account credentials.");
  }
  const endpoint = new URL(url);
  if (endpoint.username || endpoint.password || !(endpoint.protocol === "https:" ||
    endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname))) {
    throw new Error("Use an HTTPS Supabase URL or an HTTP loopback address.");
  }
  if (!isPublicKey(key)) throw new Error("Use a Supabase publishable or legacy anon key.");

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error: authError } = await client.auth.signInWithPassword({ email, password });
  if (authError) throw new Error(`Test account sign-in failed: ${authError.message}`);
  try {
    for (const sample of samples) {
      const { data: id, error } = await client.rpc("stage_discovery_candidate", { details: sample });
      if (error) throw new Error(`Could not stage ${sample.company_name}: ${error.message}`);
      console.log(`${sample.company_name}  ${id}`);
    }
  } finally {
    await client.auth.signOut({ scope: "local" });
  }
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : "Could not stage discovery examples.");
  process.exitCode = 1;
});
