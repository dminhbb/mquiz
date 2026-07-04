const crypto = require("crypto");

function sha256(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function randomToken(bytes = 8) {
  return crypto.randomBytes(bytes).toString("hex");
}

function normalizeLetters(letters) {
  return [...new Set((letters || []).map((letter) => String(letter).trim().toUpperCase()).filter(Boolean))].sort();
}

function answerHash(letters, salt) {
  return sha256(`${normalizeLetters(letters).join(",")}${salt}`);
}

module.exports = { sha256, randomToken, normalizeLetters, answerHash };
