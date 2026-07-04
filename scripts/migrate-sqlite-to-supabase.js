const Database = require("better-sqlite3");
const path = require("path");

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbPath = process.env.SQLITE_PATH || path.resolve(__dirname, "..", "backend", "data", "simple-quiz.sqlite");

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

function toIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

async function request(pathname, options = {}) {
  const authorizationHeader = serviceRoleKey.startsWith("sb_secret_")
    ? {}
    : { Authorization: `Bearer ${serviceRoleKey}` };
  const response = await fetch(`${supabaseUrl}${pathname}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      ...authorizationHeader,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
      ...options.headers
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${pathname}: ${await response.text()}`);
  }
  return response;
}

async function upsert(table, rows) {
  if (!rows.length) return;
  const chunkSize = 200;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    await request(`/rest/v1/${table}?on_conflict=id`, {
      method: "POST",
      body: JSON.stringify(chunk)
    });
  }
  console.log(`${table}: ${rows.length}`);
}

async function main() {
  const spaces = db.prepare("SELECT * FROM spaces ORDER BY id").all().map((space) => ({
    id: space.id,
    name: space.name,
    slug: space.slug,
    timer_seconds: space.timer_seconds,
    exam_start_time: space.exam_start_time || null,
    allowed_late_minutes: space.allowed_late_minutes || 30,
    real_exam_enabled: Boolean(space.real_exam_enabled),
    real_question_percent: space.real_question_percent || 50,
    real_timer_seconds: space.real_timer_seconds || 60,
    real_multi_percent: space.real_multi_percent || 50,
    real_max_attempts: space.real_max_attempts || 1,
    real_exam_version: space.real_exam_version,
    real_start_at: toIso(space.real_start_at),
    real_end_at: toIso(space.real_end_at),
    published: true,
    created_at: toIso(space.created_at) || new Date().toISOString(),
    updated_at: toIso(space.updated_at) || new Date().toISOString()
  }));

  const groups = db.prepare("SELECT * FROM groups ORDER BY id").all().map((group) => ({
    id: group.id,
    space_id: group.space_id,
    name: group.name,
    created_at: toIso(group.created_at) || new Date().toISOString()
  }));

  const questions = db.prepare("SELECT * FROM questions ORDER BY id").all().map((question) => ({
    id: question.id,
    space_id: question.space_id,
    order_no: question.order_no,
    type: question.type,
    content: question.content,
    options_json: JSON.parse(question.options_json),
    correct_json: JSON.parse(question.correct_json)
  }));

  await upsert("spaces", spaces);
  await upsert("groups", groups);
  await upsert("questions", questions);
  await request("/rest/v1/rpc/sync_app_sequences", { method: "POST", body: "{}" });

  console.log("Migration complete.");
  console.log("Admin-space assignments were not migrated because Supabase Auth users must be created first.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
