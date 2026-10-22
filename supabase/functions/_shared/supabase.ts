/** Single place that pins the supabase-js version used by every Edge Function. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

export type { SupabaseClient };

/** Supabase client using the service-role key. Never expose it to browsers. */
export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/** Supabase client acting as the caller, authorised by the Authorization header. */
export function createCallerClient(authorization: string): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } }
  });
}
