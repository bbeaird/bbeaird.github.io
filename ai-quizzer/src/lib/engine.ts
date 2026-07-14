import { getDb, CATEGORIES } from "./db";

const QUIZ_SIZE = 8;
const BASE_RATING = 1200;
// Question difficulty (1-3) mapped onto the same rating scale as user mastery.
const DIFFICULTY_RATING: Record<number, number> = { 1: 1100, 2: 1300, 3: 1500 };
const K_FACTOR = 48;

export interface QuestionRow {
  id: number;
  category: string;
  subtopic: string;
  type: string;
  difficulty: number;
  prompt: string;
  options: string;
  correct_index: number;
  explanation: string;
  nuance: string | null;
  source_title: string | null;
  source_url: string | null;
  source_date: string | null;
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getMastery(userId: number): Map<string, { rating: number; attempts: number; correct: number }> {
  const rows = getDb()
    .prepare("SELECT category, rating, attempts_count, correct_count FROM mastery WHERE user_id = ?")
    .all(userId) as { category: string; rating: number; attempts_count: number; correct_count: number }[];
  const map = new Map<string, { rating: number; attempts: number; correct: number }>();
  for (const cat of Object.keys(CATEGORIES)) {
    map.set(cat, { rating: BASE_RATING, attempts: 0, correct: 0 });
  }
  for (const r of rows) {
    map.set(r.category, { rating: r.rating, attempts: r.attempts_count, correct: r.correct_count });
  }
  return map;
}

/**
 * Selection for the daily quiz:
 *  - up to 2 slots for previously-missed questions (oldest misses first, not yet re-answered correctly)
 *  - remaining slots filled with unseen questions, weighted toward the user's weakest
 *    categories, at a difficulty near the user's mastery for that category
 */
export function selectDailyQuestions(userId: number): number[] {
  const db = getDb();
  const chosen: number[] = [];

  const missed = db
    .prepare(
      `SELECT a.question_id AS id FROM attempts a
       WHERE a.user_id = ? AND a.correct = 0
         AND NOT EXISTS (
           SELECT 1 FROM attempts a2
           WHERE a2.user_id = a.user_id AND a2.question_id = a.question_id
             AND a2.correct = 1 AND a2.answered_at > a.answered_at)
       GROUP BY a.question_id
       ORDER BY MAX(a.answered_at) ASC
       LIMIT 2`
    )
    .all(userId) as { id: number }[];
  chosen.push(...missed.map((m) => m.id));

  const mastery = getMastery(userId);
  // Weakest categories first; ties broken by fewest attempts so new users get variety.
  const catOrder = [...mastery.entries()]
    .sort((a, b) => a[1].rating - b[1].rating || a[1].attempts - b[1].attempts)
    .map(([cat]) => cat);

  const unseenStmt = db.prepare(
    `SELECT q.id, q.difficulty FROM questions q
     WHERE q.status = 'published' AND q.category = ?
       AND q.id NOT IN (SELECT question_id FROM attempts WHERE user_id = ?)
     ORDER BY RANDOM()`
  );

  let catIdx = 0;
  let exhausted = 0;
  while (chosen.length < QUIZ_SIZE && exhausted < catOrder.length) {
    const cat = catOrder[catIdx % catOrder.length];
    catIdx++;
    const rating = mastery.get(cat)!.rating;
    const targetDifficulty = rating < 1250 ? 1 : rating < 1420 ? 2 : 3;
    const candidates = (unseenStmt.all(cat, userId) as { id: number; difficulty: number }[]).filter(
      (q) => !chosen.includes(q.id)
    );
    if (candidates.length === 0) {
      exhausted++;
      continue;
    }
    exhausted = 0;
    // Prefer the target difficulty, fall back to nearest available.
    candidates.sort((a, b) => Math.abs(a.difficulty - targetDifficulty) - Math.abs(b.difficulty - targetDifficulty));
    chosen.push(candidates[0].id);
  }

  // If the bank is nearly exhausted, refill with least-recently-seen questions.
  if (chosen.length < QUIZ_SIZE) {
    const refill = db
      .prepare(
        `SELECT q.id FROM questions q
         JOIN attempts a ON a.question_id = q.id AND a.user_id = ?
         WHERE q.status = 'published'
         GROUP BY q.id ORDER BY MAX(a.answered_at) ASC LIMIT ?`
      )
      .all(userId, QUIZ_SIZE - chosen.length) as { id: number }[];
    for (const r of refill) if (!chosen.includes(r.id)) chosen.push(r.id);
  }

  return chosen.slice(0, QUIZ_SIZE);
}

export function getOrCreateTodayQuiz(userId: number) {
  const db = getDb();
  const date = todayStr();
  let quiz = db
    .prepare("SELECT * FROM quizzes WHERE user_id = ? AND quiz_date = ?")
    .get(userId, date) as { id: number; question_ids: string; completed: number } | undefined;
  if (!quiz) {
    const ids = selectDailyQuestions(userId);
    const info = db
      .prepare("INSERT INTO quizzes (user_id, quiz_date, question_ids) VALUES (?, ?, ?)")
      .run(userId, date, JSON.stringify(ids));
    quiz = { id: Number(info.lastInsertRowid), question_ids: JSON.stringify(ids), completed: 0 };
  }
  const ids = JSON.parse(quiz.question_ids) as number[];
  const questions =
    ids.length === 0
      ? []
      : (db
          .prepare(`SELECT * FROM questions WHERE id IN (${ids.map(() => "?").join(",")})`)
          .all(...ids) as QuestionRow[]);
  // Preserve selection order.
  questions.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

  const answeredRows = db
    .prepare("SELECT question_id, selected_index, correct FROM attempts WHERE quiz_id = ?")
    .all(quiz.id) as { question_id: number; selected_index: number; correct: number }[];

  return { quizId: quiz.id, date, questions, answered: answeredRows, completed: quiz.completed === 1 };
}

export function recordAnswer(userId: number, quizId: number, questionId: number, selectedIndex: number) {
  const db = getDb();
  const question = db.prepare("SELECT * FROM questions WHERE id = ?").get(questionId) as QuestionRow | undefined;
  if (!question) throw new Error("question not found");

  const quiz = db.prepare("SELECT * FROM quizzes WHERE id = ? AND user_id = ?").get(quizId, userId) as
    | { id: number; question_ids: string; quiz_date: string }
    | undefined;
  if (!quiz) throw new Error("quiz not found");
  const quizQuestionIds = JSON.parse(quiz.question_ids) as number[];
  if (!quizQuestionIds.includes(questionId)) throw new Error("question not in quiz");

  const already = db
    .prepare("SELECT id FROM attempts WHERE quiz_id = ? AND question_id = ?")
    .get(quizId, questionId);
  if (already) throw new Error("already answered");

  const correct = selectedIndex === question.correct_index ? 1 : 0;

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO attempts (user_id, question_id, quiz_id, selected_index, correct) VALUES (?, ?, ?, ?, ?)"
    ).run(userId, questionId, quizId, selectedIndex, correct);

