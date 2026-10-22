/**
 * Runs the real Edge Function handlers against an in-memory Supabase (see fake-supabase.ts).
 * Run with: npm run test:functions
 */
import assert from "node:assert/strict";
import { db } from "./fake-supabase.ts";

type Handler = (request: Request) => Promise<Response>;

Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_ANON_KEY", "anon-test-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-test-key");

/** Imports a function module and returns the handler it registered with Deno.serve. */
async function loadHandler(specifier: string): Promise<Handler> {
  let captured: Handler | null = null;
  const original = Deno.serve;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (handler: Handler) => {
    captured = handler;
    return {};
  };
  try {
    await import(specifier);
  } finally {
    Deno.serve = original;
  }
  assert.ok(captured, `${specifier} did not register a handler`);
  return captured;
}

const attemptHandler = await loadHandler("../../supabase/functions/quiz-attempt/index.ts");
const evaluateHandler = await loadHandler("../../supabase/functions/quiz-evaluate/index.ts");
const adminHandler = await loadHandler("../../supabase/functions/admin-users/index.ts");

async function call(handler: Handler, body: unknown, headers: Record<string, string> = {}) {
  const response = await handler(
    new Request("http://localhost/fn", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    })
  );
  return { status: response.status, body: await response.json() };
}

const SPACE_ID = 1;
const LETTERS = ["A", "B", "C", "D"];

/** Seeds a published Space with 10 questions (ids 1-10, answer A; every 5th is multi A+B). */
function seed() {
  db.reset();
  db.tables.spaces = [
    {
      id: SPACE_ID,
      slug: "demo",
      published: true,
      exam_start_time: null,
      allowed_late_minutes: 30,
      timer_seconds: 60
    }
  ];
  db.tables.groups = [{ space_id: SPACE_ID, name: "Nhóm 1" }];
  db.tables.questions = Array.from({ length: 10 }, (_, index) => {
    const id = index + 1;
    const multi = id % 5 === 0;
    return {
      id,
      space_id: SPACE_ID,
      question_set_id: null,
      type: multi ? "multi" : "single",
      correct_json: multi ? ["A", "B"] : ["A"],
      hidden_at: null,
      options_json: Object.fromEntries(LETTERS.map((letter) => [letter, letter]))
    };
  });
  db.tables.quiz_attempts = [];
  db.tables.quiz_attempt_sessions = [];

  db.rpcs.consume_rate_limit = (args) => {
    const rows = (db.tables.api_rate_limits ??= []);
    let row = rows.find((item) => item.bucket === args.p_bucket);
    if (!row) rows.push((row = { bucket: args.p_bucket, count: 0 }));
    row.count = Number(row.count) + 1;
    return { data: Number(row.count) <= Number(args.p_limit), error: null };
  };
  // Mirrors public.start_quiz_attempt_session (limit check + insert).
  db.rpcs.start_quiz_attempt_session = (args) => {
    const sessions = db.tables.quiz_attempt_sessions;
    if (args.p_mode === "real") {
      const used = sessions.filter(
        (row) =>
          row.mode === "real" &&
          row.real_exam_revision_id === args.p_real_exam_revision_id &&
          row.student_name_key === args.p_student_name_key
      ).length;
      if (used >= Number(args.p_max_attempts)) {
        return { data: null, error: { code: "P0001", message: "Bạn đã hết số lượt thi." } };
      }
    }
    const row = {
      id: crypto.randomUUID(),
      space_id: args.p_space_id,
      space_slug: args.p_space_slug,
      mode: args.p_mode,
      real_exam_id: args.p_real_exam_id,
      real_exam_code: args.p_real_exam_code,
      real_exam_revision_id: args.p_real_exam_revision_id,
      student_name: args.p_student_name,
      student_name_key: args.p_student_name_key,
      group_name: args.p_group_name,
      question_ids: args.p_question_ids,
      bank_question_count: args.p_bank_question_count,
      timer_seconds: args.p_timer_seconds,
      scoring_method: args.p_scoring_method,
      started_at: new Date().toISOString(),
      finished_at: null,
      outcome: "pending"
    };
    sessions.push(row);
    return { data: { id: row.id, started_at: row.started_at }, error: null };
  };
}

