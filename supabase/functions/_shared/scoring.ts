/**
 * Pure scoring rules for mock and real attempts. This is the single source of truth:
 * browsers only display the breakdown returned by the Edge Functions.
 */
import { sameAnswer } from "./answers.ts";

export type ScoringMethod = 1 | 2;
export type QuestionType = "single" | "multi";

/** Score weights (each method sums to 100). */
export const SCORE_WEIGHTS = {
  method1: { knowledge: 75, coverage: 10, duration: 10, punctuality: 5 },
  method2: { knowledge: 95, duration: 5 }
} as const;

/** Multi-answer questions weigh up to MAX and gain STEP per extra correct letter (method 1). */
export const MULTI_WEIGHT_STEP = 0.25;
export const MULTI_WEIGHT_MAX = 2;
/** Durations below this share of the maximum time still earn the full duration score (method 1). */
export const MIN_REASONABLE_DURATION_RATIO = 0.3;
/** Default grace period (minutes) for the punctuality score when a Space has none configured. */
export const DEFAULT_ALLOWED_LATE_MINUTES = 30;
const MAX_SCORE = 100;
const SCORE_DECIMALS = 100;
const MINUTES_PER_HOUR = 60;
const MIN_QUESTION_COUNT = 5;
const QUESTION_COUNT_STEP = 5;

export interface ScoringQuestion {
  id: number;
  type: QuestionType;
  /** Normalized correct letters. */
  correct: readonly string[];
}

export interface ScoringInput {
  questions: readonly ScoringQuestion[];
  /** Normalized selected letters by question id; missing ids count as unanswered. */
  selections: Readonly<Record<number, readonly string[]>>;
  scoringMethod: ScoringMethod;
  /** Number of questions in the pool the attempt was drawn from. */
  bankQuestionCount: number;
  durationSeconds: number;
  /** Seconds allowed per question. */
  timerSeconds: number;
  /** Punctuality score (0-5) already computed for method 1; ignored for method 2. */
  punctualityScore: number;
}

export interface ScoreBreakdown {
  score: number;
  scoringMethod: ScoringMethod;
  knowledgeScore: number;
  coverageScore: number;
  durationScore: number;
  punctualityScore: number;
  multiCorrectCount: number;
  multiSimilarityScore: number;
  correctCount: number;
  wrongCount: number;
  /** True per question id when the selection exactly matches the answer. */
  correctness: Record<number, boolean>;
}

