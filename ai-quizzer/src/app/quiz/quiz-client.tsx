"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const CATEGORY_LABELS: Record<string, string> = {
  fundamentals: "AI Fundamentals",
  models: "Models & Labs",
  tools: "Tools & Applications",
  product: "Product & Business",
  news: "News & Developments",
  skills: "Practical Skills",
};

const DIFFICULTY_LABELS: Record<number, string> = { 1: "Recall", 2: "Application", 3: "Nuance" };

interface Question {
  id: number;
  category: string;
  subtopic: string;
  type: string;
  difficulty: number;
  prompt: string;
  options: string[];
}

interface QuizData {
  quizId: number;
  date: string;
  completed: boolean;
  answered: { question_id: number; selected_index: number; correct: number }[];
  questions: Question[];
}

interface Feedback {
  correct: boolean;
  correctIndex: number;
  explanation: string;
  nuance: string | null;
  source: { title: string; url: string | null; date: string | null } | null;
}

export function QuizClient() {
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [results, setResults] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/quiz/today")
      .then((r) => r.json())
      .then((data: QuizData) => {
        setQuiz(data);
        // Resume where the user left off if some questions are already answered.
        const answeredIds = new Set(data.answered.map((a) => a.question_id));
        const firstUnanswered = data.questions.findIndex((q) => !answeredIds.has(q.id));
        setResults(data.questions.filter((q) => answeredIds.has(q.id)).map((q) => {
          const a = data.answered.find((x) => x.question_id === q.id)!;
          return a.correct === 1;
        }));
        setIndex(firstUnanswered === -1 ? data.questions.length : firstUnanswered);
      })
      .catch(() => setError("Could not load today's quiz."));
  }, []);

  if (error) return <p className="empty">{error}</p>;
  if (!quiz) return <p className="empty">Loading today&apos;s quiz…</p>;
  if (quiz.questions.length === 0)
    return <p className="empty">No questions available yet — the question bank needs seeding.</p>;

  const done = index >= quiz.questions.length;
  if (done) {
    const score = results.filter(Boolean).length;
    return (
      <div className="quiz-card quiz-summary">
        <p className="tag">Daily quiz · {quiz.date}</p>
        <p className="score">
          {score}/{results.length}
        </p>
        <p style={{ color: "var(--text-dim)", marginBottom: "1.5rem" }}>
          {score === results.length
            ? "Perfect score. Tomorrow gets harder. 😏"
            : score >= results.length / 2
              ? "Solid. Your misses will come back in future quizzes until you own them."
              : "Rough one — but every miss is now queued for review. That's the point."}
        </p>
        <Link href="/dashboard" className="btn">
          View your dashboard
        </Link>
      </div>
    );
  }

  const q = quiz.questions[index];

  async function answer(i: number) {
    if (selected !== null) return;
    setSelected(i);
    const res = await fetch("/api/quiz/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quizId: quiz!.quizId, questionId: q.id, selectedIndex: i }),
    });
    if (!res.ok) {
      setSelected(null);
      setError("Failed to submit answer — please refresh and try again.");
      return;
    }
    const fb: Feedback = await res.json();
    setFeedback(fb);
    setResults((r) => [...r, fb.correct]);
  }

  function next() {
    setSelected(null);
    setFeedback(null);
    setIndex((i) => i + 1);
  }

  return (
    <div className="quiz-card">
      <div className="quiz-meta">
        <span className="tag">{CATEGORY_LABELS[q.category] ?? q.category}</span>
        <span className="tag dim">{q.subtopic}</span>
        <span className="tag dim">{DIFFICULTY_LABELS[q.difficulty]}</span>
        <span className="tag dim" style={{ marginLeft: "auto" }}>
          {index + 1} / {quiz.questions.length}
        </span>
      </div>

      <p className="question-prompt">{q.prompt}</p>

      <div className="options">
        {q.options.map((opt, i) => {
          let cls = "option";
          if (feedback) {
            if (i === feedback.correctIndex) cls += " correct";
            else if (i === selected) cls += " incorrect";
          }
          return (
            <button key={i} className={cls} disabled={selected !== null} onClick={() => answer(i)}>
              {opt}
            </button>
          );
        })}
      </div>

      {feedback && (
        <div className="explanation">
          <p className={`verdict ${feedback.correct ? "right" : "wrong"}`}>
            {feedback.correct ? "Correct!" : "Not quite."}
          </p>
          <p>{feedback.explanation}</p>
          {feedback.nuance && <p className="nuance">💡 {feedback.nuance}</p>}
          {feedback.source && (
            <p className="source">
              Source:{" "}
              {feedback.source.url ? (
                <a href={feedback.source.url} target="_blank" rel="noreferrer">
                  {feedback.source.title}
                </a>
              ) : (
                feedback.source.title
              )}
              {feedback.source.date && ` (${feedback.source.date})`}
            </p>
          )}
        </div>
      )}

      <div className="quiz-nav">
        <div className="progress-bar" style={{ flex: 1, marginTop: 0, marginRight: "1rem" }}>
          <div style={{ width: `${(results.length / quiz.questions.length) * 100}%` }} />
        </div>
        {feedback && (
          <button className="btn" onClick={next}>
            {index + 1 < quiz.questions.length ? "Next" : "Finish"}
          </button>
        )}
      </div>
    </div>
  );
}
