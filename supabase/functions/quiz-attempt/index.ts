/**
 * quiz-attempt: the only writer of mock/real results.
 *
 * - `start`  registers an attempt session: the server fixes the start time, the question
 *            list and the scoring parameters and enforces the real-exam schedule and the
 *            per-student attempt limit.
 * - `submit` scores the selections against the stored answers, saves the result (unless the
 *            attempt is abandoned) and returns the answers for review.
 *
 * Browsers cannot insert into quiz_attempts directly (see server_side_attempt_scoring.sql).
 */
import { normalizeAnswer, parseSelectedLetters } from "../_shared/answers.ts";
import { AppError, readJsonObject, serveJson } from "../_shared/http.ts";
import {
  filterBySets,
  loadPublishedSpace,
  loadRealExamQuestions,
  loadRunningRealExam,
  loadSpaceQuestions,
  loadSpaceQuestionsByIds,
  minutesOfDay,
  pickQuestions
} from "../_shared/quiz-data.ts";
import type { AnswerKeyRow, SpaceRow } from "../_shared/quiz-data.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import {
  calcQuestionCount,
  calculateAttemptScore,
  calculatePunctualityScore
} from "../_shared/scoring.ts";
import type { ScoringMethod } from "../_shared/scoring.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import type { SupabaseClient } from "../_shared/supabase.ts";
import {
  normalizeStudentName,
  requireIdList,
  requirePositiveInt,
  requireString,
  studentNameKey
} from "../_shared/validation.ts";

const HTTP_CONFLICT = 409;
const HTTP_NOT_FOUND = 404;
const POSTGRES_RAISE_EXCEPTION = "P0001";
const MAX_STUDENT_NAME_LENGTH = 80;
const MAX_GROUP_NAME_LENGTH = 120;
const MAX_SLUG_LENGTH = 120;
const MAX_TIMER_SECONDS = 600;
const MAX_FOCUS_VIOLATIONS = 1000;
/** Question-count shares a Thi thử (mock) attempt may use. */
const MOCK_QUESTION_PERCENTS = [30, 50, 70, 100] as const;
/** The real exam snapshot already holds the exam's questions, so its share is always 100%. */
const REAL_EXAM_QUESTION_PERCENT = 100;
/** Per-question timers are enforced by the browser; the server allows this much slack in total. */
const TIME_OVERRUN_FACTOR = 1.5;
const TIME_GRACE_SECONDS = 120;
const MS_PER_SECOND = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AttemptMode = "mock" | "real";

interface SessionRow {
  id: string;
  space_id: number;
  space_slug: string;
  mode: AttemptMode;
  real_exam_id: number | null;
  real_exam_code: number | null;
  real_exam_revision_id: number | null;
  student_name: string;
  student_name_key: string;
  group_name: string;
  question_ids: number[];
  bank_question_count: number;
  timer_seconds: number;
  scoring_method: number;
  started_at: string;
}

Deno.serve(
  serveJson(async (request) => {
    const admin = createServiceClient();
    const body = await readJsonObject(request);
    if (body.action === "start") {
      await enforceRateLimit(admin, request, "start");
      return await startAttempt(admin, body);
    }
    if (body.action === "submit") {
      await enforceRateLimit(admin, request, "submit");
      return await submitAttempt(admin, body);
    }
    throw new AppError("Hành động không được hỗ trợ.");
  })
);

