const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const errors = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function requireText(relativePath, pattern, message) {
  if (!pattern.test(read(relativePath))) errors.push(`${relativePath}: ${message}`);
}

const templateFiles = [
  "frontend/index.html",
  "frontend/assets/app.js",
  "cloud-admin/index.html",
  "cloud-admin/admin.js"
];

for (const relativePath of templateFiles) {
  const source = read(relativePath);
  const literalColor = /(?:color|background(?:-color)?|border-color)\s*:\s*#[0-9a-f]{3,8}/i;
  if (literalColor.test(source)) errors.push(`${relativePath}: use a semantic color token instead of a literal color`);

  const inlineStyles = [...source.matchAll(/style="([^"]+)"/g)].map((match) => match[1]);
  for (const style of inlineStyles) {
    if (!/^--[a-z0-9-]+\s*:/i.test(style)) {
      errors.push(`${relativePath}: inline presentation style is not allowed (${style})`);
    }
  }
}

for (const relativePath of ["frontend/assets/style.css", "cloud-admin/admin.css"]) {
  const source = read(relativePath);
  if (/transition\s*:\s*all\b/i.test(source)) errors.push(`${relativePath}: transition: all is not allowed`);

  const marker = "/* mquiz system overrides */";
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    errors.push(`${relativePath}: missing governed override marker`);
    continue;
  }

  const governed = source.slice(markerIndex + marker.length);
  if (/#[0-9a-f]{3,8}\b/i.test(governed) || /rgba?\s*\(/i.test(governed)) {
    errors.push(`${relativePath}: governed overrides must use semantic design tokens, not literal colors`);
  }
}

requireText("frontend/index.html", /class="skip-link"/, "missing skip link");
requireText("cloud-admin/index.html", /class="skip-link"/, "missing skip link");
requireText("frontend/index.html", /design-system\.css/, "shared design system is not loaded");
requireText("cloud-admin/index.html", /design-system\.css/, "shared design system is not loaded");
requireText(".interface-design/system.md", /Focused assessment workspace/, "design direction is missing");

if (errors.length) {
  console.error("Design-system check failed:\n");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log("Design-system check passed.");

