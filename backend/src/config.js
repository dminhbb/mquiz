const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

module.exports = {
  rootDir: ROOT,
  frontendDir: path.join(ROOT, "frontend"),
  cloudAdminDir: path.join(ROOT, "cloud-admin"),
  distDir: path.join(ROOT, "backend", "dist"),
  exportDir: path.join(ROOT, "backend", "export"),
  uploadDir: path.join(ROOT, "backend", "uploads"),
  dbPath: path.join(ROOT, "backend", "data", "simple-quiz.sqlite"),
  sessionSecret: process.env.SQ_SESSION_SECRET || "simple-quiz-local-session-secret",
  port: Number(process.env.PORT || 3000),
  initialSuperadmin: {
    fullname: process.env.SQ_SUPERADMIN_NAME || "Super Admin",
    username: process.env.SQ_SUPERADMIN_USER || "superadmin",
    password: process.env.SQ_SUPERADMIN_PASSWORD || "admin123"
  }
};