const roundScore = (value: number): number => Math.round(value * SCORE_DECIMALS) / SCORE_DECIMALS;
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Calculates the composite score and per-question correctness for one attempt. */
export function calculateAttemptScore(input: ScoringInput): ScoreBreakdown {
  const { questions, selections, scoringMethod } = input;
  const totalQuestions = questions.length;
  const correctness: Record<number, boolean> = {};
  let earnedWeight = 0;
  let totalWeight = 0;
  let multiCorrectCount = 0;
  let multiSimilarityScore = 0;
  let correctCount = 0;

  for (const question of questions) {
    const selectedSet = new Set(selections[question.id] ?? []);
    const correctSet = new Set(question.correct);
    const exact = sameAnswer([...selectedSet].sort(), [...correctSet].sort());
    correctness[question.id] = exact;
    if (exact) correctCount += 1;

    const isMulti = question.type === "multi";
    const weight =
      scoringMethod === 2
        ? 1
        : isMulti
          ? Math.min(MULTI_WEIGHT_MAX, 1 + MULTI_WEIGHT_STEP * Math.max(0, correctSet.size - 1))
          : 1;

    let similarity = exact ? 1 : 0;
    if (isMulti) {
      const truePositive = [...selectedSet].filter((letter) => correctSet.has(letter)).length;
      const falsePositive = selectedSet.size - truePositive;
      const falseNegative = correctSet.size - truePositive;
      const denominator = 2 * truePositive + falsePositive + falseNegative;
      similarity =
        scoringMethod === 2 ? (exact ? 1 : 0) : denominator ? (2 * truePositive) / denominator : 0;
      multiSimilarityScore += similarity;
      if (exact) multiCorrectCount += 1;
    }
    earnedWeight += similarity * weight;
    totalWeight += weight;
  }

  const maximumDuration = totalQuestions * input.timerSeconds;
  const common = {
    scoringMethod,
    multiCorrectCount,
    multiSimilarityScore: roundScore(multiSimilarityScore),
    correctCount,
    wrongCount: totalQuestions - correctCount,
    correctness
  };

  if (scoringMethod === 2) {
    // Method 2: knowledge = correct ratio x 95; duration = unused share of the maximum time x 5.
    const weights = SCORE_WEIGHTS.method2;
    const knowledgeScore = totalQuestions ? (correctCount / totalQuestions) * weights.knowledge : 0;
    const durationScore =
      maximumDuration > 0
        ? clamp(
            ((maximumDuration - input.durationSeconds) / maximumDuration) * weights.duration,
            0,
            weights.duration
          )
        : 0;
    return {
      ...common,
      score: Math.round(clamp(knowledgeScore + durationScore, 0, MAX_SCORE)),
      knowledgeScore: roundScore(knowledgeScore),
      coverageScore: 0,
      durationScore: roundScore(durationScore),
      punctualityScore: 0
    };
  }

  const weights = SCORE_WEIGHTS.method1;
  const minimumReasonableDuration = maximumDuration * MIN_REASONABLE_DURATION_RATIO;
  const knowledgeScore = totalWeight ? (weights.knowledge * earnedWeight) / totalWeight : 0;
  const coverageScore = input.bankQuestionCount
    ? (weights.coverage * totalQuestions) / input.bankQuestionCount
    : 0;
  const durationScore =
    maximumDuration > minimumReasonableDuration
      ? weights.duration *
        clamp(
          (maximumDuration - input.durationSeconds) / (maximumDuration - minimumReasonableDuration),
          0,
          1
        )
      : weights.duration;
  const punctualityScore = clamp(input.punctualityScore, 0, weights.punctuality);

  return {
    ...common,
    score: Math.round(
      clamp(knowledgeScore + coverageScore + durationScore + punctualityScore, 0, MAX_SCORE)
    ),
    knowledgeScore: roundScore(knowledgeScore),
    coverageScore: roundScore(coverageScore),
    durationScore: roundScore(durationScore),
    punctualityScore: roundScore(punctualityScore)
  };
}

/**
 * Punctuality (0-5): full marks when no start time is configured or the attempt starts on
 * time, decreasing linearly to 0 after `allowedLateMinutes`.
 *
 * @param examStartTime Configured "HH:MM[:SS]" start time of the Space, or null.
 * @param startedMinutesOfDay Minutes since midnight, in the Space's timezone, when the attempt began.
 */
export function calculatePunctualityScore(
  examStartTime: string | null | undefined,
  allowedLateMinutes: number | null | undefined,
  startedMinutesOfDay: number
): number {
  const maximum = SCORE_WEIGHTS.method1.punctuality;
  if (!examStartTime) return maximum;
  const [hours, minutes] = examStartTime.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return maximum;
  const lateness = Math.max(0, startedMinutesOfDay - (hours * MINUTES_PER_HOUR + minutes));
  const allowance = Math.max(1, Number(allowedLateMinutes || DEFAULT_ALLOWED_LATE_MINUTES));
  return maximum * Math.max(0, 1 - lateness / allowance);
}

/**
 * Number of questions drawn for a configured percentage: rounded to a multiple of 5,
 * at least 5 and never above the pool size.
 */
export function calcQuestionCount(poolSize: number, percent: number): number {
  const raw = (poolSize * percent) / 100;
  return Math.min(
    poolSize,
    Math.max(MIN_QUESTION_COUNT, Math.round(raw / QUESTION_COUNT_STEP) * QUESTION_COUNT_STEP)
  );
}
