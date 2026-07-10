const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcrypt");
const { randomUUID } = require("crypto");
const { initDb, db, publicUser, canAccessSpace, markSpaceDirty, listSpacesForUser } = require("./db");
const { validateCsv } = require("./csv");
const { generateSpace, exportDeployZip } = require("./generator");
const { sha256 } = require("./crypto-utils");
const { port, sessionSecret, initialSuperadmin, distDir, frontendDir, cloudAdminDir } = require("./config");

initDb();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: "lax" }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Bạn cần đăng nhập." });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
  if (!user || !user.active) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Tài khoản không hoạt động." });
  }
  req.user = user;
  next();
}

function requireSuperadmin(req, res, next) {
  if (req.user.role !== "superadmin") return res.status(403).json({ error: "Chỉ superadmin được thực hiện thao tác này." });
  next();
}

function jsonOk(res, data = {}) {
  res.json({ ok: true, ...data });
}

app.get("/", (req, res) => res.redirect("/admin"));

app.get("/admin", (req, res) => {
  res.type("html").send(adminHtml());
});

app.get("/api/bootstrap", (req, res) => {
  const user = req.session.userId ? publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId)) : null;
  res.json({
    user,
    initialSuperadmin: {
      username: initialSuperadmin.username,
      password: initialSuperadmin.password
    }
  });
});

app.post("/api/login", async (req, res) => {
  const { username, password_hash } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !user.active) return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu." });
  const ok = await bcrypt.compare(password_hash, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu." });
  req.session.userId = user.id;
  jsonOk(res, { user: publicUser(user) });
});

app.post("/api/logout", requireAuth, (req, res) => {
  req.session.destroy(() => jsonOk(res));
});

app.post("/api/forgot-password", (req, res) => {
  const { username } = req.body;
  const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (user) db.prepare("UPDATE users SET reset_password = 1 WHERE id = ?").run(user.id);
  jsonOk(res);
});

app.post("/api/change-password", requireAuth, async (req, res) => {
  const { current_hash, new_hash } = req.body;
  const ok = await bcrypt.compare(current_hash, req.user.password_hash);
  if (!ok) return res.status(400).json({ error: "Mật khẩu hiện tại không đúng." });
  const passwordHash = await bcrypt.hash(new_hash, 12);
  db.prepare("UPDATE users SET password_hash = ?, reset_password = 0 WHERE id = ?").run(passwordHash, req.user.id);
  jsonOk(res);
});

app.get("/api/users", requireAuth, requireSuperadmin, (req, res) => {
  const users = db.prepare("SELECT id, fullname, username, role, active, reset_password, created_at FROM users ORDER BY role DESC, fullname").all();
  const assignments = db.prepare(`
    SELECT asp.admin_id, s.id, s.name FROM admin_space asp
    JOIN spaces s ON s.id = asp.space_id
    ORDER BY s.name
  `).all();
  const byUser = new Map();
  assignments.forEach((row) => {
    if (!byUser.has(row.admin_id)) byUser.set(row.admin_id, []);
    byUser.get(row.admin_id).push({ id: row.id, name: row.name });
  });
  res.json(users.map((user) => ({
    ...user,
    active: Boolean(user.active),
    reset_password: Boolean(user.reset_password),
    spaces: byUser.get(user.id) || []
  })));
});

