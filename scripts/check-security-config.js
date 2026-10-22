/**
 * Guards the static security configuration: pinned and integrity-checked CDN scripts,
 * required security headers, and no privileged secrets in browser-facing files.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const errors = [];

/** @param {string} relativePath */
function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const htmlFiles = ["frontend/index.html", "cloud-admin/index.html"];
const PINNED_VERSION = /@\d+\.\d+\.\d+(?:[/"]|$)/;

for (const relativePath of htmlFiles) {
  const tags = [...read(relativePath).matchAll(/<script\b[^>]*\bsrc="(https?:\/\/[^"]+)"[^>]*>/g)];
  for (const [tag, url] of tags) {
    if (!PINNED_VERSION.test(url))
      errors.push(`${relativePath}: CDN script is not pinned to an exact version (${url})`);
    if (!/\bintegrity="sha384-[A-Za-z0-9+/=]+"/.test(tag))
      errors.push(`${relativePath}: CDN script has no SRI integrity hash (${url})`);
    if (!/\bcrossorigin="anonymous"/.test(tag))
      errors.push(`${relativePath}: CDN script needs crossorigin="anonymous" (${url})`);
  }
}

const headers = read("frontend/_headers");
const requiredHeaders = [
  "Content-Security-Policy",
  "X-Content-Type-Options: nosniff",
  "Referrer-Policy: strict-origin-when-cross-origin",
  "X-Frame-Options: DENY"
];
for (const header of requiredHeaders) {
  if (!headers.includes(header)) errors.push(`frontend/_headers: missing ${header}`);
}
if (/script-src[^;]*'unsafe-(inline|eval)'/.test(headers)) {
  errors.push("frontend/_headers: script-src must not allow unsafe-inline or unsafe-eval");
}

const configSource = read("frontend/assets/supabase-config.js");
const supabaseUrl = (configSource.match(/url:\s*"([^"]+)"/) || [])[1];
if (!supabaseUrl) errors.push("frontend/assets/supabase-config.js: Supabase URL not found");
else if (!headers.includes(new URL(supabaseUrl).origin)) {
  errors.push(
    `frontend/_headers: connect-src must allow the Supabase origin ${new URL(supabaseUrl).origin}`
  );
}
if (/service[_-]?role|sb_secret_/i.test(configSource)) {
  errors.push("frontend/assets/supabase-config.js: must only contain the publishable key");
}

const browserSources = ["frontend/assets/app.js", "cloud-admin/admin.js"];
for (const relativePath of browserSources) {
  if (/SERVICE_ROLE|sb_secret_/.test(read(relativePath))) {
    errors.push(`${relativePath}: privileged key reference found in browser code`);
  }
  if (/\.from\(["']quiz_attempts["']\)\s*\.insert/.test(read(relativePath))) {
    errors.push(
      `${relativePath}: results must be saved by the quiz-attempt function, not inserted directly`
    );
  }
}

if (errors.length) {
  console.error("Security config check failed:\n");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log("Security config check passed.");
