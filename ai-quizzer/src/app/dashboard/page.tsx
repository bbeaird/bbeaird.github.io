import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDb, CATEGORIES } from "@/lib/db";
import { getMastery } from "@/lib/engine";

// Rough mapping of Elo rating onto a 0–100 mastery display scale.
function ratingToPct(rating: number): number {
  return Math.max(2, Math.min(100, Math.round(((rating - 1000) / 600) * 100)));
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const db = getDb();
  const mastery = getMastery(user.id);

  const totals = db
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS c FROM attempts WHERE user_id = ?")
    .get(user.id) as { n: number; c: number };

  const recent = db
    .prepare(
      `SELECT a.correct, a.answered_at, q.prompt, q.category
       FROM attempts a JOIN questions q ON q.id = a.question_id
       WHERE a.user_id = ? ORDER BY a.answered_at DESC LIMIT 15`
    )
    .all(user.id) as { correct: number; answered_at: string; prompt: string; category: string }[];

  const entries = [...mastery.entries()];
  const attempted = entries.filter(([, m]) => m.attempts > 0);
  const weakest =
    attempted.length > 0 ? attempted.sort((a, b) => a[1].rating - b[1].rating)[0] : null;

  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", marginTop: "1rem" }}>Your progress</h1>

      <div className="stat-row">
        <div className="stat-tile">
          <div className="value">{user.streak_count} 🔥</div>
          <div className="label">Day streak</div>
        </div>
        <div className="stat-tile">
          <div className="value">{totals.n}</div>
          <div className="label">Questions answered</div>
        </div>
        <div className="stat-tile">
          <div className="value">{totals.n > 0 ? Math.round((totals.c / totals.n) * 100) : 0}%</div>
          <div className="label">Overall accuracy</div>
        </div>
      </div>

      {weakest && (
        <div className="callout">
          🎯 Your weakest area is <strong>{CATEGORIES[weakest[0]]}</strong> — it&apos;ll show up
          more often in your daily quizzes until it catches up.
        </div>
      )}

      <div className="section">
        <h2>Mastery by category</h2>
        {[...mastery.entries()].map(([cat, m]) => (
          <div className="mastery-row" key={cat}>
            <span>{CATEGORIES[cat]}</span>
            <div className="mastery-bar">
              <div style={{ width: `${m.attempts > 0 ? ratingToPct(m.rating) : 0}%` }} />
            </div>
            <span className="mastery-score">
              {m.attempts > 0 ? `${ratingToPct(m.rating)} · ${m.correct}/${m.attempts}` : "—"}
            </span>
          </div>
        ))}
      </div>

      <div className="section">
        <h2>Recent answers</h2>
        {recent.length === 0 ? (
          <p className="empty">
            Nothing yet — <Link href="/quiz">take today&apos;s quiz</Link> to get started.
          </p>
        ) : (
          recent.map((r, i) => (
            <div className="history-item" key={i}>
              <span className={`mark ${r.correct ? "right" : "wrong"}`}>{r.correct ? "✓" : "✗"}</span>
              <span>{r.prompt}</span>
              <span className="when">{r.answered_at.slice(0, 10)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