async function startAttempt(admin: SupabaseClient, body: Record<string, unknown>) {
  const space = await loadPublishedSpace(admin, requireString(body.slug, "Space", MAX_SLUG_LENGTH));
  if (body.mode !== "mock" && body.mode !== "real")
    throw new AppError("Chế độ làm bài không hợp lệ.");
  const mode: AttemptMode = body.mode;
  const studentName = normalizeStudentName(
    requireString(body.student_name, "Tên học viên", MAX_STUDENT_NAME_LENGTH)
  );
  const groupName = requireString(body.group_name, "Group", MAX_GROUP_NAME_LENGTH);
  const questionIds = requireIdList(body.question_ids, "Danh sách câu hỏi");
  await assertGroupExists(admin, space.id, groupName);

  let realExamId: number | null = null;
  let realExamCode: number | null = null;
  let realExamRevisionId: number | null = null;
  let maxAttempts: number | null = null;
  let scoringMethod: ScoringMethod = 1;
  let timerSeconds: number;
  let bankQuestionCount: number;

  if (mode === "real") {
    const exam = await loadRunningRealExam(
      admin,
      space.id,
      requirePositiveInt(body.exam_code, "Mã đợt thi")
    );
    const pool = await loadRealExamQuestions(admin, exam);
    assertQuestionCount(questionIds.length, [
      calcQuestionCount(pool.length, REAL_EXAM_QUESTION_PERCENT)
    ]);
    pickQuestions(pool, questionIds);
    realExamId = exam.id;
    realExamCode = exam.code;
    realExamRevisionId = exam.revisionId;
    maxAttempts = exam.maxAttempts;
    scoringMethod = exam.scoringMethod;
    timerSeconds = exam.timerSeconds;
    bankQuestionCount = pool.length;
  } else {
    const setIds = requireIdList(body.question_set_ids ?? [], "Bộ câu hỏi", true);
    const pool = filterBySets(await loadSpaceQuestions(admin, space.id), setIds);
    assertQuestionCount(
      questionIds.length,
      MOCK_QUESTION_PERCENTS.map((percent) => calcQuestionCount(pool.length, percent))
    );
    pickQuestions(pool, questionIds);
    timerSeconds = requirePositiveInt(body.timer_seconds, "Thời gian mỗi câu");
    if (timerSeconds > MAX_TIMER_SECONDS) throw new AppError("Thời gian mỗi câu không hợp lệ.");
    bankQuestionCount = pool.length;
  }

  const { data, error } = await admin.rpc("start_quiz_attempt_session", {
    p_space_id: space.id,
    p_space_slug: space.slug,
    p_mode: mode,
    p_real_exam_id: realExamId,
    p_real_exam_code: realExamCode,
    p_real_exam_revision_id: realExamRevisionId,
    p_student_name: studentName,
    p_student_name_key: studentNameKey(studentName),
    p_group_name: groupName,
    p_question_ids: questionIds,
    p_bank_question_count: bankQuestionCount,
    p_timer_seconds: timerSeconds,
    p_scoring_method: scoringMethod,
    p_max_attempts: maxAttempts
  });
  throwIfRaisedByDatabase(error);
  return { attempt_id: data.id, started_at: data.started_at };
}

async function submitAttempt(admin: SupabaseClient, body: Record<string, unknown>) {
  const attemptId = String(body.attempt_id ?? "");
  if (!UUID_PATTERN.test(attemptId)) throw new AppError("Mã lượt làm bài không hợp lệ.");
  const shouldSave = body.save !== false;
  const reportedFocusViolations = Number(body.focus_violation_count ?? 0);
  const focusViolations = Number.isFinite(reportedFocusViolations)
    ? Math.min(MAX_FOCUS_VIOLATIONS, Math.max(0, Math.trunc(reportedFocusViolations)))
    : 0;

  // Claim the session so a double submit (or a replay) can only be processed once.
  const { data: claimed, error: claimError } = await admin
    .from("quiz_attempt_sessions")
    .update({ finished_at: new Date().toISOString(), outcome: "abandoned" })
    .eq("id", attemptId)
    .eq("outcome", "pending")
    .select("*")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    const { data: existing } = await admin
      .from("quiz_attempt_sessions")
      .select("id")
      .eq("id", attemptId)
      .maybeSingle();
    if (!existing) throw new AppError("Không tìm thấy lượt làm bài.", HTTP_NOT_FOUND);
    throw new AppError("Lượt làm bài này đã được nộp.", HTTP_CONFLICT);
  }
  const session = claimed as SessionRow & { finished_at: string };
  const questionIds = session.question_ids.map(Number);

  const elapsedSeconds = Math.max(
    0,
    Math.round((Date.parse(session.finished_at) - Date.parse(session.started_at)) / MS_PER_SECOND)
  );
  const allowedSeconds = Math.ceil(
    questionIds.length * session.timer_seconds * TIME_OVERRUN_FACTOR + TIME_GRACE_SECONDS
  );
  if (elapsedSeconds > allowedSeconds) {
    throw new AppError(
      "Đã quá thời gian làm bài cho phép nên kết quả không được ghi nhận.",
      HTTP_CONFLICT
    );
  }

  try {
    return await scoreAndSave(
      admin,
      session,
      body,
      questionIds,
      elapsedSeconds,
      shouldSave,
      focusViolations
    );
  } catch (error) {
    // Nothing was saved, so release the claim and let the student retry.
    await admin
      .from("quiz_attempt_sessions")
      .update({ finished_at: null, outcome: "pending" })
      .eq("id", attemptId);
    throw error;
  }
}

