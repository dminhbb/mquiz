import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return json({ ok: true });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey);
    const body = await request.json();
    const slug = String(body.slug || "");
    const { data: space } = await admin.from("spaces").select("id,published").eq("slug", slug).single();
    if (!space?.published) throw new Error("Space không tồn tại.");
    const examCode = Number(body.exam_code || 0);
    let realExamId = 0;
    let realExamRevisionId = 0;
    if (examCode) {
      const { data: exam } = await admin
        .from("real_exams")
        .select("id,manual_running,current_revision_id")
        .eq("code", examCode)
        .eq("space_id", space.id)
        .is("hidden_at", null)
        .single();
      if (!exam) throw new Error("Đợt thi thật không tồn tại.");
      if (!exam.manual_running) throw new Error("Đợt thi đã tạm dừng.");
      realExamId = Number(exam.id);
      realExamRevisionId = Number(exam.current_revision_id || 0);
    }

    if (body.action === "check") {
      let question: { id?: number; question_code?: number; correct_json: unknown } | null = null;
      if (realExamId) {
        const questionCode = Number(body.question_id);
        const { data: snapshot, error: snapshotError } = await admin
          .from("real_exam_revision_question_snapshots")
          .select("question_code,correct_json")
          .eq("revision_id", realExamRevisionId)
          .eq("question_code", questionCode)
          .maybeSingle();
        if (!snapshotError && snapshot) {
          question = snapshot;
        } else {
          // Backwards compatibility: active revisions created before the snapshot
          // migration still have the canonical real_exam_question_refs relation.
          const { data: reference } = await admin
            .from("real_exam_question_refs")
            .select("question_code")
            .eq("real_exam_id", realExamId)
            .eq("question_code", questionCode)
            .maybeSingle();
          if (reference) {
            const response = await admin
              .from("questions")
              .select("question_code,correct_json")
              .eq("question_code", questionCode)
              .maybeSingle();
            question = response.data;
          }
        }
      } else {
        const response = await admin
          .from("questions")
          .select("id,correct_json")
          .eq("id", Number(body.question_id))
          .eq("space_id", space.id)
          .is("hidden_at", null)
          .single();
        question = response.data;
      }
      if (!question) throw new Error("Câu hỏi không tồn tại.");
      const correct = normalized(question.correct_json);
      const selected = normalized(body.selected);
      return json({ correct, is_correct: sameAnswer(selected, correct) });
    }

    if (body.action === "answers") {
      const ids = Array.isArray(body.question_ids) ? body.question_ids.map(Number) : [];
      let questions: Array<{ id?: number; question_code?: number; correct_json: unknown }> = [];
      let queryError: unknown = null;
      if (realExamId) {
        const response = await admin
          .from("real_exam_revision_question_snapshots")
          .select("question_code,correct_json")
          .eq("revision_id", realExamRevisionId)
          .in("question_code", ids);
        if (!response.error && response.data?.length) {
          questions = response.data;
        } else {
          const { data: references, error: referenceError } = await admin
            .from("real_exam_question_refs")
            .select("question_code")
            .eq("real_exam_id", realExamId)
            .in("question_code", ids);
          if (referenceError) throw referenceError;
          const allowedCodes = (references || []).map((item) => Number(item.question_code));
          if (allowedCodes.length) {
            const fallback = await admin
              .from("questions")
              .select("question_code,correct_json")
              .in("question_code", allowedCodes);
            questions = fallback.data || [];
            queryError = fallback.error;
          }
        }
      } else {
        const response = await admin
          .from("questions")
          .select("id,correct_json")
          .eq("space_id", space.id)
          .is("hidden_at", null)
          .in("id", ids);
        questions = response.data || [];
        queryError = response.error;
      }
      if (queryError) throw queryError;
      const answers: Record<string, string[]> = {};
      for (const question of questions) {
        const id = question.question_code ?? question.id;
        if (id !== undefined) answers[id] = normalized(question.correct_json);
      }
      return json({ answers });
    }

    throw new Error("Unsupported action");
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 400);
  }
});

function normalized(value: unknown) {
  return [...new Set(Array.isArray(value) ? value.map(String) : [])].sort();
}

function sameAnswer(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
