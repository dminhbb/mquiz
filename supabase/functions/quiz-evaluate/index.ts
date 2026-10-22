/**
 * quiz-evaluate: answer feedback for Luyện tập (practice) only. Practice never creates
 * quiz_attempts, so revealing answers here is part of the mode.
 *
 * - `check`  tells whether one question was answered correctly and returns its answer.
 * - `review` scores a finished practice run for the results screen (nothing is saved).
 *
 * Thi thử and Thi thật are started and scored by the quiz-attempt function instead.
 */
import { normalizeAnswer, parseSelectedLetters, sameAnswer } from "../_shared/answers.ts";
import { AppError, readJsonObject, serveJson } from "../_shared/http.ts";
import {
  filterBySets,
  loadPublishedSpace,
  loadSpaceQuestions,
  loadSpaceQuestionsByIds,
  minutesOfDay,
  pickQuestions
} from "../_shared/quiz-data.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { calculateAttemptScore, calculatePunctualityScore } from "../_shared/scoring.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import type { SupabaseClient } from "../_shared/supabase.ts";
import { requireIdList, requirePositiveInt, requireString } from "../_shared/validation.ts";

const HTTP_NOT_FOUND = 404;
const MAX_SLUG_LENGTH = 120;
const MAX_TIMER_SECONDS = 600;
const DEFAULT_TIMER_SECONDS = 60;
/** Practice duration is reported by the browser and only affects the on-screen score. */
const MAX_PRACTICE_DURATION_SECONDS = 24 * 60 * 60;

Deno.serve(
  serveJson(async (request) => {
    const admin = createServiceClient();
    const body = await readJsonObject(request);
    if (body.action === "check") {
      await enforceRateLimit(admin, request, "check");
      return await checkQuestion(admin, body);
    }
    if (body.action === "review") {
      await enforceRateLimit(admin, request, "review");
      return await reviewPractice(admin, body);
    }
    throw new AppError("Hành động không được hỗ trợ.");
  })
);

async function checkQuestion(admin: SupabaseClient, body: Record<string, unknown>) {
  const space = await loadPublishedSpace(admin, requireString(body.slug, "Space", MAX_SLUG_LENGTH));
  const questionId = requirePositiveInt(body.question_id, "Câu hỏi");
  const selected = parseSelectedLetters(body.selected ?? []);
  if (!selected) throw new AppError("Đáp án gửi lên không hợp lệ.");

  const [question] = await loadSpaceQuestionsByIds(admin, space.id, [questionId], false);
  if (!question) throw new AppError("Câu hỏi không tồn tại.", HTTP_NOT_FOUND);
  const correct = normalizeAnswer(question.correct);
  return { correct, is_correct: sameAnswer(normalizeAnswer(selected), correct) };
}

async function reviewPractice(admin: SupabaseClient, body: Record<string, unknown>) {
  const space = await loadPublishedSpace(admin, requireString(body.slug, "Space", MAX_SLUG_LENGTH));
  const questionIds = requireIdList(body.question_ids, "Danh sách câu hỏi");
  const setIds = requireIdList(body.question_set_ids ?? [], "Bộ câu hỏi", true);
  const selections = parseSelections(body.selections, questionIds);
  const questions = pickQuestions(
    await loadSpaceQuestionsByIds(admin, space.id, questionIds),
    questionIds
  );
  const bankQuestionCount = filterBySets(await loadSpaceQuestions(admin, space.id), setIds).length;

  const requestedTimer = Number(body.timer_seconds);
  const timerSeconds =
    Number.isSafeInteger(requestedTimer) && requestedTimer > 0
      ? Math.min(requestedTimer, MAX_TIMER_SECONDS)
      : Number(space.timer_seconds || DEFAULT_TIMER_SECONDS);
  const reportedDuration = Number(body.duration_seconds);
  const durationSeconds = Number.isFinite(reportedDuration)
    ? Math.min(MAX_PRACTICE_DURATION_SECONDS, Math.max(0, Math.round(reportedDuration)))
    : 0;

  const breakdown = calculateAttemptScore({
    questions,
    selections,
    scoringMethod: 1,
    bankQuestionCount: Math.max(bankQuestionCount, questions.length),
    durationSeconds,
    timerSeconds,
    punctualityScore: calculatePunctualityScore(
      space.exam_start_time,
      space.allowed_late_minutes,
      minutesOfDay(new Date())
    )
  });

  const answers: Record<string, string[]> = {};
  for (const question of questions) answers[question.id] = [...question.correct];
  return {
    breakdown: {
      score: breakdown.score,
      scoring_method: breakdown.scoringMethod,
      knowledge_score: breakdown.knowledgeScore,
      coverage_score: breakdown.coverageScore,
      duration_score: breakdown.durationScore,
      punctuality_score: breakdown.punctualityScore,
      correct_count: breakdown.correctCount,
      wrong_count: breakdown.wrongCount
    },
    correctness: breakdown.correctness,
    answers
  };
}

/** Validates `{ "<questionId>": ["A", "C"] }` for the given question ids. */
function parseSelections(value: unknown, questionIds: readonly number[]): Record<number, string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("Đáp án gửi lên không hợp lệ.");
  }
  const allowedIds = new Set(questionIds);
  const selections: Record<number, string[]> = {};
  for (const [rawId, rawLetters] of Object.entries(value)) {
    const id = Number(rawId);
    const letters = parseSelectedLetters(rawLetters);
    if (!allowedIds.has(id) || !letters) throw new AppError("Đáp án gửi lên không hợp lệ.");
    selections[id] = letters;
  }
  return selections;
}