app.post("/api/users", requireAuth, requireSuperadmin, async (req, res) => {
  const { fullname, username, role = "admin", password_hash, active = true, reset_password = false, space_ids = [] } = req.body;
  if (!fullname || !username || !password_hash) return res.status(400).json({ error: "Thiếu fullname, username hoặc password." });
  const passwordHash = await bcrypt.hash(password_hash, 12);
  try {
    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO users (fullname, username, password_hash, role, active, reset_password)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(fullname, username, passwordHash, role === "superadmin" ? "superadmin" : "admin", active ? 1 : 0, reset_password ? 1 : 0);
      assignSpaces(result.lastInsertRowid, space_ids);
    });
    tx();
    jsonOk(res);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put("/api/users/:id", requireAuth, requireSuperadmin, async (req, res) => {
  const id = Number(req.params.id);
  const { fullname, username, role = "admin", password_hash, active = true, reset_password = false, space_ids = [] } = req.body;
  try {
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE users SET fullname = ?, username = ?, role = ?, active = ?, reset_password = ? WHERE id = ?
      `).run(fullname, username, role === "superadmin" ? "superadmin" : "admin", active ? 1 : 0, reset_password ? 1 : 0, id);
      if (password_hash) {
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(password_hash, 12), id);
      }
      assignSpaces(id, space_ids);
    });
    tx();
    jsonOk(res);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/users/:id", requireAuth, requireSuperadmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "Không thể xóa chính bạn." });
  db.prepare("DELETE FROM users WHERE id = ? AND role != 'superadmin'").run(id);
  jsonOk(res);
});

function assignSpaces(userId, spaceIds) {
  db.prepare("DELETE FROM admin_space WHERE admin_id = ?").run(userId);
  const insert = db.prepare("INSERT OR IGNORE INTO admin_space (admin_id, space_id) VALUES (?, ?)");
  (spaceIds || []).forEach((spaceId) => insert.run(userId, Number(spaceId)));
}

app.get("/api/spaces", requireAuth, (req, res) => {
  res.json(listSpacesForUser(req.user).map((space) => ({
    ...space,
    dirty: Boolean(space.dirty)
  })));
});

app.post("/api/spaces", requireAuth, (req, res) => {
  const { name, slug, timer_seconds = 60, exam_start_time = null, allowed_late_minutes = 30, admin_ids = [] } = req.body;
  if (!name || !slug) return res.status(400).json({ error: "Thiếu tên hoặc slug." });
  try {
    const tx = db.transaction(() => {
      const result = db.prepare("INSERT INTO spaces (name, slug, timer_seconds, exam_start_time, allowed_late_minutes, dirty) VALUES (?, ?, ?, ?, ?, 1)")
        .run(name, slug, Number(timer_seconds), exam_start_time || null, Number(allowed_late_minutes));
      if (req.user.role === "admin") db.prepare("INSERT INTO admin_space (admin_id, space_id) VALUES (?, ?)").run(req.user.id, result.lastInsertRowid);
      if (req.user.role === "superadmin") assignAdmins(result.lastInsertRowid, admin_ids);
      db.prepare("INSERT INTO groups (space_id, name) VALUES (?, ?)").run(result.lastInsertRowid, name);
    });
    tx();
    jsonOk(res);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put("/api/spaces/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessSpace(req.user, id)) return res.status(403).json({ error: "Không có quyền với space này." });
  const { name, slug, timer_seconds = 60, exam_start_time = null, allowed_late_minutes = 30, admin_ids = [] } = req.body;
  try {
    const tx = db.transaction(() => {
      db.prepare("UPDATE spaces SET name = ?, slug = ?, timer_seconds = ?, exam_start_time = ?, allowed_late_minutes = ?, dirty = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(name, slug, Number(timer_seconds), exam_start_time || null, Number(allowed_late_minutes), id);
      if (req.user.role === "superadmin") assignAdmins(id, admin_ids);
    });
    tx();
    jsonOk(res);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put("/api/spaces/:id/real-exam", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessSpace(req.user, id)) return res.status(403).json({ error: "Không có quyền với space này." });
  const enabled = req.body.enabled ? 1 : 0;
  const questionPercent = Number(req.body.question_percent);
  const timerSeconds = Number(req.body.timer_seconds);
  const multiPercent = Number(req.body.multi_percent);
  const maxAttempts = Number(req.body.max_attempts);
  const scoringMethod = Number(req.body.scoring_method || 1);
  const startAt = String(req.body.start_at || "").trim();
  const endAt = String(req.body.end_at || "").trim();
  if (![30, 50, 70, 100].includes(questionPercent)) return res.status(400).json({ error: "Tỷ lệ câu hỏi không hợp lệ." });
  if (![45, 60, 90, 120].includes(timerSeconds)) return res.status(400).json({ error: "Thời gian mỗi câu không hợp lệ." });
  if (![30, 50, 70, 100].includes(multiPercent)) return res.status(400).json({ error: "Tỷ lệ câu nhiều đáp án không hợp lệ." });
  if (![1, 2].includes(scoringMethod)) return res.status(400).json({ error: "Cách tính điểm không hợp lệ." });
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    return res.status(400).json({ error: "Số lần thi phải từ 1 đến 5." });
  }
  if (enabled && (!startAt || !endAt || !Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt)))) {
    return res.status(400).json({ error: "Vui lòng nhập đầy đủ thời gian bắt đầu và kết thúc Thi thật." });
  }
  if (enabled && Date.parse(startAt) >= Date.parse(endAt)) {
    return res.status(400).json({ error: "Thời gian kết thúc phải sau thời gian bắt đầu." });
  }
  const current = db.prepare("SELECT real_exam_enabled, real_exam_version, real_start_at, real_end_at FROM spaces WHERE id = ?").get(id);
  const startsNewExam = enabled && (
    !current?.real_exam_enabled
    || current.real_start_at !== startAt
    || current.real_end_at !== endAt
  );
  const examVersion = startsNewExam || !current?.real_exam_version ? randomUUID() : current.real_exam_version;
  db.prepare(`
    UPDATE spaces
    SET real_exam_enabled = ?, real_question_percent = ?, real_timer_seconds = ?,
        real_multi_percent = ?, real_max_attempts = ?, real_scoring_method = ?, real_exam_version = ?, real_start_at = ?, real_end_at = ?,
        dirty = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(enabled, questionPercent, timerSeconds, multiPercent, maxAttempts, scoringMethod, examVersion, startAt || null, endAt || null, id);
  jsonOk(res);
});

app.get("/api/spaces/:id/groups", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessSpace(req.user, id)) return res.status(403).json({ error: "Không có quyền với space này." });
  const groups = db.prepare("SELECT id, name FROM groups WHERE space_id = ? ORDER BY name").all(id);
  res.json(groups);
});

app.post("/api/spaces/:id/groups", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessSpace(req.user, id)) return res.status(403).json({ error: "Không có quyền với space này." });
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Thiếu tên group." });
  try {
    db.prepare("INSERT INTO groups (space_id, name) VALUES (?, ?)").run(id, name.trim());
    markSpaceDirty(id);
    jsonOk(res);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put("/api/groups/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Thiếu tên group." });
  const group = db.prepare("SELECT * FROM groups WHERE id = ?").get(id);
  if (!group) return res.status(404).json({ error: "Group không tồn tại." });
  if (!canAccessSpace(req.user, group.space_id)) return res.status(403).json({ error: "Không có quyền với space này." });
  try {
    db.prepare("UPDATE groups SET name = ? WHERE id = ?").run(name.trim(), id);
    markSpaceDirty(group.space_id);
    jsonOk(res);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/groups/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const group = db.prepare("SELECT * FROM groups WHERE id = ?").get(id);
  if (!group) return res.status(404).json({ error: "Group không tồn tại." });
  if (!canAccessSpace(req.user, group.space_id)) return res.status(403).json({ error: "Không có quyền với space này." });
  const groupCount = db.prepare("SELECT COUNT(*) AS count FROM groups WHERE space_id = ?").get(group.space_id).count;
  if (groupCount <= 1) return res.status(400).json({ error: "Space phải có ít nhất 1 group." });
  db.prepare("DELETE FROM groups WHERE id = ?").run(id);
  markSpaceDirty(group.space_id);
  jsonOk(res);
});

app.delete("/api/spaces/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessSpace(req.user, id)) return res.status(403).json({ error: "Không có quyền với space này." });
  db.prepare("DELETE FROM spaces WHERE id = ?").run(id);
  jsonOk(res);
});

function assignAdmins(spaceId, adminIds) {
  db.prepare("DELETE FROM admin_space WHERE space_id = ?").run(spaceId);
  const insert = db.prepare("INSERT OR IGNORE INTO admin_space (admin_id, space_id) VALUES (?, ?)");
  (adminIds || []).forEach((adminId) => insert.run(Number(adminId), spaceId));
}

app.get("/api/spaces/:id/questions", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessSpace(req.user, id)) return res.status(403).json({ error: "Không có quyền với space này." });
  const questions = db.prepare("SELECT id, order_no, type, content, options_json, correct_json FROM questions WHERE space_id = ? ORDER BY order_no, id").all(id)
    .map((question) => ({
      ...question,
      options: JSON.parse(question.options_json),
      correct: JSON.parse(question.correct_json)
    }));
  res.json(questions);
});

