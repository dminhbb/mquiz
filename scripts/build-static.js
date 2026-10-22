const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const USAGE = "Usage: node scripts/build-static.js [--out <dir>] [--keep-redirects] [--spa-404]";

/**
 * @typedef {object} BuildOptions
 * @property {string} outputDir Absolute output directory (recreated on every build).
 * @property {boolean} keepRedirects Keep `_redirects` for hosts that read it (Netlify, Cloudflare Pages upload).
 * @property {boolean} spa404 Add `404.html` and `.nojekyll` so GitHub Pages serves the SPA shell.
 */

/**
 * @param {string[]} argv Command-line arguments after the script name.
 * @returns {BuildOptions}
 */
function parseArguments(argv) {
  const options = {
    outputDir: path.join(projectRoot, "dist"),
    keepRedirects: false,
    spa404: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out") {
      const value = argv[index + 1];
      if (!value) throw new Error(`--out needs a directory. ${USAGE}`);
      options.outputDir = path.resolve(projectRoot, value);
      index += 1;
    } else if (argument === "--keep-redirects") {
      options.keepRedirects = true;
    } else if (argument === "--spa-404") {
      options.spa404 = true;
    } else {
      throw new Error(`Unknown argument "${argument}". ${USAGE}`);
    }
  }
  return options;
}

/**
 * Builds the static site: `frontend/` becomes the site root and `cloud-admin/` becomes `/admin/`.
 *
 * @param {BuildOptions} options
 * @returns {void}
 */
function build(options) {
  const { outputDir } = options;
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.cpSync(path.join(projectRoot, "frontend"), outputDir, { recursive: true });
  if (!options.keepRedirects) fs.rmSync(path.join(outputDir, "_redirects"), { force: true });
  fs.cpSync(path.join(projectRoot, "cloud-admin"), path.join(outputDir, "admin"), {
    recursive: true
  });
  if (options.spa404) {
    fs.copyFileSync(path.join(outputDir, "index.html"), path.join(outputDir, "404.html"));
    fs.writeFileSync(path.join(outputDir, ".nojekyll"), "");
  }
}

try {
  const options = parseArguments(process.argv.slice(2));
  build(options);
  process.stdout.write(
    `Build static hoàn tất: ${path.relative(projectRoot, options.outputDir) || "."}/\n`
  );
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
