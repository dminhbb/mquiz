const path = require("path");
const {
  createTimestampAppVersion,
  updateHtmlVersionFile,
  validateAppVersion,
  writeAppVersionFlag
} = require("../backend/src/app-version");

const projectRoot = path.resolve(__dirname, "..");
const versionFilePath = path.join(projectRoot, "frontend", "app-version.json");
const htmlFilePaths = [
  path.join(projectRoot, "frontend", "index.html"),
  path.join(projectRoot, "cloud-admin", "index.html")
];

/** @returns {string} */
function main() {
  const requestedVersion = String(process.argv[2] || createTimestampAppVersion()).trim();
  if (!validateAppVersion(requestedVersion)) {
    throw new Error("Version chỉ được chứa chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.");
  }

  htmlFilePaths.forEach((filePath) => {
    updateHtmlVersionFile(filePath, requestedVersion);
  });
  writeAppVersionFlag(versionFilePath, requestedVersion);
  process.stdout.write(`Đã cập nhật app version: ${requestedVersion}\n`);
}

main();
