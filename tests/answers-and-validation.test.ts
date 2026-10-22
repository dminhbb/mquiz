import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeAnswer,
  parseSelectedLetters,
  sameAnswer
} from "../supabase/functions/_shared/answers.ts";
import { AppError } from "../supabase/functions/_shared/http.ts";
import {
  normalizeStudentName,
  requireIdList,
  requirePositiveInt,
  requireString,
  studentNameKey
} from "../supabase/functions/_shared/validation.ts";

describe("answers", () => {
  it("normalizes to unique sorted strings and ignores non-arrays", () => {
    assert.deepEqual(normalizeAnswer(["C", "A", "A"]), ["A", "C"]);
    assert.deepEqual(normalizeAnswer(null), []);
    assert.deepEqual(normalizeAnswer("A"), []);
  });

  it("compares answers exactly", () => {
    assert.equal(sameAnswer(["A", "B"], ["A", "B"]), true);
    assert.equal(sameAnswer(["A"], ["A", "B"]), false);
    assert.equal(sameAnswer([], []), true);
  });

  it("only accepts arrays of single capital letters", () => {
    assert.deepEqual(parseSelectedLetters(["B", "A"]), ["A", "B"]);
    assert.equal(parseSelectedLetters(["a"]), null);
    assert.equal(parseSelectedLetters(["AB"]), null);
    assert.equal(parseSelectedLetters([1]), null);
    assert.equal(parseSelectedLetters("A"), null);
    assert.equal(parseSelectedLetters(new Array(27).fill("A")), null);
  });
});

describe("validation", () => {
  it("requireString trims and enforces the length limit", () => {
    assert.equal(requireString("  abc ", "Tên", 10), "abc");
    assert.throws(() => requireString("", "Tên", 10), AppError);
    assert.throws(() => requireString("x".repeat(11), "Tên", 10), AppError);
    assert.throws(() => requireString(5, "Tên", 10), AppError);
  });

  it("requirePositiveInt rejects non-numbers, zero, negatives and floats", () => {
    assert.equal(requirePositiveInt(7, "Mã"), 7);
    for (const bad of ["7", 0, -1, 1.5, Number.NaN, null]) {
      assert.throws(() => requirePositiveInt(bad, "Mã"), AppError);
    }
  });

  it("requireIdList rejects duplicates, bad items and empty lists unless allowed", () => {
    assert.deepEqual(requireIdList([3, 1, 2], "Ids"), [3, 1, 2]);
    assert.throws(() => requireIdList([1, 1], "Ids"), AppError);
    assert.throws(() => requireIdList(["1"], "Ids"), AppError);
    assert.throws(() => requireIdList([-1], "Ids"), AppError);
    assert.throws(() => requireIdList([], "Ids"), AppError);
    assert.deepEqual(requireIdList([], "Ids", true), []);
  });

  it("derives the same student key as the browser", () => {
    assert.equal(normalizeStudentName("  Nguyễn   Văn  A "), "Nguyễn Văn A");
    assert.equal(studentNameKey("  Nguyễn   Văn  A "), "nguyễn văn a");
  });
});