function seedRealExam(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  db.tables.real_exams = [
    {
      id: 7,
      code: 12345,
      space_id: SPACE_ID,
      current_revision_id: 70,
      timer_seconds: 45,
      max_attempts: 1,
      scoring_method: 2,
      start_at: new Date(now - 3_600_000).toISOString(),
      end_at: new Date(now + 3_600_000).toISOString(),
      ended_at: null,
      hidden_at: null,
      manual_running: true,
      ...overrides
    }
  ];
  // Exam questions use question_code 101-105 (distinct from questions.id).
  db.tables.real_exam_revision_question_snapshots = [101, 102, 103, 104, 105].map((code) => ({
    revision_id: 70,
    question_code: code,
    type: "single",
    correct_json: ["B"]
  }));
}

const mockStart = (extra: Record<string, unknown> = {}) => ({
  action: "start",
  slug: "demo",
  mode: "mock",
  student_name: "  Nguyễn  Văn A ",
  group_name: "Nhóm 1",
  question_set_ids: [],
  question_ids: [1, 2, 3, 4, 5],
  timer_seconds: 60,
  ...extra
});

Deno.test(
  "mock attempt: start fixes the session, submit scores and saves server-side",
  async () => {
    seed();
    const started = await call(attemptHandler, mockStart());
    assert.equal(started.status, 200);
    const attemptId = started.body.attempt_id as string;
    const session = db.tables.quiz_attempt_sessions[0];
    assert.equal(session.student_name, "Nguyễn Văn A");
    assert.equal(session.student_name_key, "nguyễn văn a");
    assert.equal(session.bank_question_count, 10);

    // Answers all correct: singles ["A"], question 5 is multi ["A","B"].
    const submitted = await call(attemptHandler, {
      action: "submit",
      attempt_id: attemptId,
      selections: { 1: ["A"], 2: ["A"], 3: ["A"], 4: ["A"], 5: ["B", "A"] },
      focus_violation_count: 3,
      save: true
    });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.saved, true);
    assert.equal(submitted.body.breakdown.correct_count, 5);
    assert.equal(submitted.body.breakdown.wrong_count, 0);
    assert.deepEqual(submitted.body.answers["5"], ["A", "B"]);

    const [attempt] = db.tables.quiz_attempts;
    assert.equal(attempt.mode, "mock");
    assert.equal(attempt.score, submitted.body.breakdown.score);
    assert.equal(attempt.total_questions, 5);
    assert.equal(attempt.focus_violation_count, 3);
    assert.equal(db.tables.quiz_attempt_sessions[0].outcome, "saved");
  }
);

Deno.test("the browser's default question set id 0 selects unassigned questions", async () => {
  seed();
  db.tables.questions[9].question_set_id = 3; // question 10 belongs to a set; 1-9 are unassigned
  const unassigned = await call(
    attemptHandler,
    mockStart({ question_set_ids: [0], question_ids: [1, 2, 3, 4, 5] })
  );
  assert.equal(unassigned.status, 200);
  assert.equal(db.tables.quiz_attempt_sessions[0].bank_question_count, 9);
  // Question 10 is outside the chosen sets, so it cannot be smuggled into the attempt.
  const smuggled = await call(
    attemptHandler,
    mockStart({ question_set_ids: [0], question_ids: [1, 2, 3, 4, 10] })
  );
  assert.equal(smuggled.status, 400);
});

Deno.test("submit cannot be replayed", async () => {
  seed();
  const { body } = await call(attemptHandler, mockStart());
  const submit = { action: "submit", attempt_id: body.attempt_id, selections: {}, save: true };
  assert.equal((await call(attemptHandler, submit)).status, 200);
  const replay = await call(attemptHandler, submit);
  assert.equal(replay.status, 409);
  assert.equal(db.tables.quiz_attempts.length, 1);
});

Deno.test("a forged score field is ignored: the server always recomputes", async () => {
  seed();
  const { body } = await call(attemptHandler, mockStart());
  const submitted = await call(attemptHandler, {
    action: "submit",
    attempt_id: body.attempt_id,
    selections: { 1: ["D"], 2: ["D"], 3: ["D"], 4: ["D"], 5: ["D"] },
    score: 100,
    correct_count: 5,
    save: true
  });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.breakdown.correct_count, 0);
  assert.ok(Number(db.tables.quiz_attempts[0].score) < 30);
});