    // Elo-style mastery update against the question's difficulty rating.
    const current = (db
      .prepare("SELECT rating, attempts_count, correct_count FROM mastery WHERE user_id = ? AND category = ?")
      .get(userId, question.category) as { rating: number; attempts_count: number; correct_count: number } | undefined) ?? {
      rating: BASE_RATING,
      attempts_count: 0,
      correct_count: 0,
    };
    const qRating = DIFFICULTY_RATING[question.difficulty] ?? 1300;
    const expected = 1 / (1 + Math.pow(10, (qRating - current.rating) / 400));
    const newRating = current.rating + K_FACTOR * (correct - expected);
    db.prepare(
      `INSERT INTO mastery (user_id, category, rating, attempts_count, correct_count)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(user_id, category) DO UPDATE SET
         rating = ?, attempts_count = attempts_count + 1, correct_count = correct_count + ?`
    ).run(userId, question.category, newRating, correct, newRating, correct);

    // Completion + streak.
    const answeredCount = (
      db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE quiz_id = ?").get(quizId) as { n: number }
    ).n;
    if (answeredCount >= quizQuestionIds.length) {
      db.prepare("UPDATE quizzes SET completed = 1 WHERE id = ?").run(quizId);
      const user = db.prepare("SELECT streak_count, last_quiz_date FROM users WHERE id = ?").get(userId) as {
        streak_count: number;
        last_quiz_date: string | null;
      };
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const newStreak = user.last_quiz_date === yesterday ? user.streak_count + 1 : user.last_quiz_date === quiz.quiz_date ? user.streak_count : 1;
      db.prepare("UPDATE users SET streak_count = ?, last_quiz_date = ? WHERE id = ?").run(
        newStreak,
        quiz.quiz_date,
        userId
      );
    }
  });
  tx();

  return { correct: correct === 1, question };
}
