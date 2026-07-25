const fs = require("fs");
const path = require("path");

function createTimestampAppVersion() {
  return new Date().toISOString().replace(/[-:T]/g, ".").replace(/\.\d{3}Z$/, "Z");
}

function validateAppVersion(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

function updateHtmlVersion(html, version) {
  if (!validateAppVersion(version)) throw new Error("App version không hợp lệ.");
  const metaVersionPattern = /(<meta name="app-version" content=")[^"]+(">)/;
  if (!metaVersionPattern.test(html)) {
    throw new Error("Không tìm thấy app-version meta tag trong HTML.");
  }
  const withMetaVersion = html.replace(metaVersionPattern, `$1${version}$2`);
  return withMetaVersion.replace(/(\.(?:css|js)\?v=)[A-Za-z0-9._-]+/g, `$1${version}`);
}

function updateHtmlVersionFile(filePath, version) {
  const html = fs.readFileSync(filePath, "utf8");
  fs.writeFileSync(filePath, updateHtmlVersion(html, version), "utf8");
}

function writeAppVersionFlag(filePath, version) {
  if (!validateAppVersion(version)) throw new Error("App version không hợp lệ.");
  fs.writeFileSync(filePath, `${JSON.stringify({ version }, null, 2)}\n`, "utf8");
}

module.exports = {
  createTimestampAppVersion,
  updateHtmlVersion,
  updateHtmlVersionFile,
  validateAppVersion,
  writeAppVersionFlag
};
