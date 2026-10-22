/** Answer-letter helpers shared by the quiz Edge Functions. */

/** Letters accepted as option keys (A-Z); question options are stored with these keys. */
const OPTION_LETTER_PATTERN = /^[A-Z]$/;
const MAX_SELECTED_LETTERS = 26;

/** Returns the unique, sorted, string form of an answer list; anything else becomes []. */
export function normalizeAnswer(value: unknown): string[] {
  return [...new Set(Array.isArray(value) ? value.map(String) : [])].sort();
}

/** True when both answer lists contain exactly the same letters, in the same order. */
export function sameAnswer(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Validates untrusted selected letters: must be an array of single letters A-Z.
 * Returns null when the input is malformed.
 */
export function parseSelectedLetters(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SELECTED_LETTERS) return null;
  if (!value.every((item) => typeof item === "string" && OPTION_LETTER_PATTERN.test(item))) {
    return null;
  }
  return normalizeAnswer(value);
}
