const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "dist");

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, { recursive: true });
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
copyDirectory(path.join(projectRoot, "frontend"), outputDir);
fs.rmSync(path.join(outputDir, "_redirects"), { force: true });
copyDirectory(path.join(projectRoot, "cloud-admin"), path.join(outputDir, "admin"));

process.stdout.write("Build static hoàn tất: dist/\n");
