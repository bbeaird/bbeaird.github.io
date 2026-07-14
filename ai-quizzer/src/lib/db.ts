import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "quizzer.db");

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  streak_count INTEGER NOT NULL DEFAULT 0,
  last_quiz_date TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  subtopic TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'mc',        -- 'mc' | 'tf'
  difficulty INTEGER NOT NULL DEFAULT 1,  -- 1 recall, 2 application, 3 nuance
  prompt TEXT NOT NULL,
  options TEXT NOT NULL,                  -- JSON array of strings
  correct_index INTEGER NOT NULL,
  explanation TEXT NOT NULL,
  nuance TEXT,                            -- extra note shown on correct answers
  source_title TEXT,
  source_url TEXT,
  source_date TEXT,                       -- content date, ISO
  evergreen INTEGER NOT NULL DEFAULT 1,   -- 0 = time-sensitive, subject to staleness review
  status TEXT NOT NULL DEFAULT 'published' -- 'published' | 'draft' | 'retired'
);

CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  quiz_date TEXT NOT NULL,                -- YYYY-MM-DD
  question_ids TEXT NOT NULL,             -- JSON array of question ids
  completed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, quiz_date)
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  question_id INTEGER NOT NULL REFERENCES questions(id),
  quiz_id INTEGER REFERENCES quizzes(id),
  selected_index INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  answered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mastery (
  user_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  rating REAL NOT NULL DEFAULT 1200,
  attempts_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, category)
);

CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, answered_at);
CREATE INDEX IF NOT EXISTS idx_attempts_user_question ON attempts(user_id, question_id);
CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category, status);
`;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  syncSeeds(db);
  return db;
}

// data/seed/*.json is the source of truth for the question bank; SQLite owns
// user data. Upserting by external_id on boot means content edits, newly
// approved questions, and retirements all take effect on the next deploy,
// while attempt history stays attached to the same question row.
function syncSeeds(db: Database.Database) {
  const seedDir = path.join(DATA_DIR, "seed");
  if (!fs.existsSync(seedDir)) return;

  const upsert = db.prepare(`
    INSERT INTO questions
      (external_id, category, subtopic, type, difficulty, prompt, options, correct_index,
       explanation, nuance, source_title, source_url, source_date, evergreen, status)
    VALUES
      (@external_id, @category, @subtopic, @type, @difficulty, @prompt, @options, @correct_index,
       @explanation, @nuance, @source_title, @source_url, @source_date, @evergreen, @status)
    ON CONFLICT(external_id) DO UPDATE SET
      category = excluded.category,
      subtopic = excluded.subtopic,
      type = excluded.type,
      difficulty = excluded.difficulty,
      prompt = excluded.prompt,
      options = excluded.options,
      correct_index = excluded.correct_index,
      explanation = excluded.explanation,
      nuance = excluded.nuance,
      source_title = excluded.source_title,
      source_url = excluded.source_url,
      source_date = excluded.source_date,
      evergreen = excluded.evergreen,
      status = excluded.status
  `);

  const files = fs.readdirSync(seedDir).filter((f) => f.endsWith(".json"));
  const tx = db.transaction(() => {
    for (const file of files) {
      const items = JSON.parse(fs.readFileSync(path.join(seedDir, file), "utf-8"));
      for (const q of items) {
        // Anything not explicitly published is withheld from users.
        const status = q.status === undefined || q.status === "published" ? "published" : q.status;
        upsert.run({
          external_id: q.id,
          category: q.category,
          subtopic: q.subtopic,
          type: q.type ?? "mc",
          difficulty: q.difficulty ?? 1,
          prompt: q.prompt,
          options: JSON.stringify(q.options),
          correct_index: q.correct_index,
          explanation: q.explanation,
          nuance: q.nuance ?? null,
          source_title: q.source_title ?? null,
          source_url: q.source_url ?? null,
          source_date: q.source_date ?? null,
          evergreen: q.evergreen === false ? 0 : 1,
          status,
        });
      }
    }
  });
  tx();
}

export const CATEGORIES: Record<string, string> = {
  fundamentals: "AI Fundamentals",
  models: "Models & Labs",
  tools: "Tools & Applications",
  product: "AI for Product & Business",
  news: "News & Developments",
  skills: "Practical Skills",
};
