const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const { dbPath, initialSuperadmin } = require("./config");
const { sha256 } = require("./crypto-utils");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fullname TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT CHECK(role IN ('superadmin','admin')) NOT NULL,
      active INTEGER DEFAULT 1,
      reset_password INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS spaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      timer_seconds INTEGER NOT NULL DEFAULT 60,
      exam_start_time TEXT,
      allowed_late_minutes INTEGER NOT NULL DEFAULT 30,
      real_exam_enabled INTEGER NOT NULL DEFAULT 0,
      real_question_percent INTEGER NOT NULL DEFAULT 50,
      real_timer_seconds INTEGER NOT NULL DEFAULT 60,
      real_multi_percent INTEGER NOT NULL DEFAULT 50,
      real_max_attempts INTEGER NOT NULL DEFAULT 1,
      real_scoring_method INTEGER NOT NULL DEFAULT 1,
      real_exam_version TEXT,
      real_start_at TEXT,
      real_end_at TEXT,
      data_token TEXT,
      key_token TEXT,
      key_salt TEXT,
      dirty INTEGER DEFAULT 1,
      generated_at TEXT,
      exported_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_space (
      admin_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      space_id INTEGER REFERENCES spaces(id) ON DELETE CASCADE,
      PRIMARY KEY (admin_id, space_id)
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id INTEGER REFERENCES spaces(id) ON DELETE CASCADE,
      order_no INTEGER NOT NULL,
      type TEXT CHECK(type IN ('single','multi')) NOT NULL,
      content TEXT NOT NULL,
      options_json TEXT NOT NULL,
      correct_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id INTEGER REFERENCES spaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(space_id, name)
    );
  `);

  const spaceColumns = new Set(db.prepare("PRAGMA table_info(spaces)").all().map((column) => column.name));
  if (!spaceColumns.has("exam_start_time")) {
    db.prepare("ALTER TABLE spaces ADD COLUMN exam_start_time TEXT").run();
  }
  if (!spaceColumns.has("allowed_late_minutes")) {
    db.prepare("ALTER TABLE spaces ADD COLUMN allowed_late_minutes INTEGER NOT NULL DEFAULT 30").run();
  }
  const realExamColumns = [
    ["real_exam_enabled", "INTEGER NOT NULL DEFAULT 0"],
    ["real_question_percent", "INTEGER NOT NULL DEFAULT 50"],
    ["real_timer_seconds", "INTEGER NOT NULL DEFAULT 60"],
    ["real_multi_percent", "INTEGER NOT NULL DEFAULT 50"],
    ["real_max_attempts", "INTEGER NOT NULL DEFAULT 1"],
    ["real_scoring_method", "INTEGER NOT NULL DEFAULT 1"],
    ["real_exam_version", "TEXT"],
    ["real_start_at", "TEXT"],
    ["real_end_at", "TEXT"]
  ];
  realExamColumns.forEach(([name, definition]) => {
    if (!spaceColumns.has(name)) db.prepare(`ALTER TABLE spaces ADD COLUMN ${name} ${definition}`).run();
  });
  db.prepare("UPDATE spaces SET real_exam_version = lower(hex(randomblob(16))) WHERE real_exam_version IS NULL").run();

  db.prepare(`
    INSERT OR IGNORE INTO groups (space_id, name)
    SELECT id, name
    FROM spaces
    WHERE NOT EXISTS (
      SELECT 1 FROM groups WHERE groups.space_id = spaces.id
    )
  `).run();

  const count = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'superadmin'").get().count;
  if (!count) {
    const clientHash = sha256(initialSuperadmin.password);
    const passwordHash = bcrypt.hashSync(clientHash, 12);
    db.prepare(`
      INSERT INTO users (fullname, username, password_hash, role, active, reset_password)
      VALUES (?, ?, ?, 'superadmin', 1, 0)
    `).run(initialSuperadmin.fullname, initialSuperadmin.username, passwordHash);
  }
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    fullname: user.fullname,
    username: user.username,
    role: user.role,
    active: Boolean(user.active),
    reset_password: Boolean(user.reset_password)
  };
}

function getAssignedSpaceIds(userId) {
  return db.prepare("SELECT space_id FROM admin_space WHERE admin_id = ?").all(userId).map((row) => row.space_id);
}

function canAccessSpace(user, spaceId) {
  if (!user) return false;
  if (user.role === "superadmin") return true;
  return Boolean(db.prepare("SELECT 1 FROM admin_space WHERE admin_id = ? AND space_id = ?").get(user.id, spaceId));
}

function markSpaceDirty(spaceId) {
  db.prepare("UPDATE spaces SET dirty = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(spaceId);
}

function listSpacesForUser(user) {
  if (user.role === "superadmin") {
    return db.prepare(`
      SELECT s.*, COUNT(q.id) AS question_count,
        SUM(CASE WHEN q.type = 'multi' THEN 1 ELSE 0 END) AS multi_question_count
      FROM spaces s
      LEFT JOIN questions q ON q.space_id = s.id
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `).all();
  }
  return db.prepare(`
    SELECT s.*, COUNT(q.id) AS question_count,
      SUM(CASE WHEN q.type = 'multi' THEN 1 ELSE 0 END) AS multi_question_count
    FROM spaces s
    JOIN admin_space asp ON asp.space_id = s.id
    LEFT JOIN questions q ON q.space_id = s.id
    WHERE asp.admin_id = ?
    GROUP BY s.id
    ORDER BY s.updated_at DESC
  `).all(user.id);
}

module.exports = {
  db,
  initDb,
  publicUser,
  getAssignedSpaceIds,
  canAccessSpace,
  markSpaceDirty,
  listSpacesForUser
};