app.post("/api/spaces/:id/csv/preview", requireAuth, upload.single("file"), (req, res) => {
  const id = Number(req.params.id);
  req.session.csvPreview = null;
  if (!canAccessSpace(req.user, id)) return res.status(403).json({ error: "Không có quyền với space này." });
  if (!req.file) return res.status(400).json({ error: "Chưa chọn file CSV." });
  const result = validateCsv(req.file.buffer);
  if (!result.ok) return res.status(400).json({ errors: result.errors });
  req.session.csvPreview = { spaceId: id, questions: result.questions };
  res.json({
    ok: true,
    count: result.questions.length,
    sample: result.questions.slice(0, 5)
  });
});

app.post("/api/spaces/:id/csv/confirm", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const preview = req.session.csvPreview;
  if (!preview || preview.spaceId !== id) return res.status(400).json({ error: "Không có CSV preview để xác nhận." });
  if (!canAccessSpace(req.user, id)) return res.status(403).json({ error: "Không có quyền với space này." });
  const tx = db.transaction(() => {
    const maxOrder = db.prepare("SELECT COALESCE(MAX(order_no), 0) AS max_order FROM questions WHERE space_id = ?").get(id).max_order;
    const insert = db.prepare(`
      INSERT INTO questions (space_id, order_no, type, content, options_json, correct_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    preview.questions.forEach((question, index) => {
      insert.run(id, maxOrder + index + 1, question.type, question.content, JSON.stringify(question.options), JSON.stringify(question.correct));
    });
    markSpaceDirty(id);
  });
  tx();
  req.session.csvPreview = null;
  jsonOk(res);
});

app.delete("/api/spaces/:id/questions", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessSpace(req.user, id)) return res.status(403).json({ error: "Không có quyền với space này." });
  const result = db.prepare("DELETE FROM questions WHERE space_id = ?").run(id);
  req.session.csvPreview = null;
  markSpaceDirty(id);
  res.json({ ok: true, deleted: result.changes });
});

app.post("/api/spaces/:id/generate", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessSpace(req.user, id)) return res.status(403).json({ error: "Không có quyền với space này." });
  try {
    const result = generateSpace(id);
    jsonOk(res, result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/export", requireAuth, async (req, res) => {
  try {
    const zipPath = await exportDeployZip();
    jsonOk(res, { zipPath });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use("/assets", express.static(path.join(distDir, "assets")));
app.use("/assets", express.static(path.join(frontendDir, "assets")));
app.use("/data", express.static(path.join(distDir, "data")));
app.use("/data", express.static(path.join(frontendDir, "data")));
app.use("/cloud-admin", express.static(cloudAdminDir));
app.use("/preview", express.static(distDir));
app.use("/preview", express.static(frontendDir));
function sendQuizIndex(req, res) {
  const generatedIndex = path.join(distDir, "index.html");
  res.sendFile(fs.existsSync(generatedIndex) ? generatedIndex : path.join(frontendDir, "index.html"));
}

app.get("/preview/*", sendQuizIndex);
app.use("/static-source", express.static(frontendDir));
app.get("/:slug([a-z0-9-]+)", sendQuizIndex);

app.listen(port, () => {
  console.log(`mquiz backend: http://localhost:${port}/admin`);
  console.log(`Default superadmin: ${initialSuperadmin.username} / ${initialSuperadmin.password}`);
});

function escHtml(str) {
  return String(str || "").replace(/[&<>"']/g, function(ch) {
    var map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return map[ch];
  });
}

function adminHtml() {
  var styles = '<style>'+
    ':root{--bg:#f0f3f9;--panel:#ffffff;--ink:#172033;--muted:#657086;--line:#d5dae7;--brand:#2f65d8;--brand-strong:#1f54c8;--ok:#11954d;--bad:#c0262d;--warn:#b7791f;--control:#f7f9ff;--shadow:0 10px 24px rgba(15,23,42,.07)}'+
    '[data-theme="dark"]{--bg:#101827;--panel:#151f32;--ink:#edf3ff;--muted:#9aa7bd;--line:#26344f;--brand:#77a2ff;--brand-strong:#9abaff;--ok:#55d987;--bad:#ff7f86;--warn:#f2c76b;--control:#101827;--shadow:0 0 0 1px rgba(255,255,255,.08)}'+
    '*{box-sizing:border-box}'+
    'body{margin:0;font:14px/1.5 "Be Vietnam Pro","Trebuchet MS",sans-serif;background:linear-gradient(135deg,#e5e7ec 0%,#f4f6fb 52%,#e8ebf2 100%);color:var(--ink);-webkit-font-smoothing:antialiased}'+
    'button,input,select,textarea{font:inherit}'+
    'button{border:1px solid var(--line);border-radius:7px;min-height:40px;padding:9px 13px;background:var(--control);color:var(--ink);cursor:pointer;font-weight:700}'+
    'button:hover{border-color:#8da9ee;background:#eef4ff}'+
    'button.primary{background:var(--brand);border-color:var(--brand);color:white;font-weight:800;box-shadow:0 10px 18px rgba(47,101,216,.18)}'+
    'button.danger{background:#fff0f1;border-color:#ffd0d3;color:var(--bad)}'+
    'button:disabled{opacity:.5;cursor:not-allowed}'+
    'input,select,textarea{width:100%;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:7px;min-height:40px;padding:9px 11px}'+
    'label{display:grid;gap:6px;color:var(--muted);font-weight:600}'+
    'table{width:100%;border-collapse:separate;border-spacing:0 8px}'+
    'th,td{text-align:left;padding:12px;vertical-align:top;background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}'+
    'td:first-child,th:first-child{border-left:1px solid var(--line);border-radius:8px 0 0 8px}'+
    'td:last-child,th:last-child{border-right:1px solid var(--line);border-radius:0 8px 8px 0}'+
    'th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;background:#edf1f8}'+
    '.app{min-height:100vh;width:min(1320px,calc(100vw - 40px));margin:28px auto;display:grid;grid-template-columns:245px 1fr;overflow:hidden;border:1px solid rgba(15,23,42,.08);border-radius:18px;background:var(--bg);box-shadow:0 30px 80px rgba(15,23,42,.18)}'+
    '.sidebar{padding:24px 18px;display:flex;flex-direction:column;gap:24px;background:linear-gradient(180deg,var(--brand),var(--brand-strong));color:#fff}'+
    '.brand{font-size:22px;font-weight:900;color:#fff}'+
    '.nav{display:grid;gap:8px}'+
    '.nav button{text-align:left;background:transparent;border-color:transparent;color:rgba(255,255,255,.88);justify-content:flex-start}'+
    '.nav button.active,.nav button:hover{background:#fff;color:var(--brand-strong);border-color:rgba(255,255,255,.3)}'+
    '.main{padding:24px;display:grid;gap:18px;align-content:start;background:var(--bg)}'+
    '.topbar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-bottom:14px;border-bottom:1px solid var(--line)}'+
    '.topbar h1{margin:0;font-size:26px}'+
    '.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px;box-shadow:var(--shadow)}'+
    '.grid{display:grid;gap:12px}'+
    '.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}'+
    '.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}'+
    '.banner{border:1px solid rgba(183,121,31,.35);background:#fff8e8;color:var(--warn);padding:12px 14px;border-radius:8px;font-weight:800}'+
    '.muted{color:var(--muted)}'+
    '.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:3px 8px;font-size:12px;color:var(--muted)}'+
    '.status-ok{color:var(--ok)}.status-bad{color:var(--bad)}.status-warn{color:var(--warn)}'+
    '.login{min-height:100vh;display:grid;place-items:center;padding:24px}'+
    '.login .panel{width:min(440px,100%)}'+
    '.modal{position:fixed;inset:0;display:none;place-items:center;background:rgba(0,0,0,.35);padding:18px}'+
    '.modal.open{display:grid}'+
    '.modal .panel{width:min(820px,100%);max-height:calc(100vh - 24px);overflow:auto;padding:14px 16px}'+
    '.row-actions{display:flex;gap:6px;flex-wrap:wrap}'+
    '.pw-wrap{position:relative}'+
    '.pw-wrap input{padding-right:42px}'+
    '.pw-toggle{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:transparent;padding:6px;cursor:pointer;color:var(--muted);min-height:auto;width:auto}'+
    '.pw-toggle:hover{color:var(--ink);background:transparent}'+
    '.checkbox-row{display:flex;gap:20px;align-items:center;flex-wrap:wrap}'+
    '.checkbox-row label{display:flex;align-items:center;gap:6px;color:var(--ink);font-weight:600;cursor:pointer}'+
    '.switch-control{display:flex;align-items:center;gap:12px;font-weight:800;cursor:pointer}.switch-control input{position:absolute;opacity:0;pointer-events:none}.switch-track{position:relative;width:48px;height:26px;border-radius:13px;background:#9aa7bd;transition:background .18s cubic-bezier(.23,1,.32,1)}.switch-track:after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.28);transition:transform .18s cubic-bezier(.23,1,.32,1)}.switch-control input:checked+.switch-track{background:var(--brand)}.switch-control input:checked+.switch-track:after{transform:translateX(22px)}.switch-control input:focus-visible+.switch-track{outline:3px solid rgba(47,101,216,.24);outline-offset:2px}'+
    '.compact-modal-form{gap:8px}.compact-modal-form h2{margin:0;font-size:21px;line-height:1.25}.compact-modal-form>.grid{gap:8px 12px}.compact-modal-form label{gap:4px;font-size:12px}.compact-modal-form input,.compact-modal-form select{min-height:36px;padding:6px 9px}.compact-modal-form .actions{justify-content:flex-end;padding-top:2px}'+
    '.real-exam-header{display:flex;align-items:center;justify-content:space-between;gap:16px}.scoring-field-row{display:grid;grid-template-columns:minmax(0,1fr) 38px;align-items:end;gap:8px;width:calc(50% - 6px)}.scoring-help{position:relative}.scoring-help-button{width:38px;min-height:36px;padding:0;border-radius:50%;font-size:16px}.scoring-tooltip{position:absolute;z-index:30;right:0;bottom:calc(100% + 12px);width:min(360px,calc(100vw - 48px));display:none;gap:5px;padding:13px 15px;border-radius:8px;background:rgba(0,0,0,.95);color:#fff;font-size:12px;font-weight:500;line-height:1.55;box-shadow:0 12px 30px rgba(0,0,0,.24)}.scoring-tooltip:after{content:"";position:absolute;top:100%;right:12px;border:7px solid transparent;border-top-color:rgba(0,0,0,.95)}.scoring-tooltip b,.scoring-tooltip span{display:block}.scoring-help:hover .scoring-tooltip,.scoring-help.open .scoring-tooltip{display:grid}'+
    '.group-list{display:flex;flex-direction:column;gap:4px;max-height:96px;overflow-y:auto;border:1px solid var(--line);border-radius:7px;padding:7px}'+
    '.group-item{display:flex;gap:6px;align-items:center}'+
    '.group-item span{flex:1}'+
    '.group-item button{min-height:32px;padding:5px 10px;font-size:12px}'+
    '.group-item.default span{font-weight:700;color:var(--brand)}'+
    '@media(max-width:900px){.app{width:calc(100vw - 16px);margin:8px;grid-template-columns:1fr}.sidebar{border-right:0}.grid.two{grid-template-columns:1fr}.main{padding:16px}.topbar{align-items:stretch;flex-direction:column}.scoring-field-row{width:100%}.real-exam-header{align-items:flex-start}}'+
    '</style>';

  var scripts = '<script>'+
    'var state={user:null,view:"dashboard",spaces:[],users:[],editing:null,preview:null};'+
    'var $=function(sel){return document.querySelector(sel)};'+
    'var root=$("#root");'+
    'var modal=$("#modal");'+
    'var api=async function(url,options){'+
      'var response=await fetch(url,{headers:{"Content-Type":"application/json"},...options});'+
      'var text=await response.text();'+
      'var data=text?JSON.parse(text):{};'+
      'if(!response.ok)throw data;'+
      'return data;'+
    '};'+
    'var sha=async function(text){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))).map(function(b){return b.toString(16).padStart(2,"0")}).join("")};'+
    'function toast(message,bad){alert((bad?"Lỗi: ":"")+message)}'+
    'function togglePassword(inputId,btn){'+
      'var input=document.getElementById(inputId);'+
      'if(!input)return;'+
      'if(input.type==="password"){input.type="text";btn.textContent="\u{1F441}"}else{input.type="password";btn.textContent="\u{1F441}"}'+
    '}'+
    'async function bootstrap(){'+
      'var theme=localStorage.getItem("sq-admin-theme")||"light";'+
      'document.documentElement.dataset.theme=theme;'+
      'var data=await api("/api/bootstrap");'+
      'state.user=data.user;'+
      'render();'+
    '}'+
    'function render(){'+
      'if(!state.user)return renderLogin();'+
      'root.innerHTML=`<div class="app"><aside class="sidebar"><div><div class="brand">mquiz</div><div style="color:rgba(255,255,255,.72);font-weight:700">Backend local</div></div><div class="nav">${navButton("dashboard","Dashboard")}${state.user.role==="superadmin"?navButton("users","Quản lý Admin"):""}${navButton("spaces","Quản lý Space")}${navButton("password","Đổi mật khẩu")}</div><div style="margin-top:auto;display:grid;gap:10px"><div><b>${esc(state.user.fullname)}</b><br><span>${state.user.role}</span></div><button onclick="toggleTheme()">Đổi theme</button><button onclick="logout()">Đăng xuất</button></div></aside><main class="main"><div id="view"></div></main></div>`;'+
      'loadView();'+
    '}'+
    'function navButton(view,label){return `<button class="${state.view===view?"active":""}" onclick="state.view=&quot;${view}&quot;; render()">${label}</button>`}'+
    'function renderLogin(){'+
      'root.innerHTML=`<div class="login"><form class="panel grid" onsubmit="login(event)"><div><div class="brand">mquiz</div><div class="muted">Đăng nhập backend local</div></div><label>Username<input name="username" required autocomplete="username"></label><label>Password<div class="pw-wrap"><input name="password" type="password" required autocomplete="current-password" id="loginPw"><button type="button" class="pw-toggle" onclick="togglePassword(&quot;loginPw&quot;, this)">Hiện</button></div></label><button class="primary">Đăng nhập</button><button type="button" onclick="forgotPassword()">Quên mật khẩu</button><p class="muted">Lần đầu: superadmin / admin123. Hãy đổi mật khẩu sau khi đăng nhập.</p></form></div>`;'+
    '}'+
    'async function login(event){'+
      'event.preventDefault();'+
      'var form=new FormData(event.target);'+
      'try{'+
        'var data=await api("/api/login",{method:"POST",body:JSON.stringify({username:form.get("username"),password_hash:await sha(form.get("password"))})});'+
        'state.user=data.user;render();'+
      '}catch(error){toast(error.error||"Không đăng nhập được.",true)}'+
    '}'+
    'async function forgotPassword(){'+
      'var username=prompt("Nhập username cần reset mật khẩu");'+
      'if(!username)return;'+
      'if(!confirm("Bạn có chắc muốn yêu cầu reset mật khẩu?"))return;'+
      'await api("/api/forgot-password",{method:"POST",body:JSON.stringify({username})});'+
      'toast("Yêu cầu reset đã được ghi nhận nếu username tồn tại.");'+
    '}'+
    'async function logout(){await api("/api/logout",{method:"POST"});state.user=null;render()}'+
    'function toggleTheme(){var next=document.documentElement.dataset.theme==="dark"?"light":"dark";document.documentElement.dataset.theme=next;localStorage.setItem("sq-admin-theme",next)}'+
    'async function loadView(){'+
      'var view=$("#view");'+
      'if(state.view==="dashboard")return renderDashboard(view);'+
      'if(state.view==="users")return renderUsers(view);'+
      'if(state.view==="spaces")return renderSpaces(view);'+
      'if(state.view==="password")return renderPassword(view);'+
    '}'+
    'async function refreshSpaces(){state.spaces=await api("/api/spaces")}'+
    'async function refreshUsers(){if(state.user.role==="superadmin")state.users=await api("/api/users")}'+
    'async function renderDashboard(view){'+
      'await refreshSpaces();'+
      'var dirty=state.spaces.filter(function(s){return s.dirty}).length;'+
      'view.innerHTML=`<div class="topbar"><div><h1>Dashboard</h1><div class="muted">Theo dõi trạng thái Generate và Export/Deploy.</div></div><button class="primary" onclick="exportDeploy()">Xuất bộ deploy</button></div>${dirty?`<div class="banner">Có ${dirty} space đã thay đổi. Bạn cần Generate lại trước khi deploy.</div>`:`<div class="panel status-ok">Tất cả space đã Generate.</div>`}<div class="panel"><table><thead><tr><th>Space</th><th>Câu hỏi</th><th>Trạng thái</th><th>Generate</th></tr></thead><tbody>${state.spaces.map(function(s){return `<tr><td><b>${esc(s.name)}</b><br><span class="muted">/${esc(s.slug)}</span></td><td>${s.question_count}</td><td>${statusText(s)}</td><td><button onclick="generateSpace(${s.id})">Generate</button></td></tr>`}).join("")}</tbody></table></div>`;'+
    '}'+
    'function statusText(s){return s.dirty?`<span class="status-warn">Chưa Generate</span>`:`<span class="status-ok">Đã Generate</span>`}'+
    'async function renderUsers(view){'+
      'await Promise.all([refreshUsers(),refreshSpaces()]);'+
      'view.innerHTML=`<div class="topbar"><div><h1>Quản lý Admin</h1><div class="muted">Quản lý tài khoản và phân quyền space.</div></div><button class="primary" onclick="openUser()">Thêm admin</button></div><div class="panel"><table><thead><tr><th>Người dùng</th><th>Role</th><th>Space</th><th>Trạng thái</th><th></th></tr></thead><tbody>${state.users.map(function(u){return `<tr><td><b>${esc(u.fullname)}</b><br><span class="muted">${esc(u.username)}</span></td><td>${u.role}</td><td>${u.spaces.map(function(s){return esc(s.name)}).join(", ")}</td><td>${!u.active||u.reset_password?`<span class="status-warn">Cần chú ý</span>`:`<span class="status-ok">OK</span>`}</td><td class="row-actions"><button onclick="openUser(${u.id})">Sửa</button><button class="danger" onclick="deleteUser(${u.id})">Xóa</button></td></tr>`}).join("")}</tbody></table></div>`;'+
    '}'+
    'async function renderSpaces(view){'+
      'await Promise.all([refreshSpaces(),refreshUsers()]);'+
      'view.innerHTML=`<div class="topbar"><div><h1>Quản lý Space</h1><div class="muted">Upload CSV, Generate static files, Export deploy.</div></div><div class="actions"><button class="primary" onclick="openSpace()">Thêm space</button><button onclick="exportDeploy()">Xuất bộ deploy</button></div></div><div class="banner">Generate lại space trước khi xuất bản thay đổi.</div><div class="panel"><table><thead><tr><th>Space</th><th>Timer</th><th>Câu hỏi</th><th>Trạng thái</th><th></th></tr></thead><tbody>${state.spaces.map(function(s){return `<tr><td><b>${esc(s.name)}</b><br><span class="muted">/${esc(s.slug)}</span></td><td>${s.timer_seconds}s</td><td>${s.question_count}</td><td>${statusText(s)}<br>${s.real_exam_enabled?`<span class="status-warn">Thi thật đang bật</span>`:""}</td><td class="row-actions"><button onclick="openSpace(${s.id})">Sửa</button><button onclick="openRealExam(${s.id})">Chế độ Thi thật</button><button onclick="openCsv(${s.id})">Upload CSV</button><button onclick="generateSpace(${s.id})">Generate</button><button class="danger" onclick="deleteSpace(${s.id})">Xóa</button></td></tr>`}).join("")}</tbody></table></div>`;'+
    '}'+
    'function renderPassword(view){'+
      'view.innerHTML=`<div class="panel grid" style="max-width:520px"><h1>Đổi mật khẩu</h1><label>Mật khẩu hiện tại<input id="curPass" type="password"></label><label>Mật khẩu mới<input id="newPass" type="password"></label><button class="primary" onclick="changePassword()">Đổi mật khẩu</button></div>`;'+
    '}'+
    'function openModal(html){modal.innerHTML=`<div class="panel">${html}</div>`;modal.classList.add("open");modal.onclick=function(e){if(e.target===modal)closeModal()}}'+
    'function closeModal(){modal.classList.remove("open");modal.innerHTML=""}'+
    'function openUser(id){'+
      'var u=state.users.find(function(x){return x.id===id})||{fullname:"",username:"",role:"admin",active:true,reset_password:false,spaces:[]};'+
      'var selected=new Set((u.spaces||[]).map(function(s){return s.id}));'+
      'var checkboxRow=id?`<div class="checkbox-row"><label><input type="checkbox" name="active" ${u.active?"checked":""}> Active</label><label><input type="checkbox" name="reset_password" ${u.reset_password?"checked":""}> Reset password</label></div>`:"";'+
      'openModal(`<form class="grid" onsubmit="saveUser(event,${id||"null"})"><h2>${id?"Sửa":"Thêm"} admin</h2><div class="grid two"><label>Fullname<input name="fullname" value="${esc(u.fullname)}" required></label><label>Username<input name="username" value="${esc(u.username)}" required></label><label>Role<select name="role"><option ${u.role==="admin"?"selected":""} value="admin">admin</option><option ${u.role==="superadmin"?"selected":""} value="superadmin">superadmin</option></select></label><label>Password<input name="password" type="password" ${id?"":"required"}></label></div><label>Gán space<select name="space_ids" multiple size="6">${state.spaces.map(function(s){return `<option value="${s.id}" ${selected.has(s.id)?"selected":""}>${esc(s.name)}</option>`}).join("")}</select></label>${checkboxRow}<div class="actions"><button class="primary">Lưu</button><button type="button" onclick="closeModal()">Hủy</button></div></form>`);'+
    '}'+
    'async function saveUser(event,id){'+
      'event.preventDefault();'+
      'var f=new FormData(event.target);'+
      'var password=f.get("password");'+
      'var body={fullname:f.get("fullname"),username:f.get("username"),role:f.get("role"),active:f.has("active"),reset_password:f.has("reset_password"),space_ids:f.getAll("space_ids")};'+
      'if(password)body.password_hash=await sha(password);'+
      'await api(id?"/api/users/"+id:"/api/users",{method:id?"PUT":"POST",body:JSON.stringify(body)});'+
      'closeModal();await renderUsers($("#view"));}'+
    'async function deleteUser(id){if(confirm("Xóa admin này?")){await api("/api/users/"+id,{method:"DELETE"});await renderUsers($("#view"))}}'+
    'var currentSpaceId=null;'+
    'async function openSpace(id){'+
      'currentSpaceId=id;'+
      'var s=state.spaces.find(function(x){return x.id===id})||{name:"",slug:"",timer_seconds:60,exam_start_time:"",allowed_late_minutes:30};'+
      'var assigned=new Set((state.users||[]).filter(function(u){return(u.spaces||[]).some(function(sp){return sp.id===id})}).map(function(u){return u.id}));'+
      'var groupsHtml=await loadGroupsHtml(id,s.name);'+
      'var adminOptions=state.users.filter(function(u){return u.role==="admin"}).map(function(u){return `<option value="${u.id}" ${assigned.has(u.id)?"selected":""}>${esc(u.fullname)}</option>`}).join("");'+
      'openModal(`<form class="grid compact-modal-form" onsubmit="saveSpace(event,${id||"null"})"><h2>${id?"Sửa":"Thêm"} space</h2><div class="grid two"><label>Tên<input name="name" value="${esc(s.name)}" required></label><label>Slug<input name="slug" value="${esc(s.slug)}" required></label><label>Timer mặc định (giây)<input name="timer_seconds" type="number" min="1" value="${Number(s.timer_seconds||60)}" required></label><label>Giờ thi chuẩn<input name="exam_start_time" type="time" value="${esc(s.exam_start_time||"")}"></label><label>Cho phép đi muộn (phút)<input name="allowed_late_minutes" type="number" min="1" value="${Number(s.allowed_late_minutes||30)}" required></label></div>${state.user.role==="superadmin"?`<label>Gán admin<select name="admin_ids" multiple size="4">${adminOptions}</select></label>`:""}<label>Quản lý Group<div id="groupsContainer">${groupsHtml}</div></label><div class="actions"><button class="primary">Lưu</button><button type="button" onclick="closeModal()">Hủy</button></div></form>`);'+
    '}'+
    'async function loadGroupsHtml(spaceId,spaceName){'+
      'if(!spaceId)return `<div class="muted">Lưu space trước để quản lý Group.</div>`;'+
      'try{'+
        'var groups=await api("/api/spaces/"+spaceId+"/groups");'+
        'var html=`<div class="group-list">`;'+
        'groups.forEach(function(g){'+
          'html+=`<div class="group-item">`;'+
          'html+=`<span>${esc(g.name)}</span>`;'+
          'html+=`<button type="button" onclick="editGroup(${g.id}, decodeURIComponent(&quot;${encodeURIComponent(g.name)}&quot;))">Sửa</button>`;'+
          'html+=`<button type="button" class="danger" onclick="deleteGroup(${g.id})">Xóa</button>`;'+
          'html+=`</div>`;'+
        '});'+
        'html+=`</div>`;'+
        'html+=`<div style="display:flex;gap:6px;margin-top:8px"><input id="newGroupName" placeholder="Tên group mới"><button type="button" onclick="addGroup()">Thêm</button></div>`;'+
        'return html;'+
      '}catch(e){return `<div class="muted">Không tải được danh sách group.</div>`}'+
    '}'+
    'async function addGroup(){'+
      'var name=$("#newGroupName")?$("#newGroupName").value.trim():null;'+
      'if(!name||!currentSpaceId)return toast("Nhập tên group.",true);'+
      'try{'+
        'await api("/api/spaces/"+currentSpaceId+"/groups",{method:"POST",body:JSON.stringify({name})});'+
        'var s=state.spaces.find(function(x){return x.id===currentSpaceId});'+
        '$("#groupsContainer").innerHTML=await loadGroupsHtml(currentSpaceId,s&&s.name||"");'+
      '}catch(e){toast(e.error||"Lỗi khi thêm group.",true)}'+
    '}'+
    'async function editGroup(id,currentName){'+
      'var name=prompt("Sửa tên group:",currentName);'+
      'if(!name||name===currentName)return;'+
      'try{'+
        'await api("/api/groups/"+id,{method:"PUT",body:JSON.stringify({name})});'+
        'var s=state.spaces.find(function(x){return x.id===currentSpaceId});'+
        '$("#groupsContainer").innerHTML=await loadGroupsHtml(currentSpaceId,s&&s.name||"");'+
      '}catch(e){toast(e.error||"Lỗi khi sửa group.",true)}'+
    '}'+
    'async function deleteGroup(id){'+
      'if(!confirm("Xóa group này?"))return;'+
      'try{'+
        'await api("/api/groups/"+id,{method:"DELETE"});'+
        'var s=state.spaces.find(function(x){return x.id===currentSpaceId});'+
        '$("#groupsContainer").innerHTML=await loadGroupsHtml(currentSpaceId,s&&s.name||"");'+
      '}catch(e){toast(e.error||"Lỗi khi xóa group.",true)}'+
    '}'+
    'async function saveSpace(event,id){'+
      'event.preventDefault();'+
      'var f=new FormData(event.target);'+
      'await api(id?"/api/spaces/"+id:"/api/spaces",{method:id?"PUT":"POST",body:JSON.stringify({name:f.get("name"),slug:f.get("slug"),timer_seconds:f.get("timer_seconds"),exam_start_time:f.get("exam_start_time"),allowed_late_minutes:f.get("allowed_late_minutes"),admin_ids:f.getAll("admin_ids")})});'+
      'closeModal();await renderSpaces($("#view"));}'+
    'async function deleteSpace(id){if(confirm("Xóa space này?")){await api("/api/spaces/"+id,{method:"DELETE"});await renderSpaces($("#view"))}}'+
    'function realMultiCount(total,percent){return Math.min(total,Math.round((total*percent/100)/2)*2)}'+
    'function openRealExam(id){'+
      'var s=state.spaces.find(function(x){return x.id===id});if(!s)return;'+
      'openModal(`<form class="grid compact-modal-form" onsubmit="saveRealExam(event,${id})"><div class="real-exam-header"><h2>Chế độ Thi thật</h2><label class="switch-control"><input type="checkbox" name="enabled" ${s.real_exam_enabled?"checked":""}><span class="switch-track" aria-hidden="true"></span><span>Bật Thi thật</span></label></div><div class="grid two"><label>Số lượng câu hỏi<select name="question_percent">${[30,50,70,100].map(function(v){return `<option value="${v}" ${Number(s.real_question_percent)===v?"selected":""}>${v}%</option>`}).join("")}</select></label><label>Thời gian mỗi câu<select name="timer_seconds">${[45,60,90,120].map(function(v){return `<option value="${v}" ${Number(s.real_timer_seconds)===v?"selected":""}>${v}s</option>`}).join("")}</select></label></div><div class="grid two"><label>Tỷ lệ câu nhiều đáp án<select name="multi_percent" onchange="updateRealMultiPreview(${Number(s.multi_question_count||0)},this.value)">${[30,50,70,100].map(function(v){return `<option value="${v}" ${Number(s.real_multi_percent)===v?"selected":""}>${v}%</option>`}).join("")}</select><span class="muted" id="realMultiPreview">${realMultiCount(Number(s.multi_question_count||0),Number(s.real_multi_percent||50))} / ${Number(s.multi_question_count||0)} câu</span></label><label>Số lần thi tối đa<select name="max_attempts">${[1,2,3,4,5].map(function(v){return `<option value="${v}" ${Number(s.real_max_attempts)===v?"selected":""}>${v}</option>`}).join("")}</select></label></div><div class="grid two"><label>Ngày giờ bắt đầu<input name="start_at" type="datetime-local" value="${esc(s.real_start_at||"")}"></label><label>Ngày giờ kết thúc<input name="end_at" type="datetime-local" value="${esc(s.real_end_at||"")}"></label></div><div class="scoring-field-row"><label>Cách tính điểm<select name="scoring_method" onchange="updateScoringTooltip(this.value)"><option value="1" ${Number(s.real_scoring_method||1)===1?"selected":""}>Cách tính điểm 1</option><option value="2" ${Number(s.real_scoring_method||1)===2?"selected":""}>Cách tính điểm 2</option></select></label><div class="scoring-help"><button type="button" class="scoring-help-button" aria-label="Xem chi tiết cách tính điểm" aria-expanded="false" onclick="toggleScoringTooltip(this)">?</button><div class="scoring-tooltip" role="tooltip">${scoringTooltipHtml(Number(s.real_scoring_method||1))}</div></div></div><div class="actions"><button class="primary">Lưu</button><button type="button" onclick="closeModal()">Hủy</button></div></form>`);'+
    '}'+
    'function scoringTooltipHtml(value){return Number(value)===2?`<b>Cách tính điểm 2</b><span>95 điểm theo tỷ lệ câu đúng tuyệt đối; câu nhiều đáp án phải đúng toàn bộ. 5 điểm theo tốc độ. Không tính quy mô đề hoặc đúng giờ.</span>`:`<b>Cách tính điểm 1</b><span>75 điểm kiến thức có tính gần đúng; 10 điểm quy mô đề; 10 điểm tốc độ; 5 điểm đúng giờ.</span>`}'+
    'function updateScoringTooltip(value){var tooltip=$(".scoring-tooltip");if(tooltip)tooltip.innerHTML=scoringTooltipHtml(value)}'+
    'function toggleScoringTooltip(button){var help=button.closest(".scoring-help");var open=help.classList.toggle("open");button.setAttribute("aria-expanded",String(open))}'+
    'document.addEventListener("click",function(event){if(event.target.closest(".scoring-help"))return;document.querySelectorAll(".scoring-help.open").forEach(function(help){help.classList.remove("open");var button=help.querySelector("button");if(button)button.setAttribute("aria-expanded","false")})});'+
    'function updateRealMultiPreview(total,percent){var el=$("#realMultiPreview");if(el)el.textContent=realMultiCount(total,Number(percent))+" / "+total+" câu"}'+
    'async function saveRealExam(event,id){event.preventDefault();var f=new FormData(event.target);await api("/api/spaces/"+id+"/real-exam",{method:"PUT",body:JSON.stringify({enabled:f.has("enabled"),scoring_method:Number(f.get("scoring_method")),question_percent:Number(f.get("question_percent")),timer_seconds:Number(f.get("timer_seconds")),multi_percent:Number(f.get("multi_percent")),max_attempts:Number(f.get("max_attempts")),start_at:f.get("start_at"),end_at:f.get("end_at")})});closeModal();await renderSpaces($("#view"))}'+
    'function openCsv(id){openModal(`<div class="grid"><h2>Upload CSV</h2><p class="muted">CSV mới sẽ được nối thêm vào ngân hàng câu hỏi hiện tại.</p><input id="csvFile" type="file" accept=".csv,text/csv"><div id="csvResult" class="muted"></div><div class="actions"><button class="primary" onclick="previewCsv(${id})">Preview</button><button onclick="confirmCsv(${id})">Xác nhận thêm dữ liệu</button><button class="danger" onclick="deleteAllQuestions(${id})">Xóa toàn bộ câu hỏi</button><button onclick="closeModal()">Đóng</button></div></div>`)}'+
    'async function deleteAllQuestions(id){if(!confirm("Xóa toàn bộ dữ liệu câu hỏi của Space này? Thao tác không thể hoàn tác."))return;var data=await api("/api/spaces/"+id+"/questions",{method:"DELETE"});toast("Đã xóa "+data.deleted+" câu hỏi.");closeModal();await renderSpaces($("#view"))}'+
    'async function previewCsv(id){'+
      'var file=$("#csvFile").files[0];'+
      'if(!file)return toast("Chọn file CSV trước.",true);'+
      'var body=new FormData();body.append("file",file);'+
      'var response=await fetch("/api/spaces/"+id+"/csv/preview",{method:"POST",body});'+
      'var data=await response.json();'+
      'if(!response.ok){$("#csvResult").innerHTML=(data.errors||[]).map(function(e){return"Dòng "+e.row+": "+esc(e.message)}).join("<br>");return}'+
      '$("#csvResult").innerHTML="Hợp lệ: "+data.count+" câu.<br>"+data.sample.map(function(q){return esc(q.content)}).join("<br>");'+
    '}'+
    'async function confirmCsv(id){'+
      'try{'+
        'await api("/api/spaces/"+id+"/csv/confirm",{method:"POST"});'+
        'closeModal();'+
        'await renderSpaces($("#view"));'+ 
      '}catch(error){'+
        '$("#csvResult").innerHTML=`<span class="status-bad">${esc(error.error||"Chưa có preview hợp lệ để xác nhận.")}</span>`;'+
      '}'+
    '}'+
    'async function generateSpace(id){try{await api("/api/spaces/"+id+"/generate",{method:"POST"});toast("Đã Generate.");loadView()}catch(e){toast(e.error||"Generate lỗi.",true)}}'+
    'async function exportDeploy(){var data=await api("/api/export",{method:"POST"});toast("Đã xuất: "+data.zipPath);loadView()}'+
    'async function changePassword(){var cur=$("#curPass").value,next=$("#newPass").value;if(!cur||!next)return toast("Nhập đủ mật khẩu.",true);await api("/api/change-password",{method:"POST",body:JSON.stringify({current_hash:await sha(cur),new_hash:await sha(next)})});toast("Đã đổi mật khẩu.")}'+
    'function esc(value){return String(value??"").replace(/[&<>"\\x27]/g,function(ch){var m={"&":"&amp;","<":"&lt;",">":"&gt;","\\x22":"&quot;","\\x27":"&#39;"};return m[ch]||ch})};'+
    'bootstrap();'+
    '</'+'script>';

  return '<!doctype html>\n<html lang="vi">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>mquiz Admin</title>\n  '+styles+'\n</head>\n<body>\n<div id="root"></div>\n<div id="modal" class="modal"></div>\n'+scripts+'\n</body>\n</html>';
}
