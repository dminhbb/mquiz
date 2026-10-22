/** Input validators for untrusted request bodies. They throw AppError(400) on bad input. */
import { AppError } from "./http.ts";

const MAX_ID_LIST_LENGTH = 500;

export function requireString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new AppError(`${label} không hợp lệ.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) throw new AppError(`${label} không hợp lệ.`);
  return trimmed;
}

export function requirePositiveInt(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(`${label} không hợp lệ.`);
  return parsed;
}

/** Array of unique non-negative integers (question ids / question set ids). */
export function requireIdList(value: unknown, label: string, allowEmpty = false): number[] {
  if (!Array.isArray(value) || value.length > MAX_ID_LIST_LENGTH) {
    throw new AppError(`${label} không hợp lệ.`);
  }
  if (value.length === 0 && !allowEmpty) throw new AppError(`${label} không hợp lệ.`);
  const ids = value.map((item) => (typeof item === "number" ? item : Number.NaN));
  if (!ids.every((id) => Number.isSafeInteger(id) && id >= 0)) {
    throw new AppError(`${label} không hợp lệ.`);
  }
  if (new Set(ids).size !== ids.length) throw new AppError(`${label} bị trùng lặp.`);
  return ids;
}

export function normalizeStudentName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Matches the browser-side key used for leaderboards and attempt limits. */
export function studentNameKey(value: string): string {
  return normalizeStudentName(value).toLocaleLowerCase("vi-VN");
}
