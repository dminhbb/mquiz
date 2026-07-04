import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = request.headers.get("Authorization") || "";
    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } }
    });
    const adminClient = createClient(url, serviceKey);
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) throw new Error("Unauthorized");
    const { data: profile } = await adminClient
      .from("profiles")
      .select("role,active")
      .eq("id", userData.user.id)
      .single();
    if (!profile?.active || profile.role !== "superadmin") throw new Error("Forbidden");

    const body = await request.json();
    if (body.action === "create") {
      const { data, error } = await adminClient.auth.admin.createUser({
        email: String(body.email || "").trim(),
        password: String(body.password || ""),
        email_confirm: true
      });
      if (error) throw error;
      const { error: profileError } = await adminClient.from("profiles").insert({
        id: data.user.id,
        email: data.user.email,
        fullname: String(body.fullname || "").trim(),
        role: body.role === "superadmin" ? "superadmin" : "admin",
        active: true
      });
      if (profileError) {
        await adminClient.auth.admin.deleteUser(data.user.id);
        throw profileError;
      }
      return json({ ok: true, id: data.user.id });
    }

    if (body.action === "update") {
      const id = String(body.id || "");
      const { error } = await adminClient.from("profiles").update({
        fullname: String(body.fullname || "").trim(),
        role: body.role === "superadmin" ? "superadmin" : "admin",
        active: Boolean(body.active),
        updated_at: new Date().toISOString()
      }).eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === "delete") {
      const id = String(body.id || "");
      if (id === userData.user.id) throw new Error("Không thể xóa chính tài khoản đang đăng nhập.");
      const { error } = await adminClient.auth.admin.deleteUser(id);
      if (error) throw error;
      return json({ ok: true });
    }

    throw new Error("Unsupported action");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400;
    return json({ error: message }, status);
  }
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
