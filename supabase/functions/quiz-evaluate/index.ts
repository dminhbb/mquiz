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

    if (body.action === "check") {
      const { data: question } = await admin
        .from("questions")
        .select("id,correct_json")
        .eq("id", Number(body.question_id))
        .eq("space_id", space.id)
        .single();
      if (!question) throw new Error("Câu hỏi không tồn tại.");
      const correct = normalized(question.correct_json);
      const selected = normalized(body.selected);
      return json({ correct, is_correct: sameAnswer(selected, correct) });
    }

    if (body.action === "answers") {
      const ids = Array.isArray(body.question_ids) ? body.question_ids.map(Number) : [];
      const { data: questions, error } = await admin
        .from("questions")
        .select("id,correct_json")
        .eq("space_id", space.id)
        .in("id", ids);
      if (error) throw error;
      const answers: Record<string, string[]> = {};
      for (const question of questions || []) answers[question.id] = normalized(question.correct_json);
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
