#!/usr/bin/env node
/**
 * Freshness audit: find published questions that may be out of date and
 * flag them for review or retirement.
 *
 * Policy (two layers):
 *   1. Rule-based: non-evergreen questions past their category's staleness
 *      window are flagged.
 *   2. LLM verification (--verify, needs ANTHROPIC_API_KEY): each flagged
 *      question is checked by Claude with web search. Verdicts:
 *        keep   — still accurate, refresh its review clock (source_date bump)
 *        update — premise still right but details drifted; needs human edit
 *        retire — no longer accurate; status set to "retired"
 *
 * Nothing is deleted, ever — retired questions keep their attempt history
 * valid; the app simply stops serving them (status != 'published').
 *
 * Usage:
 *   node scripts/freshness.mjs            # report what's stale
 *   node scripts/freshness.mjs --verify   # LLM-check flagged questions and apply verdicts
 */
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = path.join(import.meta.dirname, "..");
const SEED_DIR = path.join(ROOT, "data", "seed");
const VERIFY = process.argv.includes("--verify");

// Staleness windows (days) for non-evergreen questions, by category.
const WINDOWS = {
  news: 240,
  models: 365,
  tools: 540,
  product: 720,
  fundamentals: 720,
  skills: 720,
};

function loadSeedFiles() {
  return fs
    .readdirSync(SEED_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      file: path.join(SEED_DIR, f),
      questions: JSON.parse(fs.readFileSync(path.join(SEED_DIR, f), "utf-8")),
    }));
}

function findStale(files) {
  const now = Date.now();
  const stale = [];
  for (const { file, questions } of files) {
    for (const q of questions) {
      if (q.evergreen !== false) continue;
      if (q.status && q.status !== "published") continue;
      const anchor = q.last_verified ?? q.source_date;
      if (!anchor) continue;
      const ageDays = (now - Date.parse(anchor)) / (24 * 60 * 60 * 1000);
      const window = WINDOWS[q.category] ?? 365;
      if (ageDays > window) stale.push({ file, question: q, ageDays: Math.round(ageDays) });
    }
  }
  return stale;
}

async function verifyQuestion(client, q) {
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4000,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
    system:
      "You audit quiz questions for factual freshness. Use web search to check whether the question, its correct answer, and its explanation are still accurate TODAY. Respond with ONLY a JSON object: {\"verdict\": \"keep\"|\"update\"|\"retire\", \"reason\": \"one sentence\"}. Verdicts: keep = still fully accurate; update = premise holds but details drifted (models superseded, prices changed, better answer exists now); retire = materially wrong or misleading today.",
    messages: [
      {
        role: "user",
        content: `Question (written ${q.source_date}): ${q.prompt}\nOptions: ${JSON.stringify(
          q.options
        )}\nCorrect answer: ${q.options[q.correct_index]}\nExplanation: ${q.explanation}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") return { verdict: "update", reason: "verification refused" };
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { verdict: "update", reason: "unparseable verdict — needs human look" };
  try {
    const parsed = JSON.parse(match[0]);
    return ["keep", "update", "retire"].includes(parsed.verdict)
      ? parsed
      : { verdict: "update", reason: "invalid verdict — needs human look" };
  } catch {
    return { verdict: "update", reason: "unparseable verdict — needs human look" };
  }
}

async function main() {
  const files = loadSeedFiles();
  const total = files.reduce((n, f) => n + f.questions.length, 0);
  const stale = findStale(files);

  console.log(`Scanned ${total} question(s) across ${files.length} file(s).`);
  if (stale.length === 0) {
    console.log("Nothing is past its staleness window. ✓");
    return;
  }

  console.log(`\n${stale.length} question(s) past their staleness window:`);
  for (const s of stale) {
    console.log(`  [${s.question.category}, ${s.ageDays}d old] ${s.question.id}: ${s.question.prompt.slice(0, 90)}`);
  }

  if (!VERIFY) {
    console.log("\nRun with --verify (and ANTHROPIC_API_KEY) to check these with web search and apply verdicts.");
    return;
  }

  const client = new Anthropic();
  const touched = new Set();
  for (const s of stale) {
    let result;
    try {
      result = await verifyQuestion(client, s.question);
    } catch (err) {
      console.warn(`⚠ verification failed for ${s.question.id}: ${err.message}`);
      continue;
    }
    console.log(`  ${s.question.id}: ${result.verdict} — ${result.reason}`);
    if (result.verdict === "keep") {
      s.question.last_verified = new Date().toISOString().slice(0, 10);
    } else if (result.verdict === "retire") {
      s.question.status = "retired";
      s.question.retired_reason = result.reason;
    } else {
      s.question.status = "needs_update";
      s.question.update_reason = result.reason;
    }
    touched.add(s.file);
  }

  for (const { file, questions } of files) {
    if (touched.has(file)) {
      fs.writeFileSync(file, JSON.stringify(questions, null, 2) + "\n");
      console.log(`Updated ${path.relative(ROOT, file)}`);
    }
  }
  console.log(
    "\nDone. 'retired' and 'needs_update' questions stop being served on next deploy; review 'needs_update' ones and either fix + republish or retire them."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
