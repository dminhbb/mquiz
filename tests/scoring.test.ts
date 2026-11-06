import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calcQuestionCount,
  calculateAttemptScore,
  calculatePunctualityScore,
  UNLIMITED_TIMER_REFERENCE_SECONDS,
  UNLIMITED_TIMER_SECONDS
} from "../supabase/functions/_shared/scoring.ts";
import type { ScoringInput, ScoringQuestion } from "../supabase/functions/_shared/scoring.ts";

interface LegacyInput {
  questions: readonly ScoringQuestion[];
  selections: Record<number, string[]>;
  scoringMethod: 1 | 2;
  bankQuestionCount: number;
  durationSeconds: number;
  timerSeconds: number;
  punctualityScore: number;
}

/**
 * Independent reference implementation: the browser-side calculateCompositeScore() that was
 * removed from frontend/assets/app.js, plus the 2026-11 rule that coverage, duration and
 * punctuality are scaled by the share answered correctly (a blank submission scores 0).
 */
function legacyCompositeScore(input: LegacyInput) {
  const roundScore = (value: number) => Math.round(value * 100) / 100;
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  let earnedWeight = 0;
  let totalWeight = 0;
  let multiCorrectCount = 0;
  let multiSimilarityScore = 0;
  const scoringMethod = input.scoringMethod;
  input.questions.forEach((question) => {
    const selected = new Set(input.selections[question.id] || []);
    const correct = new Set(question.correct);
    const isMulti = question.type === "multi";
    const weight =
      scoringMethod === 2 ? 1 : isMulti ? Math.min(2, 1 + 0.25 * Math.max(0, correct.size - 1)) : 1;
    let similarity = 0;
    if (isMulti) {
      const truePositive = [...selected].filter((letter) => correct.has(letter)).length;
      const falsePositive = [...selected].filter((letter) => !correct.has(letter)).length;
      const falseNegative = [...correct].filter((letter) => !selected.has(letter)).length;
      const denominator = 2 * truePositive + falsePositive + falseNegative;
      similarity =
        scoringMethod === 2
          ? falsePositive === 0 && falseNegative === 0
            ? 1
            : 0
          : denominator
            ? (2 * truePositive) / denominator
            : 0;
      multiSimilarityScore += similarity;
      if (falsePositive === 0 && falseNegative === 0) multiCorrectCount += 1;
    } else {
      similarity =
        selected.size === correct.size && [...selected].every((letter) => correct.has(letter))
          ? 1
          : 0;
    }
    earnedWeight += similarity * weight;
    totalWeight += weight;
  });
  const totalQuestions = input.questions.length;
  const maximumDuration = totalQuestions * input.timerSeconds;
  const minimumReasonableDuration = maximumDuration * 0.3;
  const correctCount = input.questions.filter((question) => {
    const selected = [...new Set(input.selections[question.id] || [])].sort();
    const correct = [...new Set(question.correct)].sort();
    return (
      selected.length === correct.length &&
      selected.every((letter, index) => letter === correct[index])
    );
  }).length;
  if (scoringMethod === 2) {
    const correctRatio = totalQuestions ? correctCount / totalQuestions : 0;
    const knowledgeScore = correctRatio * 95;
    const durationScore =
      maximumDuration > 0
        ? correctRatio *
          clamp(((maximumDuration - input.durationSeconds) / maximumDuration) * 5, 0, 5)
        : 0;
    return {
      score: Math.round(clamp(knowledgeScore + durationScore, 0, 100)),
      knowledgeScore: roundScore(knowledgeScore),
      coverageScore: 0,
      durationScore: roundScore(durationScore),
      punctualityScore: 0,
      multiCorrectCount,
      multiSimilarityScore: roundScore(multiSimilarityScore)
    };
  }
  const knowledgeRatio = totalWeight ? earnedWeight / totalWeight : 0;
  const knowledgeScore = totalWeight ? (75 * earnedWeight) / totalWeight : 0;
  const coverageScore = input.bankQuestionCount
    ? (knowledgeRatio * 10 * totalQuestions) / input.bankQuestionCount
    : 0;
  const durationScore =
    knowledgeRatio *
    (maximumDuration > minimumReasonableDuration
      ? 10 *
        clamp(
          (maximumDuration - input.durationSeconds) / (maximumDuration - minimumReasonableDuration),
          0,
          1
        )
      : 10);
  const punctualityScore = knowledgeRatio * clamp(input.punctualityScore, 0, 5);
  return {
    score: Math.round(
      clamp(knowledgeScore + coverageScore + durationScore + punctualityScore, 0, 100)
    ),
    knowledgeScore: roundScore(knowledgeScore),
    coverageScore: roundScore(coverageScore),
    durationScore: roundScore(durationScore),
    punctualityScore: roundScore(punctualityScore),
    multiCorrectCount,
    multiSimilarityScore: roundScore(multiSimilarityScore)
  };
}

