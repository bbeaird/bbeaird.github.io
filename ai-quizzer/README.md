# AI Quizzer ⚡

An adaptive quiz app for people who consume lots of AI content (podcasts, newsletters, courses) but don't test themselves. A ~3-minute daily quiz, an explanation for every answer (right or wrong), per-topic mastery tracking, and difficulty that ramps as you improve.

**Status: Phase 1 MVP** — auth, daily quiz, 90-question seeded bank with source citations, adaptive selection, mastery dashboard, streaks.

## Quick start

```bash
npm install
npm run dev
# open http://localhost:3000, sign up, take today's quiz
```

The SQLite database is created and seeded automatically on first request (from `data/seed/*.json`). No external services required.

For production, set `AIQ_SECRET` (session-signing secret) in the environment.

## Architecture

Deliberately boring, optimized for a solo maintainer:

- **Next.js 15 (App Router) + TypeScript** — one deployable unit, server components for pages, route handlers for the API.
- **SQLite via better-sqlite3** — zero-ops persistence; the whole database is one file (`data/quizzer.db`). Swap for Postgres when multi-instance hosting matters.
- **Hand-rolled auth** — email + scrypt-hashed passwords, HMAC-signed session cookies. No auth service dependency. Google OAuth is a Phase 2 add.
- **No CSS framework** — one `globals.css`, dark theme.

### Data model

| Table | Purpose |
|---|---|
| `users` | email, password hash, streak count, last quiz date |
| `questions` | prompt, options, correct answer, explanation, nuance note, source citation (title/url/date), category, subtopic, difficulty (1 recall / 2 application / 3 nuance), `evergreen` flag, status |
| `quizzes` | one row per user per day; stores the selected question IDs |
| `attempts` | every answer: question, selection, correctness, timestamp |
| `mastery` | per user × category: Elo-style rating, attempt/correct counts |

### Adaptivity (v1)

- **Mastery** is an Elo-style rating per category (start 1200). Each answer is a "match" against the question's difficulty rating (1100/1300/1500); win/lose moves your rating.
- **Daily quiz selection** (8 questions): up to 2 slots replay previously-missed questions not yet redeemed; remaining slots pull unseen questions, cycling through categories weakest-first, at a difficulty near your current rating (recall → application → nuance as you improve).
- **Staleness**: every question carries a content date and an `evergreen` flag. Non-evergreen questions (model comparisons, news) are candidates for review/retirement — enforcement is a Phase 2 pipeline job.

### Content & sourcing rules

- Questions are **original**, inspired by reputable sources (The AI Daily Brief, Lenny's Newsletter/Podcast, Andrew Ng's The Batch, official lab docs and announcements, papers). No transcript/newsletter text is reproduced.
- Every explanation cites its source (shown to the user with a link where a stable one exists).
- The seed bank (`data/seed/*.json`) was AI-generated and **needs owner review** before any commercial use — treat it as the first batch through the future review queue.

## Roadmap

- **Phase 2**: spaced-repetition scheduling (FSRS-style) for misses, content pipeline (source → LLM-drafted questions → admin review queue), weekly "what happened in AI" quiz, staleness enforcement, Google OAuth.
- **Phase 3**: confidence-based answering + calibration stats, Stripe billing (freemium), leaderboards/team plans.

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/signup` `/api/auth/login` `/api/auth/logout` | POST | session management |
| `/api/quiz/today` | GET | get/create today's quiz (answers withheld until submitted) |
| `/api/quiz/answer` | POST | submit an answer; returns correctness, explanation, nuance, source |
