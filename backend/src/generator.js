const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const { db } = require("./db");
const { frontendDir, cloudAdminDir, distDir, exportDir } = require("./config");
const { sha256, randomToken, answerHash } = require("./crypto-utils");
const { stampDeployAppVersion } = require("./app-version");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(source, target) {
  ensureDir(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDir(sourcePath, targetPath);
    else fs.copyFileSync(sourcePath, targetPath);
  }
}

function writeJsGlobal(filePath, globalName, value) {
  fs.writeFileSync(filePath, `window.${globalName} = ${JSON.stringify(value, null, 2)};\n`, "utf8");
}

function generateSpace(spaceId) {
  const space = db.prepare("SELECT * FROM spaces WHERE id = ?").get(spaceId);
  if (!space) throw new Error("Space không tồn tại.");
  const questions = db.prepare("SELECT * FROM questions WHERE space_id = ? ORDER BY order_no ASC, id ASC").all(spaceId);
  if (!questions.length) throw new Error("Space chưa có câu hỏi.");
  const groups = db.prepare("SELECT name FROM groups WHERE space_id = ? ORDER BY name COLLATE NOCASE").all(spaceId);
  if (!groups.length) throw new Error("Space phải có ít nhất 1 group.");

  ensureDir(distDir);
  copyDir(frontendDir, distDir);
  copyDir(cloudAdminDir, path.join(distDir, "admin"));
  ensureDir(path.join(distDir, "data"));

  const dataToken = randomToken(8);
  const keySalt = randomToken(16);
  const keyToken = sha256(`${dataToken}${keySalt}`);

  const publicQuestions = questions.map((question) => {
    const correct = JSON.parse(question.correct_json);
    const salt = randomToken(8);
    return {
      id: question.id,
      type: question.type,
      content: question.content,
      options: JSON.parse(question.options_json),
      salt,
      check: answerHash(correct, salt)
    };
  });

  const keyAnswers = {};
  questions.forEach((question) => {
    keyAnswers[question.id] = JSON.parse(question.correct_json);
  });

  writeJsGlobal(path.join(distDir, "data", `${dataToken}.data.js`), "__SQ_SPACE__", {
    name: space.name,
    timer_seconds: space.timer_seconds,
    exam_start_time: space.exam_start_time || null,
    allowed_late_minutes: Number(space.allowed_late_minutes || 30),
    real_exam: {
      enabled: Boolean(space.real_exam_enabled),
      scoring_method: Number(space.real_scoring_method || 1),
      question_percent: Number(space.real_question_percent || 50),
      timer_seconds: Number(space.real_timer_seconds || 60),
      multi_percent: Number(space.real_multi_percent || 50),
      max_attempts: Number(space.real_max_attempts || 1),
      version: space.real_exam_version,
      start_at: space.real_start_at || null,
      end_at: space.real_end_at || null
    },
    groups: groups.map((group) => group.name),
    data_token: dataToken,
    key_salt: keySalt,
    questions: publicQuestions
  });

  writeJsGlobal(path.join(distDir, "data", `${keyToken}.key.js`), "__SQ_ANSWERS__", {
    data_token: dataToken,
    answers: keyAnswers
  });

  db.prepare(`
    UPDATE spaces
    SET data_token = ?, key_token = ?, key_salt = ?, dirty = 0, generated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(dataToken, keyToken, keySalt, spaceId);

  rebuildIndex();
  return { dataToken, keyToken };
}

function rebuildIndex() {
  ensureDir(path.join(distDir, "data"));
  const spaces = db.prepare("SELECT slug, data_token FROM spaces WHERE data_token IS NOT NULL").all();
  const index = {};
  spaces.forEach((space) => {
    index[sha256(space.slug)] = space.data_token;
  });
  writeJsGlobal(path.join(distDir, "data", "index.enc.js"), "__SQ_INDEX__", index);
}

function exportDeployZip() {
  copyDir(frontendDir, distDir);
  copyDir(cloudAdminDir, path.join(distDir, "admin"));
  stampDeployAppVersion(distDir);
  rebuildIndex();
  ensureDir(exportDir);
  const zipPath = path.join(exportDir, `simple-quiz-deploy-${Date.now()}.zip`);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on("close", () => {
      db.prepare("UPDATE spaces SET exported_at = CURRENT_TIMESTAMP WHERE data_token IS NOT NULL").run();
      resolve(zipPath);
    });
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(distDir, false);
    archive.finalize();
  });
}

module.exports = { generateSpace, rebuildIndex, exportDeployZip, copyDir };
