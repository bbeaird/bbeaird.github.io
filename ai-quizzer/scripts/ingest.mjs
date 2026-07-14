#!/usr/bin/env node
/**
 * Weekly content ingestion: pull new items from source RSS feeds, have Claude
 * draft original quiz questions (with citations) from them, and write the
 * drafts to data/review/ for human approval.
 *
 * Drafts are NEVER served to users — the app only loads data/seed/*.json.
 * Approval = review the PR, edit as needed, move approved questions into a
 * file under data/seed/.
 *
 * Usage:
 *   node scripts/ingest.mjs             # fetch feeds + generate drafts (needs ANTHROPIC_API_KEY)
 *   node scripts/ingest.mjs --dry-run   # fetch feeds and list new items only
 *   node scripts/ingest.mjs --max-items 5
 */
import fs from "fs";
import path from "path";
import Parser from "rss-parser";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = path.join(import.meta.dirname, "..");
const SOURCES_PATH = path.join(ROOT, "data", "sources.json");
const STATE_PATH = path.join(ROOT, "data", "pipeline-state.json");
const REVIEW_DIR = path.join(ROOT, "data", "review");

const DRY_RUN = process.argv.includes("--dry-run");
const MAX_ITEMS = Number(process.argv[process.argv.indexOf("--max-items") + 1]) || 12;
const LOOKBACK_DAYS = 10; // safety overlap beyond last run

const CATEGORIES = {
  fundamentals: "AI fundamentals (how LLMs work, RAG, embeddings, agents, evals, MCP)",
  models: "Models & labs landscape (frontier models, open weights, pricing, capabilities)",
  tools: "Tools & applications (coding assistants, agent frameworks, media models, vertical apps)",
  product: "AI for product & business (strategy, UX patterns, cost/latency, adoption, pricing)",
  news: "News & developments (releases, research results, industry and policy moves)",
  skills: "Practical skills (prompt/context engineering, evaluation, technique choice)",
};

const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: Object.keys(CATEGORIES) },
          subtopic: { type: "string" },
          type: { type: "string", enum: ["mc", "tf"] },
          difficulty: { type: "integer", enum: [1, 2, 3] },
          prompt: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correct_index: { type: "integer" },
          explanation: { type: "string" },
          nuance: { type: "string" },
          evergreen: { type: "boolean" },
        },
        required: [
          "category", "subtopic", "type", "difficulty", "prompt",
          "options", "correct_index", "explanation", "nuance", "evergreen",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You draft quiz questions for AI Quizzer, an adaptive quiz app that helps people retain AI knowledge from content they consume.

Rules:
- Write ORIGINAL questions inspired by the source material. Never reproduce the source text verbatim — copyright matters.
- Only write questions about claims actually supported by the provided source summary. Do not invent facts, numbers, or announcements.
- Skip promotional/sponsor content and items with no real informational substance (return fewer or zero questions rather than padding).
- Multiple choice questions need exactly 4 plausible options; true/false needs exactly ["True", "False"].
- "explanation" teaches: why the right answer is right and why tempting wrong options are wrong (2-3 sentences).
- "nuance" adds one deeper insight for someone who answered correctly.
- Difficulty: 1 = recall, 2 = application/scenario, 3 = nuanced tradeoff.
- "evergreen": false for anything time-sensitive (specific model versions, prices, news events); true for durable concepts.
- Every question must stand alone without the source in front of the reader — never say "according to this article".`;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return { lastRunAt: null };
  }
}

async function fetchNewItems() {
  const { sources } = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf-8"));
  const state = loadState();
  const cutoff = new Date(
    Math.min(
      state.lastRunAt ? Date.parse(state.lastRunAt) : Date.now(),
      Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    )
  );

  const parser = new Parser({ timeout: 20000 });
  const items = [];
  for (const source of sources) {
    try {
      const feed = await parser.parseURL(source.feed);
      for (const entry of feed.items ?? []) {
        const published = entry.isoDate ? new Date(entry.isoDate) : null;
        if (!published || published < cutoff) continue;
        items.push({
          source: source.name,
          category_hint: source.category_hint,
          title: entry.title?.trim() ?? "(untitled)",
          link: entry.link ?? source.site,
          published: published.toISOString().slice(0, 10),
          summary: (entry.contentSnippet ?? entry.content ?? "")
            .replace(/\s+/g, " ")
            .slice(0, 4000),
        });
      }
      console.log(`✓ ${source.name}: fetched`);
    } catch (err) {
      console.warn(`⚠ ${source.name}: skipped (${err.message})`);
    }
  }
  items.sort((a, b) => (a.published < b.published ? 1 : -1));
  return items.slice(0, MAX_ITEMS);
}

async function draftQuestions(client, item) {
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: QUESTION_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Draft 1-3 quiz questions from this source item. Category descriptions:\n${Object.entries(
          CATEGORIES
        )
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n")}\n\nSource: ${item.source}\nTitle: ${item.title}\nPublished: ${item.published}\nLink: ${item.link}\nSummary:\n${item.summary}\n\nLean toward the "${item.category_hint}" category when it fits, but choose whatever category is truly best per question. If the item has no quiz-worthy substance, return an empty questions array.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    console.warn(`⚠ generation refused for "${item.title}"`);
    return [];
  }
  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  const parsed = JSON.parse(text);
  return (parsed.questions ?? []).map((q, i) => ({
    id: `gen-${item.published}-${slug(item.title)}-${i + 1}`,
    ...q,
    source_title: `${item.source} — ${item.title}`,
    source_url: item.link,
    source_date: item.published,
    status: "draft",
  }));
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

async function main() {
  const items = await fetchNewItems();
  console.log(`\n${items.length} new item(s) since last run:`);
  for (const item of items) console.log(`  [${item.published}] ${item.source}: ${item.title}`);

  if (DRY_RUN) {
    console.log("\n--dry-run: skipping question generation.");
    return;
  }
  if (items.length === 0) {
    console.log("Nothing to generate.");
    return;
  }

  const client = new Anthropic();
  const drafts = [];
  for (const item of items) {
    try {
      const questions = await draftQuestions(client, item);
      console.log(`  → ${questions.length} draft(s) from "${item.title}"`);
      drafts.push(...questions);
    } catch (err) {
      console.warn(`⚠ generation failed for "${item.title}": ${err.message}`);
    }
  }

  if (drafts.length > 0) {
    fs.mkdirSync(REVIEW_DIR, { recursive: true });
    const outPath = path.join(REVIEW_DIR, `${new Date().toISOString().slice(0, 10)}.json`);
    const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, "utf-8")) : [];
    fs.writeFileSync(outPath, JSON.stringify([...existing, ...drafts], null, 2) + "\n");
    console.log(`\nWrote ${drafts.length} draft question(s) to ${path.relative(ROOT, outPath)}`);
    console.log("Review them, edit as needed, then move approved questions into data/seed/.");
  } else {
    console.log("\nNo drafts generated.");
  }

  fs.writeFileSync(STATE_PATH, JSON.stringify({ lastRunAt: new Date().toISOString() }, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
