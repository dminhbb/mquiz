const js = require("@eslint/js");
const globals = require("globals");

const sharedRules = {
  eqeqeq: ["error", "always"],
  "no-var": "error",
  "prefer-const": "error",
  "no-empty": ["error", { allowEmptyCatch: false }],
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }]
};

module.exports = [
  {
    ignores: [
      "dist/**",
      "dist-cloudflare/**",
      "_site/**",
      "node_modules/**",
      ".agents/**",
      ".claude/**",
      ".github/skills/**"
    ]
  },
  js.configs.recommended,
  {
    // Browser SPAs written as IIFEs (see AGENTS.md); libraries come from CDN <script> tags.
    files: ["frontend/assets/**/*.js", "cloud-admin/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        supabase: "readonly",
        Papa: "readonly",
        QRCode: "readonly",
        XLSX: "readonly",
        lucide: "readonly",
        __SQ_BASE_PATH__: "writable",
        __SQ_SUPABASE__: "writable"
      }
    },
    rules: sharedRules
  },
  {
    files: ["scripts/**/*.js", "eslint.config.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
    rules: { ...sharedRules, "no-console": "off" }
  }
];