const LETTERS = ["A", "B", "C", "D", "E"];

/** Deterministic pseudo-random generator so failures are reproducible. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function pickLetters(random: () => number, min: number): string[] {
  const picked = LETTERS.filter(() => random() < 0.45);
  while (picked.length < min) {
    const letter = LETTERS[Math.floor(random() * LETTERS.length)];
    if (!picked.includes(letter)) picked.push(letter);
  }
  return picked.sort();
}

function buildRandomInput(random: () => number, scoringMethod: 1 | 2): ScoringInput {
  const count = 5 + Math.floor(random() * 20);
  const questions: ScoringQuestion[] = [];
  const selections: Record<number, string[]> = {};
  for (let id = 1; id <= count; id += 1) {
    const isMulti = random() < 0.4;
    const correct = isMulti
      ? pickLetters(random, 2)
      : [LETTERS[Math.floor(random() * LETTERS.length)]];
    questions.push({ id, type: isMulti ? "multi" : "single", correct });
    const roll = random();
    if (roll < 0.35) selections[id] = [...correct];
    else if (roll < 0.8) selections[id] = pickLetters(random, 1);
  }
  const timerSeconds = [15, 30, 45, 60, 90, 120][Math.floor(random() * 6)];
  return {
    questions,
    selections,
    scoringMethod,
    bankQuestionCount: count + Math.floor(random() * 50),
    durationSeconds: Math.floor(random() * count * timerSeconds * 1.2),
    timerSeconds,
    punctualityScore: random() * 5
  };
}

describe("calculateAttemptScore", () => {
  it("matches the legacy client algorithm for both scoring methods", () => {
    const random = createRandom(20260722);
    for (let round = 0; round < 400; round += 1) {
      const scoringMethod = round % 2 === 0 ? 1 : 2;
      const input = buildRandomInput(random, scoringMethod);
      const expected = legacyCompositeScore(input);
      const actual = calculateAttemptScore(input);
      assert.equal(actual.score, expected.score, `score, round ${round}`);
      assert.equal(actual.knowledgeScore, expected.knowledgeScore, `knowledge, round ${round}`);
      assert.equal(actual.coverageScore, expected.coverageScore, `coverage, round ${round}`);
      assert.equal(actual.durationScore, expected.durationScore, `duration, round ${round}`);
      assert.equal(
        actual.punctualityScore,
        expected.punctualityScore,
        `punctuality, round ${round}`
      );
      assert.equal(
        actual.multiCorrectCount,
        expected.multiCorrectCount,
        `multiCorrect, round ${round}`
      );
      assert.equal(
        actual.multiSimilarityScore,
        expected.multiSimilarityScore,
        `multiSimilarity, round ${round}`
      );
    }
  });

  it("scores an all-correct, instant attempt as 100 with method 2 (95 + 5)", () => {
    const questions: ScoringQuestion[] = [1, 2, 3, 4, 5].map((id) => ({
      id,
      type: "single",
      correct: ["A"]
    }));
    const selections = Object.fromEntries(questions.map((question) => [question.id, ["A"]]));
    const result = calculateAttemptScore({
      questions,
      selections,
      scoringMethod: 2,
      bankQuestionCount: 5,
      durationSeconds: 0,
      timerSeconds: 60,
      punctualityScore: 0
    });
    assert.equal(result.score, 100);
    assert.equal(result.correctCount, 5);
    assert.equal(result.wrongCount, 0);
  });

  it("counts unanswered questions as wrong", () => {
    const questions: ScoringQuestion[] = [
      { id: 1, type: "single", correct: ["B"] },
      { id: 2, type: "multi", correct: ["A", "C"] }
    ];
    const result = calculateAttemptScore({
      questions,
      selections: {},
      scoringMethod: 1,
      bankQuestionCount: 2,
      durationSeconds: 10,
      timerSeconds: 30,
      punctualityScore: 5
    });
    assert.equal(result.correctCount, 0);
    assert.equal(result.wrongCount, 2);
    assert.deepEqual(result.correctness, { 1: false, 2: false });
    assert.equal(result.knowledgeScore, 0);
  });

  it("gives partial credit on multi-answer questions under method 1 only", () => {
    const questions: ScoringQuestion[] = [{ id: 1, type: "multi", correct: ["A", "B"] }];
    const base = {
      questions,
      selections: { 1: ["A"] },
      bankQuestionCount: 1,
      durationSeconds: 0,
      timerSeconds: 60,
      punctualityScore: 0
    };
    const partial = calculateAttemptScore({ ...base, scoringMethod: 1 });
    assert.ok(partial.knowledgeScore > 0 && partial.knowledgeScore < 75);
    assert.equal(partial.correctCount, 0);
    assert.equal(calculateAttemptScore({ ...base, scoringMethod: 2 }).knowledgeScore, 0);
  });

  it("never exceeds 100 even with an oversized punctuality input", () => {
    const questions: ScoringQuestion[] = [{ id: 1, type: "single", correct: ["A"] }];
    const result = calculateAttemptScore({
      questions,
      selections: { 1: ["A"] },
      scoringMethod: 1,
      bankQuestionCount: 1,
      durationSeconds: 0,
      timerSeconds: 60,
      punctualityScore: 999
    });
    assert.ok(result.score <= 100);
    assert.equal(result.punctualityScore, 5);
  });

  it("gives a blank, instant submission 0 points under both methods", () => {
    const questions: ScoringQuestion[] = [1, 2, 3, 4, 5].map((id) => ({
      id,
      type: "single",
      correct: ["A"]
    }));
    for (const scoringMethod of [1, 2] as const) {
      const result = calculateAttemptScore({
        questions,
        selections: {},
        scoringMethod,
        bankQuestionCount: 5,
        durationSeconds: 1,
        timerSeconds: 60,
        punctualityScore: 5
      });
      assert.equal(result.score, 0, `method ${scoringMethod}`);
      assert.equal(result.durationScore, 0);
      assert.equal(result.coverageScore, 0);
      assert.equal(result.punctualityScore, 0);
    }
  });

  it("scores the duration of an unlimited attempt as if each question had 300s", () => {
    const questions: ScoringQuestion[] = [
      { id: 1, type: "single", correct: ["A"] },
      { id: 2, type: "single", correct: ["B"] }
    ];
    for (const scoringMethod of [1, 2] as const) {
      const base = {
        questions,
        selections: { 1: ["A"], 2: ["B"] },
        scoringMethod,
        bankQuestionCount: 2,
        durationSeconds: 400,
        punctualityScore: 0
      };
      const unlimited = calculateAttemptScore({
        ...base,
        timerSeconds: UNLIMITED_TIMER_SECONDS
      });
      const reference = calculateAttemptScore({
        ...base,
        timerSeconds: UNLIMITED_TIMER_REFERENCE_SECONDS
      });
      assert.deepEqual(unlimited, reference);
      assert.ok(unlimited.durationScore > 0, "a 400s run over 2 x 300s still earns time points");
    }
  });
});

describe("calculatePunctualityScore", () => {
  it("returns full marks without a configured start time", () => {
    assert.equal(calculatePunctualityScore(null, 30, 600), 5);
    assert.equal(calculatePunctualityScore("not-a-time", 30, 600), 5);
  });

  it("decreases linearly to zero over the allowed late minutes", () => {
    assert.equal(calculatePunctualityScore("08:00:00", 30, 8 * 60), 5);
    assert.equal(calculatePunctualityScore("08:00", 30, 8 * 60 + 15), 2.5);
    assert.equal(calculatePunctualityScore("08:00", 30, 8 * 60 + 45), 0);
    assert.equal(calculatePunctualityScore("08:00", 30, 7 * 60), 5);
  });
});

describe("calcQuestionCount", () => {
  it("rounds to multiples of 5, with a floor of 5 and a ceiling of the pool size", () => {
    assert.equal(calcQuestionCount(100, 50), 50);
    assert.equal(calcQuestionCount(12, 100), 10);
    assert.equal(calcQuestionCount(8, 30), 5);
    assert.equal(calcQuestionCount(3, 100), 3);
  });
});