async function scoreAndSave(
  admin: SupabaseClient,
  session: SessionRow,
  body: Record<string, unknown>,
  questionIds: readonly number[],
  elapsedSeconds: number,
  shouldSave: boolean,
  focusViolations: number
) {
  const selections = parseSelections(body.selections, questionIds);
  const pool = await loadSessionQuestions(admin, session);
  const questions = pickQuestions(pool, questionIds);
  const space = await loadPublishedSpace(admin, session.space_slug);
  const scoringMethod: ScoringMethod = session.scoring_method === 2 ? 2 : 1;
  const breakdown = calculateAttemptScore({
    questions,
    selections,
    scoringMethod,
    bankQuestionCount: session.bank_question_count,
    durationSeconds: elapsedSeconds,
    timerSeconds: session.timer_seconds,
    punctualityScore: punctualityFor(session, space)
  });

  let savedAttemptId: string | null = null;
  if (shouldSave) {
    const { data: inserted, error: insertError } = await admin
      .from("quiz_attempts")
      .insert({
        space_slug: session.space_slug,
        student_name: session.student_name,
        student_name_key: session.student_name_key,
        group_name: session.group_name,
        mode: session.mode,
        started_at: session.started_at,
        score: breakdown.score,
        total_questions: questions.length,
        bank_question_count: session.bank_question_count,
        correct_count: breakdown.correctCount,
        wrong_count: breakdown.wrongCount,
        multi_correct_count: breakdown.multiCorrectCount,
        multi_similarity_score: breakdown.multiSimilarityScore,
        duration_seconds: elapsedSeconds,
        timer_seconds: session.timer_seconds,
        knowledge_score: breakdown.knowledgeScore,
        coverage_score: breakdown.coverageScore,
        duration_score: breakdown.durationScore,
        punctuality_score: breakdown.punctualityScore,
        scoring_method: scoringMethod,
        focus_violation_count: focusViolations,
        ...(session.mode === "real"
          ? {
              real_exam_id: session.real_exam_id,
              real_exam_code: session.real_exam_code,
              real_exam_revision_id: session.real_exam_revision_id
            }
          : {})
      })
      .select("id")
      .single();
    throwIfRaisedByDatabase(insertError);
    savedAttemptId = String(inserted?.id ?? "");
    const { error: markError } = await admin
      .from("quiz_attempt_sessions")
      .update({ outcome: "saved", quiz_attempt_id: savedAttemptId })
      .eq("id", session.id);
    // The result is already stored; a failed bookkeeping update must not fail the request.
    if (markError) console.error("Could not mark attempt session as saved:", markError.message);
  }

  const answers: Record<string, string[]> = {};
  for (const question of questions) answers[question.id] = [...question.correct];
  return {
    saved: shouldSave,
    attempt_id: savedAttemptId,
    duration_seconds: elapsedSeconds,
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

function assertQuestionCount(actual: number, allowed: readonly number[]): void {
  if (!allowed.includes(actual)) {
    throw new AppError("Số câu hỏi không khớp với cấu hình. Vui lòng tải lại trang và thử lại.");
  }
}

async function assertGroupExists(admin: SupabaseClient, spaceId: number, groupName: string) {
  const { data, error } = await admin
    .from("groups")
    .select("name")
    .eq("space_id", spaceId)
    .eq("name", groupName)
    .limit(1);
  if (error) throw error;
  if (!data?.length) throw new AppError("Group không thuộc Space này.");
}

/** Answer keys for the exact pool an attempt was drawn from. */
function loadSessionQuestions(admin: SupabaseClient, session: SessionRow): Promise<AnswerKeyRow[]> {
  if (session.mode === "real") {
    return loadRealExamQuestions(admin, {
      id: Number(session.real_exam_id),
      revisionId: Number(session.real_exam_revision_id)
    });
  }
  return loadSpaceQuestionsByIds(admin, session.space_id, session.question_ids.map(Number));
}

/** Real exams do not configure a start time, so punctuality is only scored for Thi thử. */
function punctualityFor(session: SessionRow, space: SpaceRow): number {
  if (session.mode === "real") return calculatePunctualityScore(null, null, 0);
  return calculatePunctualityScore(
    space.exam_start_time,
    space.allowed_late_minutes,
    minutesOfDay(new Date(session.started_at))
  );
}

/** Validates `{ "<questionId>": ["A", "C"] }` and keeps only ids that belong to the attempt. */
function parseSelections(value: unknown, questionIds: readonly number[]): Record<number, string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("Đáp án gửi lên không hợp lệ.");
  }
  const allowedIds = new Set(questionIds);
  const selections: Record<number, string[]> = {};
  for (const [rawId, rawLetters] of Object.entries(value)) {
    const id = Number(rawId);
    if (!allowedIds.has(id)) throw new AppError("Đáp án gửi lên không hợp lệ.");
    const letters = parseSelectedLetters(rawLetters);
    if (!letters) throw new AppError("Đáp án gửi lên không hợp lệ.");
    selections[id] = normalizeAnswer(letters);
  }
  return selections;
}

/** Business-rule errors raised in SQL (P0001) are safe to show; other DB errors are not. */
function throwIfRaisedByDatabase(error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (error.code === POSTGRES_RAISE_EXCEPTION) throw new AppError(error.message, HTTP_CONFLICT);
  throw new Error(error.message);
}
