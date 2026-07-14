import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateTodayQuiz } from "@/lib/engine";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const quiz = getOrCreateTodayQuiz(user.id);
  return NextResponse.json({
    quizId: quiz.quizId,
    date: quiz.date,
    completed: quiz.completed,
    answered: quiz.answered,
    // The correct answer and explanation are intentionally not sent until the
    // question is answered — see the answer endpoint.
    questions: quiz.questions.map((q) => ({
      id: q.id,
      category: q.category,
      subtopic: q.subtopic,
      type: q.type,
      difficulty: q.difficulty,
      prompt: q.prompt,
      options: JSON.parse(q.options),
    })),
  });
}