Deno.test("start rejects questions outside the pool, bad counts and unknown groups", async () => {
  seed();
  assert.equal(
    (await call(attemptHandler, mockStart({ question_ids: [1, 2, 3, 4, 99] }))).status,
    400
  );
  assert.equal((await call(attemptHandler, mockStart({ question_ids: [1, 2, 3] }))).status, 400);
  assert.equal(
    (await call(attemptHandler, mockStart({ question_ids: [1, 1, 2, 3, 4] }))).status,
    400
  );
  assert.equal((await call(attemptHandler, mockStart({ group_name: "Nhóm lạ" }))).status, 400);
  assert.equal((await call(attemptHandler, mockStart({ mode: "practice" }))).status, 400);
  assert.equal(db.tables.quiz_attempt_sessions.length, 0);
});

Deno.test("submit after the allowed time is rejected and not saved", async () => {
  seed();
  const { body } = await call(attemptHandler, mockStart());
  // 5 questions x 60s x 1.5 + 120s = 570s; pretend the attempt started an hour ago.
  db.tables.quiz_attempt_sessions[0].started_at = new Date(Date.now() - 3_600_000).toISOString();
  const submitted = await call(attemptHandler, {
    action: "submit",
    attempt_id: body.attempt_id,
    selections: {},
    save: true
  });
  assert.equal(submitted.status, 409);
  assert.equal(db.tables.quiz_attempts.length, 0);
});

