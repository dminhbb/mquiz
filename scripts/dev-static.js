const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "dist");
const port = Number(process.env.PORT || 8787);
const watchedRoots = [
  path.join(projectRoot, "frontend"),
  path.join(projectRoot, "cloud-admin")
];
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function build() {
  execFileSync(process.execPath, [path.join(__dirname, "build-static.js")], {
    cwd: projectRoot,
    stdio: "inherit"
  });
}

function watchDirectory(directory, onChange) {
  const watcher = fs.watch(directory, onChange);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) watchDirectory(path.join(directory, entry.name), onChange);
  }
  return watcher;
}

function resolveFile(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(outputDir, relativePath);
  if (!candidate.startsWith(`${outputDir}${path.sep}`) && candidate !== outputDir) return null;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;

  const adminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  return adminRoute
    ? path.join(outputDir, "admin", "index.html")
    : path.join(outputDir, "index.html");
}

build();

let rebuildTimer = null;
const scheduleRebuild = () => {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    try {
      build();
      process.stdout.write("Đã cập nhật bản phát triển.\n");
    } catch (error) {
      process.stderr.write(`Build thất bại: ${error.message}\n`);
    }
  }, 120);
};
watchedRoots.forEach((directory) => watchDirectory(directory, scheduleRebuild));

http.createServer((request, response) => {
  let filePath;
  try {
    filePath = resolveFile(request.url || "/");
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  if (!filePath || !fs.existsSync(filePath)) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`mquiz đang chạy tại http://127.0.0.1:${port}\n`);
});
