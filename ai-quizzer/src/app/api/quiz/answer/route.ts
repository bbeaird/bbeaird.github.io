import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { recordAnswer } from "@/lib/engine";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { quizId, questionId, selectedIndex } = await req.json();
  if (!Number.isInteger(quizId) || !Number.isInteger(questionId) || !Number.isInteger(selectedIndex)) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  try {
    const result = recordAnswer(user.id, quizId, questionId, selectedIndex);
    const q = result.question;
    return NextResponse.json({
      correct: result.correct,
      correctIndex: q.correct_index,
      explanation: q.explanation,
      nuance: q.nuance,
      source: q.source_title ? { title: q.source_title, url: q.source_url, date: q.source_date } : null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
