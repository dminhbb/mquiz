/** Service-role data access shared by quiz-attempt and quiz-evaluate. */
import { normalizeAnswer } from "./answers.ts";
import { AppError } from "./http.ts";
import type { QuestionType, ScoringMethod, ScoringQuestion } from "./scoring.ts";
import type { SupabaseClient } from "./supabase.ts";

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
/** PostgREST returns at most this many rows per request. */
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
/** Timezone used for the punctuality score; override with the QUIZ_TIMEZONE secret. */
const DEFAULT_QUIZ_TIMEZONE = "Asia/Ho_Chi_Minh";
const MINUTES_PER_HOUR = 60;

export interface SpaceRow {
  id: number;
  slug: string;
  exam_start_time: string | null;
  allowed_late_minutes: number | null;
  timer_seconds: number | null;
}

export interface RealExamContext {
  id: number;
  code: number;
  revisionId: number;
  timerSeconds: number;
  maxAttempts: number;
  scoringMethod: ScoringMethod;
}

/** A question as stored for scoring; `questionSetId` is 0 for unassigned questions. */
export interface AnswerKeyRow extends ScoringQuestion {
  questionSetId: number;
}

interface RawQuestion {
  id?: number;
  question_code?: number;
  type: QuestionType;
  correct_json: unknown;
  question_set_id?: number | null;
}

function toAnswerKeyRow(row: RawQuestion): AnswerKeyRow {
  return {
    id: Number(row.question_code ?? row.id),
    type: row.type === "multi" ? "multi" : "single",
    correct: normalizeAnswer(row.correct_json),
    questionSetId: Number(row.question_set_id ?? 0)
  };
}

function asScoringMethod(value: unknown): ScoringMethod {
  return Number(value) === 2 ? 2 : 1;
}

/** Loads a published Space by slug; unpublished or unknown Spaces look identical. */
export async function loadPublishedSpace(admin: SupabaseClient, slug: string): Promise<SpaceRow> {
  const { data, error } = await admin
    .from("spaces")
    .select("id,slug,published,exam_start_time,allowed_late_minutes,timer_seconds")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data?.published) throw new AppError("Space không tồn tại.", HTTP_NOT_FOUND);
  return {
    id: Number(data.id),
    slug: String(data.slug),
    exam_start_time: data.exam_start_time ?? null,
    allowed_late_minutes: data.allowed_late_minutes ?? null,
    timer_seconds: data.timer_seconds ?? null
  };
}

/** All visible questions of a Space with their answers (paginated past the PostgREST row cap). */
export async function loadSpaceQuestions(
  admin: SupabaseClient,
  spaceId: number
): Promise<AnswerKeyRow[]> {
  const rows: AnswerKeyRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await admin
      .from("questions")
      .select("id,type,correct_json,question_set_id")
      .eq("space_id", spaceId)
      .is("hidden_at", null)
      .order("id")
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as RawQuestion[];
    rows.push(...batch.map(toAnswerKeyRow));
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Questions of a Space by id. Archived questions are included by default so that an admin
 * archiving a question mid-exam cannot make a submission fail; pass `includeArchived = false`
 * when answers must only be revealed for questions that are still visible.
 */
export async function loadSpaceQuestionsByIds(
  admin: SupabaseClient,
  spaceId: number,
  ids: readonly number[],
  includeArchived = true
): Promise<AnswerKeyRow[]> {
  if (ids.length === 0) return [];
  let query = admin
    .from("questions")
    .select("id,type,correct_json,question_set_id")
    .eq("space_id", spaceId)
    .in("id", [...ids]);
  if (!includeArchived) query = query.is("hidden_at", null);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as RawQuestion[]).map(toAnswerKeyRow);
}

/** Restricts questions to the chosen question sets; an empty list means every set. */
export function filterBySets(
  rows: readonly AnswerKeyRow[],
  setIds: readonly number[]
): AnswerKeyRow[] {
  if (setIds.length === 0) return [...rows];
  const allowed = new Set(setIds);
  return rows.filter((row) => allowed.has(row.questionSetId));
}

/**
 * Loads a running real exam and rejects attempts outside its schedule. The same rules are
 * enforced again by the quiz_attempts trigger; this gives users an early, clear message.
 */
export async function loadRunningRealExam(
  admin: SupabaseClient,
  spaceId: number,
  examCode: number
): Promise<RealExamContext> {
  const { data, error } = await admin
    .from("real_exams")
    .select(
      "id,code,current_revision_id,timer_seconds,max_attempts,scoring_method,start_at,end_at,ended_at,manual_running"
    )
    .eq("code", examCode)
    .eq("space_id", spaceId)
    .is("hidden_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.current_revision_id)
    throw new AppError("Đợt thi thật không tồn tại.", HTTP_NOT_FOUND);

  const now = Date.now();
  if (data.ended_at || now > Date.parse(data.end_at)) {
    throw new AppError("Đợt thi đã kết thúc.", HTTP_CONFLICT);
  }
  if (now < Date.parse(data.start_at))
    throw new AppError("Chưa tới thời gian đợt thi.", HTTP_CONFLICT);
  if (!data.manual_running) throw new AppError("Đợt thi đã tạm dừng.", HTTP_CONFLICT);

  return {
    id: Number(data.id),
    code: Number(data.code),
    revisionId: Number(data.current_revision_id),
    timerSeconds: Number(data.timer_seconds),
    maxAttempts: Number(data.max_attempts),
    scoringMethod: asScoringMethod(data.scoring_method)
  };
}

/** Questions of the exam's current revision (immutable snapshot, with legacy fallback). */
export async function loadRealExamQuestions(
  admin: SupabaseClient,
  exam: Pick<RealExamContext, "id" | "revisionId">
): Promise<AnswerKeyRow[]> {
  const snapshot = await admin
    .from("real_exam_revision_question_snapshots")
    .select("question_code,type,correct_json")
    .eq("revision_id", exam.revisionId);
  if (!snapshot.error && snapshot.data?.length) {
    return (snapshot.data as RawQuestion[]).map(toAnswerKeyRow);
  }

  // Revisions created before the snapshot migration only have the canonical refs relation.
  const refs = await admin
    .from("real_exam_question_refs")
    .select("question_code")
    .eq("real_exam_id", exam.id);
  if (refs.error) throw refs.error;
  const codes = (refs.data ?? []).map((item) => Number(item.question_code));
  if (codes.length === 0) return [];
  const questions = await admin
    .from("questions")
    .select("question_code,type,correct_json")
    .in("question_code", codes);
  if (questions.error) throw questions.error;
  return (questions.data as RawQuestion[]).map(toAnswerKeyRow);
}

/** Minutes since midnight for `date` in the configured quiz timezone. */
export function minutesOfDay(date: Date): number {
  const timeZone = Deno.env.get("QUIZ_TIMEZONE") ?? DEFAULT_QUIZ_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const hours = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minutes = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hours * MINUTES_PER_HOUR + minutes;
}

/** Picks rows for `ids` in the requested order; throws when any id is not in the pool. */
export function pickQuestions(
  pool: readonly AnswerKeyRow[],
  ids: readonly number[]
): AnswerKeyRow[] {
  const byId = new Map(pool.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw new AppError("Câu hỏi không thuộc bài thi này.");
    return row;
  });
}