Deno.test("ending early returns answers but saves nothing", async () => {
  seed();
  const { body } = await call(attemptHandler, mockStart());
  const result = await call(attemptHandler, {
    action: "submit",
    attempt_id: body.attempt_id,
    selections: { 1: ["A"] },
    save: false
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.saved, false);
  assert.equal(db.tables.quiz_attempts.length, 0);
  assert.equal(db.tables.quiz_attempt_sessions[0].outcome, "abandoned");
});

Deno.test(
  "a database rejection on save releases the session so the student can retry",
  async () => {
    seed();
    const { body } = await call(attemptHandler, mockStart());
    db.insertHooks.quiz_attempts = () => {
      throw { code: "P0001", message: "Lượt thi không bắt đầu trong thời gian Đợt thi thật." };
    };
    const failed = await call(attemptHandler, {
      action: "submit",
      attempt_id: body.attempt_id,
      selections: {},
      save: true
    });
    assert.equal(failed.status, 409);
    assert.match(failed.body.error, /thời gian/);
    assert.equal(db.tables.quiz_attempt_sessions[0].outcome, "pending");

    db.insertHooks = {};
    const retry = await call(attemptHandler, {
      action: "submit",
      attempt_id: body.attempt_id,
      selections: {},
      save: true
    });
    assert.equal(retry.status, 200);
  }
);

Deno.test(
  "real exam: schedule, pause, pool and per-student attempt limit are enforced",
  async () => {
    seed();
    seedRealExam();
    const realStart = (extra: Record<string, unknown> = {}) => ({
      action: "start",
      slug: "demo",
      mode: "real",
      exam_code: 12345,
      student_name: "Học viên",
      group_name: "Nhóm 1",
      question_ids: [101, 102, 103, 104, 105],
      ...extra
    });

    const first = await call(attemptHandler, realStart());
    assert.equal(first.status, 200);
    const session = db.tables.quiz_attempt_sessions[0];
    assert.equal(session.timer_seconds, 45, "timer comes from the exam, not the browser");
    assert.equal(session.scoring_method, 2);

    const second = await call(attemptHandler, realStart());
    assert.equal(second.status, 409);
    assert.match(second.body.error, /hết số lượt/);

    assert.equal(
      (
        await call(
          attemptHandler,
          realStart({ student_name: "Người khác", question_ids: [1, 2, 3, 4, 5] })
        )
      ).status,
      400
    );

    seedRealExam({ manual_running: false });
    assert.equal((await call(attemptHandler, realStart({ student_name: "B" }))).status, 409);
    seedRealExam({ start_at: new Date(Date.now() + 60_000).toISOString() });
    assert.equal((await call(attemptHandler, realStart({ student_name: "C" }))).status, 409);
    seedRealExam({ end_at: new Date(Date.now() - 60_000).toISOString() });
    assert.equal((await call(attemptHandler, realStart({ student_name: "D" }))).status, 409);
  }
);

Deno.test("real exam submit saves with exam metadata and exam scoring method", async () => {
  seed();
  seedRealExam();
  const { body } = await call(attemptHandler, {
    action: "start",
    slug: "demo",
    mode: "real",
    exam_code: 12345,
    student_name: "Học viên",
    group_name: "Nhóm 1",
    question_ids: [101, 102, 103, 104, 105]
  });
  const submitted = await call(attemptHandler, {
    action: "submit",
    attempt_id: body.attempt_id,
    selections: { 101: ["B"], 102: ["B"], 103: ["B"], 104: ["B"], 105: ["B"] },
    save: true
  });
  assert.equal(submitted.status, 200);
  const [attempt] = db.tables.quiz_attempts;
  assert.equal(attempt.mode, "real");
  assert.equal(attempt.real_exam_code, 12345);
  assert.equal(attempt.real_exam_revision_id, 70);
  assert.equal(attempt.scoring_method, 2);
  assert.ok(Number(attempt.score) >= 95);
});

Deno.test("rate limit returns 429 once the window is exhausted", async () => {
  seed();
  let last = 0;
  for (let index = 0; index < 125; index += 1) {
    last = (await call(attemptHandler, mockStart({ question_ids: [1, 2, 3, 4, 99] }))).status;
  }
  assert.equal(last, 429);
});

Deno.test("unexpected database errors are hidden behind a generic message", async () => {
  seed();
  db.failTable = "spaces";
  const response = await call(attemptHandler, mockStart());
  assert.equal(response.status, 500);
  assert.ok(!JSON.stringify(response.body).includes("secret internal table detail"));
});

Deno.test("quiz-evaluate check: only visible questions of a published Space", async () => {
  seed();
  db.tables.questions[1].hidden_at = new Date().toISOString();
  const good = await call(evaluateHandler, {
    action: "check",
    slug: "demo",
    question_id: 1,
    selected: ["A"]
  });
  assert.deepEqual(good.body, { correct: ["A"], is_correct: true });
  const wrong = await call(evaluateHandler, {
    action: "check",
    slug: "demo",
    question_id: 1,
    selected: ["B"]
  });
  assert.equal(wrong.body.is_correct, false);
  assert.equal(
    (await call(evaluateHandler, { action: "check", slug: "demo", question_id: 2, selected: [] }))
      .status,
    404
  );
  assert.equal(
    (
      await call(evaluateHandler, {
        action: "check",
        slug: "demo",
        question_id: 1,
        selected: ["a"]
      })
    ).status,
    400
  );
  // The removed bulk "answers" action must not exist any more.
  assert.equal(
    (await call(evaluateHandler, { action: "answers", slug: "demo", question_ids: [1, 3] })).status,
    400
  );
});

Deno.test("quiz-evaluate review scores a practice run without saving", async () => {
  seed();
  const review = await call(evaluateHandler, {
    action: "review",
    slug: "demo",
    question_ids: [1, 2, 3, 4, 5],
    question_set_ids: [],
    selections: { 1: ["A"], 2: ["A"] },
    timer_seconds: null,
    duration_seconds: 30
  });
  assert.equal(review.status, 200);
  assert.equal(review.body.breakdown.correct_count, 2);
  assert.equal(review.body.breakdown.wrong_count, 3);
  assert.equal(db.tables.quiz_attempts.length, 0);
});

Deno.test("admin-users requires a superadmin and protects the last one", async () => {
  seed();
  db.tables.profiles = [
    { id: "11111111-1111-4111-8111-111111111111", role: "superadmin", active: true },
    { id: "22222222-2222-4222-8222-222222222222", role: "admin", active: true }
  ];
  db.users = {
    "super-token": "11111111-1111-4111-8111-111111111111",
    "admin-token": "22222222-2222-4222-8222-222222222222"
  };
  const demote = {
    action: "update",
    id: "11111111-1111-4111-8111-111111111111",
    fullname: "X",
    role: "admin",
    active: true
  };
  assert.equal((await call(adminHandler, demote)).status, 401);
  assert.equal((await call(adminHandler, demote, { Authorization: "Bearer nope" })).status, 401);
  assert.equal(
    (await call(adminHandler, demote, { Authorization: "Bearer admin-token" })).status,
    403
  );
  // The only superadmin may not demote or delete themself.
  assert.equal(
    (await call(adminHandler, demote, { Authorization: "Bearer super-token" })).status,
    409
  );
  assert.equal(
    (
      await call(
        adminHandler,
        { action: "delete", id: demote.id },
        { Authorization: "Bearer super-token" }
      )
    ).status,
    409
  );
  // Weak passwords are rejected on reset.
  const weak = await call(
    adminHandler,
    { action: "reset_password", id: "22222222-2222-4222-8222-222222222222", password: "short" },
    { Authorization: "Bearer super-token" }
  );
  assert.equal(weak.status, 400);
});
