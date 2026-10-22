/**
 * admin-users: privileged account management for superadmins (create, update, delete,
 * reset password). Every call needs a valid JWT of an active superadmin.
 */
import { AppError, readJsonObject, serveJson } from "../_shared/http.ts";
import { createCallerClient, createServiceClient } from "../_shared/supabase.ts";
import type { SupabaseClient } from "../_shared/supabase.ts";
import { requireString } from "../_shared/validation.ts";

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const MAX_EMAIL_LENGTH = 254;
const MAX_FULLNAME_LENGTH = 120;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASSWORD_POLICY_MESSAGE = "Mật khẩu cần ít nhất 8 ký tự, gồm chữ hoa, số và ký tự đặc biệt.";

type AdminRole = "superadmin" | "admin";

interface ProfileRow {
  id: string;
  role: AdminRole;
  active: boolean;
}

Deno.serve(
  serveJson(async (request) => {
    const caller = await requireSuperadmin(request);
    const adminClient = createServiceClient();
    const body = await readJsonObject(request);

    switch (body.action) {
      case "create":
        return await createUser(adminClient, body);
      case "update":
        return await updateUser(adminClient, body, caller.id);
      case "delete":
        return await deleteUser(adminClient, body, caller.id);
      case "reset_password":
        return await resetPassword(adminClient, body);
      default:
        throw new AppError("Hành động không được hỗ trợ.");
    }
  })
);

async function requireSuperadmin(request: Request): Promise<{ id: string }> {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization) throw new AppError("Unauthorized", HTTP_UNAUTHORIZED);
  const { data: userData, error: userError } =
    await createCallerClient(authorization).auth.getUser();
  if (userError || !userData.user) throw new AppError("Unauthorized", HTTP_UNAUTHORIZED);

  const { data: profile } = await createServiceClient()
    .from("profiles")
    .select("role,active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile?.active || profile.role !== "superadmin")
    throw new AppError("Forbidden", HTTP_FORBIDDEN);
  return { id: userData.user.id };
}

function requireUserId(value: unknown): string {
  const id = String(value ?? "");
  if (!UUID_PATTERN.test(id)) throw new AppError("Tài khoản không hợp lệ.");
  return id;
}

/** Display name; may be empty (as before) but is length-limited. */
function parseFullname(value: unknown): string {
  const fullname = String(value ?? "").trim();
  if (fullname.length > MAX_FULLNAME_LENGTH) throw new AppError("Họ tên quá dài.");
  return fullname;
}

function parseRole(value: unknown): AdminRole {
  return value === "superadmin" ? "superadmin" : "admin";
}

function assertStrongPassword(password: string): void {
  const strong =
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
  if (!strong) throw new AppError(PASSWORD_POLICY_MESSAGE);
}

/** Maps Supabase Auth admin errors to messages that are safe to show; rethrows the rest. */
function rethrowAuthError(error: { code?: string; message: string }): never {
  if (error.code === "email_exists" || error.code === "user_already_exists") {
    throw new AppError("Email này đã được sử dụng.", HTTP_CONFLICT);
  }
  if (error.code === "weak_password") throw new AppError(PASSWORD_POLICY_MESSAGE);
  if (error.code === "user_not_found") throw new AppError("Không tìm thấy tài khoản.");
  throw new Error(error.message);
}

async function loadProfile(adminClient: SupabaseClient, id: string): Promise<ProfileRow> {
  const { data, error } = await adminClient
    .from("profiles")
    .select("id,role,active")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("Không tìm thấy tài khoản.");
  return data as ProfileRow;
}

/** True when another active superadmin exists, so removing `excludedId` cannot lock everyone out. */
async function hasOtherActiveSuperadmin(
  adminClient: SupabaseClient,
  excludedId: string
): Promise<boolean> {
  const { count, error } = await adminClient
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "superadmin")
    .eq("active", true)
    .neq("id", excludedId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function createUser(adminClient: SupabaseClient, body: Record<string, unknown>) {
  const email = requireString(body.email, "Email", MAX_EMAIL_LENGTH);
  if (!EMAIL_PATTERN.test(email)) throw new AppError("Email không hợp lệ.");
  const password = String(body.password ?? "");
  assertStrongPassword(password);
  const fullname = parseFullname(body.fullname);

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (error) rethrowAuthError(error);

  const { error: profileError } = await adminClient.from("profiles").insert({
    id: data.user.id,
    email: data.user.email,
    fullname,
    role: parseRole(body.role),
    active: true
  });
  if (profileError) {
    await adminClient.auth.admin.deleteUser(data.user.id);
    throw profileError;
  }
  return { ok: true, id: data.user.id };
}

async function updateUser(
  adminClient: SupabaseClient,
  body: Record<string, unknown>,
  callerId: string
) {
  const id = requireUserId(body.id);
  const target = await loadProfile(adminClient, id);
  const role = parseRole(body.role);
  const active = Boolean(body.active);

  const losesSuperadmin =
    target.role === "superadmin" && target.active && (role !== "superadmin" || !active);
  if (id === callerId && losesSuperadmin) {
    throw new AppError(
      "Không thể tự hạ quyền hoặc khóa chính tài khoản đang đăng nhập.",
      HTTP_CONFLICT
    );
  }
  if (losesSuperadmin && !(await hasOtherActiveSuperadmin(adminClient, id))) {
    throw new AppError("Phải còn ít nhất một Superadmin đang hoạt động.", HTTP_CONFLICT);
  }

  const { error } = await adminClient
    .from("profiles")
    .update({
      fullname: parseFullname(body.fullname),
      role,
      active,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);
  if (error) throw error;
  return { ok: true };
}

async function deleteUser(
  adminClient: SupabaseClient,
  body: Record<string, unknown>,
  callerId: string
) {
  const id = requireUserId(body.id);
  if (id === callerId)
    throw new AppError("Không thể xóa chính tài khoản đang đăng nhập.", HTTP_CONFLICT);
  const target = await loadProfile(adminClient, id);
  if (
    target.role === "superadmin" &&
    target.active &&
    !(await hasOtherActiveSuperadmin(adminClient, id))
  ) {
    throw new AppError("Phải còn ít nhất một Superadmin đang hoạt động.", HTTP_CONFLICT);
  }
  const { error } = await adminClient.auth.admin.deleteUser(id);
  if (error) rethrowAuthError(error);
  return { ok: true };
}

async function resetPassword(adminClient: SupabaseClient, body: Record<string, unknown>) {
  const id = requireUserId(body.id);
  const password = String(body.password ?? "");
  assertStrongPassword(password);
  const { error } = await adminClient.auth.admin.updateUserById(id, { password });
  if (error) rethrowAuthError(error);
  return { ok: true };
}
