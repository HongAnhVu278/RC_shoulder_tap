# AI-Recommended People Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After search results are gathered from Recurse and Zulip, send the combined data to a local Ollama model and print a ranked top-3 list of people to reach out to, with one-line reasons and direct links to their profile and Zulip topics.

**Architecture:** New `utils/recommend-person.ts` owns the recommendation prompt + JSON schema and calls the existing generic `chatStructured` wrapper in `utils/ollama.ts`. `utils/zulip-search.ts` is refactored to expose results as data (not just stdout). `index.ts` collects results across all effective queries into accumulators, trims them via a `--context` preset flag, calls the recommender once at the end, and resolves slugs/topics back to real URLs.

**Tech Stack:** Bun, TypeScript, `ollama` npm package (v0.6.3), local Ollama server (default model `llama3.2`).

**Spec:** `docs/superpowers/specs/2026-04-07-ai-recommend-person-design.md`

---

## Important Context for the Implementer

**Read the spec first.** Every architectural decision, edge case, and JSON schema lives in the spec file above. This plan tells you the order of operations and the exact code to write; the spec tells you why.

**Project conventions:**

- This is a Bun project. Use `bun` commands, not `node` or `npm`. Bun auto-loads `.env`.
- Run the CLI with `bun index.ts <args>` — there is no build step.
- TypeScript strict mode is on. Run `bunx tsc --noEmit` to typecheck.
- **No automated tests.** The user explicitly asked to skip test-level verification for this project: _"I think we're going a little off the rails trying to mock ollama. Let's skip that level of testing for now. This isn't that serious a project."_ Manual end-to-end verification only.
- **No commits during implementation.** The user handles commits themselves: _"Don't worry about committing along the way. We'll do that."_ Do not run `git add` or `git commit` in any task.
- Existing AI features (`utils/ollama.ts`, `utils/suggest-keywords.ts`) established a two-layer pattern: a generic `chatStructured` wrapper plus a thin feature module that owns its prompt and schema. Follow the same pattern for `recommend-person.ts`.

**What "done" looks like for each task:** typecheck is clean (`bunx tsc --noEmit`) and the manual check listed at the end of the task passes.

**What to avoid:**

- Don't add `--no-recommend` or any opt-out flag. The recommendation IS the feature.
- Don't validate that model-returned names actually appear in input data. Hallucinations are accepted; missing URLs are the signal.
- Don't add per-query recommendation blocks. One unified recommendation at the end across all effective queries.
- Don't dedupe if the model lists the same person twice.
- Don't add caching, retry, streaming, or parallel Ollama calls.
- Don't rewrite `utils/zulip-api.ts`. It has two pre-existing `noUncheckedIndexedAccess` warnings (lines 82 and 129) — leave them alone; they are not in scope.

---

## File Structure

```
utils/
  ollama.ts                ← UNCHANGED
  suggest-keywords.ts      ← UNCHANGED
  recommend-person.ts      ← NEW: owns recommendation prompt + schema, exports recommendPerson()
  zulip-search.ts          ← MODIFIED: add gatherZulipResults(), export printTopicResults + stripMarkdown
  rc-api.ts                ← MODIFIED: bump RC API limit from 2 to 10
  zulip-api.ts             ← UNCHANGED
index.ts                   ← MODIFIED: accumulate results, new --context flag, call recommender at end
```

Each file keeps a single clear responsibility:

- `utils/recommend-person.ts` owns the recommendation domain logic (prompt, schema, I/O types). It knows nothing about URL building or output formatting.
- `utils/zulip-search.ts` owns Zulip result gathering and printing. After this change it exposes both a data-returning function and a printing function, so `index.ts` can collect data AND print it.
- `index.ts` owns orchestration: flag parsing, the per-query loop, trimming, calling the recommender, and resolving recommendations to URLs.

---

## Task 1: Bump RC API result limit from 2 to 10

The recommender needs more than two candidates to pick from. This is a one-line change.

**Files:**
- Modify: `utils/rc-api.ts:4`

- [ ] **Step 1: Change the limit**

Edit `utils/rc-api.ts` line 4:

```ts
RecurseAPIURL.searchParams.set("limit", "10")
```

(Was `"2"`.)

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 3: Manual check**

Run: `bun index.ts --no-suggest --recurse "rust"`
Expected: The printed RC API URL contains `limit=10`, and (if the query matches real people) up to 10 profiles come back instead of 2.

---

## Task 2: Refactor `utils/zulip-search.ts` to expose data + printing separately

Currently `runZulipSearch` fetches, prints, and returns `void`. We need `index.ts` to both print results to the user AND collect the raw `TopicResult[]` for the recommender. Refactor so `runZulipSearch` becomes a thin wrapper around a new data-returning function, and `printTopicResults` + `stripMarkdown` become exports so `index.ts` can use them directly.

**Files:**
- Modify: `utils/zulip-search.ts` (entire file)

- [ ] **Step 1: Add `gatherZulipResults` and export `printTopicResults` + `stripMarkdown`**

Replace the contents of `utils/zulip-search.ts` with:

```ts
import { searchTopics, type TopicResult } from "./zulip-api";

/**
 * Fetches Zulip topic results for a query. Returns [] on error (after printing
 * the error to stderr), so callers can keep running other searches.
 */
export async function gatherZulipResults(query: string): Promise<TopicResult[]> {
  console.log(`Searching for "${query}" in Zulip (last 7 days)...`);
  try {
    return await searchTopics(query);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error:", message);
    return [];
  }
}

/**
 * Thin wrapper that gathers and prints in one call. Preserved for any caller
 * that wants the old fetch+print behavior.
 */
export async function runZulipSearch(query: string): Promise<void> {
  const results = await gatherZulipResults(query);
  printTopicResults(query, results);
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\n+/g, " ")
    .trim();
}

export function printTopicResults(query: string, results: TopicResult[]): void {
  if (results.length === 0) {
    console.log(`No results found for "${query}" in the last 7 days.`);
    return;
  }

  const byChannel = new Map<string, TopicResult[]>();
  for (const result of results) {
    const bucket = byChannel.get(result.channel) ?? [];
    bucket.push(result);
    byChannel.set(result.channel, bucket);
  }

  for (const [channel, topics] of byChannel) {
    console.log(`\n=== ${channel} ===`);

    for (const { topic, lastActivity, messages } of topics) {
      const relTime = formatRelativeTime(lastActivity);
      const countLabel = messages.length === 1 ? "message" : "messages";
      console.log(`\nTopic: "${topic}"  (last active: ${relTime}, ${messages.length} ${countLabel})`);

      for (const msg of messages) {
        const text = stripMarkdown(msg.content);
        const truncated = text.slice(0, 120);
        const ellipsis = text.length > 120 ? "..." : "";
        console.log(`  [${msg.sender_full_name}]  "${truncated}${ellipsis}"`);
      }
    }
  }

  console.log();
}
```

Notes on the diff:
- `runZulipSearch` no longer calls `process.exit(1)` on error. It now returns `[]` so the rest of the run can continue.
- `gatherZulipResults` is new.
- `printTopicResults` and `stripMarkdown` are now `export`ed.
- `formatRelativeTime` stays private.

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no new errors. (The two pre-existing `noUncheckedIndexedAccess` warnings in `utils/zulip-api.ts` lines 82 and 129 are unchanged — leave them alone.)

- [ ] **Step 3: Manual check — existing Zulip behavior still works**

Run: `bun index.ts --no-suggest --zulip "rust"`
Expected: Same output as before the refactor. You should see "Searching for ... in Zulip (last 7 days)..." followed by either grouped topic output or "No results found for ... in the last 7 days."

---

## Task 3: Create `utils/recommend-person.ts`

The feature module. Owns the prompt and JSON schema for the recommendation call. Calls the generic `chatStructured` wrapper. Follows the exact same shape as `utils/suggest-keywords.ts`.

**Files:**
- Create: `utils/recommend-person.ts`

- [ ] **Step 1: Write the file**

Create `utils/recommend-person.ts` with:

```ts
import { chatStructured } from "./ollama";

export interface RcProfileSummary {
  id: number;
  name: string;
  slug: string;
  bio: string;
}

export interface ZulipMessageSummary {
  sender: string;
  channel: string;
  topic: string;
  content: string;
}

export interface Recommendation {
  name: string;
  reason: string;
  recurseProfileSlug?: string | null;
  zulipTopics?: Array<{ channel: string; topic: string }>;
}

const RECOMMENDATION_SCHEMA = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          reason: { type: "string" },
          recurseProfileSlug: { type: ["string", "null"] },
          zulipTopics: {
            type: "array",
            items: {
              type: "object",
              properties: {
                channel: { type: "string" },
                topic: { type: "string" },
              },
              required: ["channel", "topic"],
            },
          },
        },
        required: ["name", "reason"],
      },
    },
  },
  required: ["recommendations"],
} as const;

export async function recommendPerson(args: {
  query: string;
  recurseProfiles: RcProfileSummary[];
  zulipMessages: ZulipMessageSummary[];
  model?: string;
}): Promise<Recommendation[]> {
  const prompt = buildPrompt(args.query, args.recurseProfiles, args.zulipMessages);

  const response = await chatStructured<{ recommendations: Recommendation[] }>({
    prompt,
    schema: RECOMMENDATION_SCHEMA as unknown as Record<string, unknown>,
    model: args.model,
  });

  return response.recommendations ?? [];
}

function buildPrompt(
  query: string,
  profiles: RcProfileSummary[],
  messages: ZulipMessageSummary[]
): string {
  const profileBlock =
    profiles.length === 0
      ? "(no Recurse Center profiles provided)"
      : profiles
          .map(
            (p) =>
              `- name: ${p.name}\n  slug: ${p.slug}\n  bio: ${p.bio || "(no bio)"}`
          )
          .join("\n");

  const messageBlock =
    messages.length === 0
      ? "(no Zulip messages provided)"
      : messages
          .map(
            (m) =>
              `- sender: ${m.sender}\n  channel: ${m.channel}\n  topic: ${m.topic}\n  content: ${m.content}`
          )
          .join("\n");

  return [
    `You are helping a Recurse Center participant find the best people to reach out to about a topic they care about.`,
    ``,
    `The user's query was: "${query}"`,
    ``,
    `Here are the Recurse Center profiles that matched the search:`,
    profileBlock,
    ``,
    `Here are recent Zulip messages that matched the search:`,
    messageBlock,
    ``,
    `Pick the TOP 3 people most worth reaching out to about "${query}". Use their bios and Zulip activity as signal.`,
    ``,
    `For each person, return:`,
    `- name: the person's display name`,
    `- reason: ONE short line (max ~25 words) explaining why they're a good match`,
    `- recurseProfileSlug: the exact "slug" value you saw in the input profiles above, or null if none applies`,
    `- zulipTopics: any (channel, topic) pairs from the input messages above that informed your choice (may be empty)`,
    ``,
    `Do NOT invent slugs, channels, or topics. Only reference values that appear verbatim in the input above.`,
    `Return ONLY a JSON object matching the provided schema.`,
  ].join("\n");
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Smoke test the module in isolation**

Run:
```sh
bun -e 'import("./utils/recommend-person").then(async (m) => { const r = await m.recommendPerson({ query: "rust", recurseProfiles: [{ id: 1, name: "Jane Doe", slug: "1-jane-doe", bio: "Rust systems programmer" }], zulipMessages: [] }); console.log(JSON.stringify(r, null, 2)); }).catch((e) => { console.error("ERR:", e.message); process.exit(1); });'
```
Expected: A JSON array prints. It should contain at least one object with `name` and `reason`. The `recurseProfileSlug` may or may not be `"1-jane-doe"` depending on the model's behavior — that's fine, we handle both cases in Task 4.

If Ollama isn't running or the default model isn't pulled, the command will print an error. That's still a valid signal — the error path is wired through `chatStructured`.

---

## Task 4: Wire up `index.ts` — new `--context` flag, accumulators, recommender call, URL builders

This is the big task. It touches flag parsing, the per-query loop, and adds the recommendation pipeline at the end. The spec lays out every sub-piece; this task implements them all at once because the pieces only make sense together.

**Files:**
- Modify: `index.ts` (entire file)

- [ ] **Step 1: Replace the contents of `index.ts`**

Replace `index.ts` with:

```ts
import { parseArgs } from "node:util";
import { getRecurseData } from "./utils/rc-api";
import {
  gatherZulipResults,
  printTopicResults,
  stripMarkdown,
} from "./utils/zulip-search";
import type { TopicResult } from "./utils/zulip-api";
import { suggestKeywords } from "./utils/suggest-keywords";
import {
  recommendPerson,
  type RcProfileSummary,
  type Recommendation,
  type ZulipMessageSummary,
} from "./utils/recommend-person";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    recurse: { type: "boolean" },
    zulip: { type: "boolean" },
    "no-suggest": { type: "boolean" },
    model: { type: "string" },
    context: { type: "string" },
  },
  strict: true,
  allowPositionals: true,
});

const query = positionals.join(" ").trim();

if (!query) {
  printUsage();
  process.exit(1);
}

// Default: run both when neither flag is passed.
const runRecurse = values.recurse || (!values.recurse && !values.zulip);
const runZulip = values.zulip || (!values.recurse && !values.zulip);

const trimConfig = resolveTrimConfig(values.context);

const suggestionsEnabled = !values["no-suggest"];
const pickedKeywords = suggestionsEnabled
  ? await gatherKeywordSuggestions(query, values.model)
  : [];

const effectiveQueries = [query, ...pickedKeywords];

const allRcProfiles: any[] = [];
const allZulipResults: TopicResult[] = [];

for (const effectiveQuery of effectiveQueries) {
  if (effectiveQueries.length > 1) {
    console.log(`\n─── Results for "${effectiveQuery}" ───`);
  }

  if (runRecurse) {
    const apiKey = process.env.RC_API_KEY;
    if (!apiKey) {
      console.error("RC_API_KEY is not set in .env");
      process.exit(1);
    }
    const data = await getRecurseData(effectiveQuery, apiKey);
    console.log(JSON.stringify(data, null, 2));
    if (Array.isArray(data?.profiles)) {
      allRcProfiles.push(...data.profiles);
    }
  }

  if (runZulip) {
    const zulipResults = await gatherZulipResults(effectiveQuery);
    printTopicResults(effectiveQuery, zulipResults);
    allZulipResults.push(...zulipResults);
  }
}

const trimmed = {
  recurseProfiles: trimRcProfiles(allRcProfiles, trimConfig),
  zulipMessages: trimZulipResults(allZulipResults, trimConfig),
};

if (trimmed.recurseProfiles.length === 0 && trimmed.zulipMessages.length === 0) {
  console.log("\nNo results to recommend from.");
} else {
  await runRecommendation(query, trimmed, values.model, allRcProfiles, allZulipResults);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.error("Usage:");
  console.error(
    "  bun index.ts [--recurse] [--zulip] [--no-suggest] [--model <name>] [--context small|medium|large] <search query>"
  );
  console.error("");
  console.error("Search flags (accumulative; default is both):");
  console.error("  --recurse       Search the Recurse Center directory");
  console.error("  --zulip         Search Zulip topics (last 7 days)");
  console.error("");
  console.error("AI flags:");
  console.error("  --no-suggest    Skip the AI keyword suggestion step (suggestions are on by default)");
  console.error("  --model <name>  Override the Ollama model (defaults to OLLAMA_MODEL env var or 'llama3.2')");
  console.error("  --context <sz>  Trim preset for the recommender: small (default), medium, or large");
  console.error("");
  console.error("Examples:");
  console.error('  bun index.ts "machine learning"');
  console.error('  bun index.ts --recurse "jane doe"');
  console.error('  bun index.ts --no-suggest --context medium "rust"');
}

function parseSelection(input: string, suggestions: string[]): string[] {
  const trimmedInput = input.trim();
  if (trimmedInput === "") return [];
  if (trimmedInput.toLowerCase() === "all") return [...suggestions];

  const parts = trimmedInput.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  const looksNumeric = parts.every((p) => /^\d+$/.test(p));
  if (!looksNumeric) {
    console.error(`⚠ Couldn't parse "${trimmedInput}". Skipping suggestions.`);
    return [];
  }

  const picked: string[] = [];
  for (const part of parts) {
    const idx = Number(part) - 1;
    if (idx < 0 || idx >= suggestions.length) {
      console.error(`⚠ Ignoring out-of-range index: ${part}`);
      continue;
    }
    picked.push(suggestions[idx]!);
  }
  return [...new Set(picked)];
}

async function gatherKeywordSuggestions(
  query: string,
  model: string | undefined
): Promise<string[]> {
  let suggestions: string[];
  try {
    suggestions = await suggestKeywords(query, model);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`⚠ Couldn't get keyword suggestions from Ollama: ${message}`);
    console.error(`  (Pass --no-suggest to skip this step.)`);
    return [];
  }

  if (suggestions.length === 0) return [];

  console.log(`\nSuggested related keywords for "${query}":`);
  suggestions.forEach((kw, i) => {
    console.log(`  ${i + 1}) ${kw}`);
  });

  const answer =
    prompt('\nPick one or more to also search (e.g. "1,3", "all", or press Enter to skip):') ?? "";
  return parseSelection(answer, suggestions);
}

// ---------------------------------------------------------------------------
// Trim config + trimmers
// ---------------------------------------------------------------------------

interface TrimConfig {
  rcBioMaxChars: number;
  zulipMessageMaxChars: number;
  zulipMessageMaxCount: number;
}

const TRIM_PRESETS: Record<string, TrimConfig> = {
  small: { rcBioMaxChars: 300, zulipMessageMaxChars: 200, zulipMessageMaxCount: 50 },
  medium: { rcBioMaxChars: 800, zulipMessageMaxChars: 400, zulipMessageMaxCount: 100 },
  large: { rcBioMaxChars: 2000, zulipMessageMaxChars: 800, zulipMessageMaxCount: 200 },
};

function resolveTrimConfig(contextFlag: string | undefined): TrimConfig {
  const key = contextFlag ?? "small";
  const preset = TRIM_PRESETS[key];
  if (!preset) {
    console.error(`⚠ Unknown --context value "${key}". Use small, medium, or large.`);
    process.exit(1);
  }
  return preset;
}

function trimRcProfiles(profiles: any[], cfg: TrimConfig): RcProfileSummary[] {
  return profiles.map((p) => {
    const rawBio = [p.bio_rendered, p.before_rc_rendered, p.during_rc_rendered]
      .filter((s) => typeof s === "string" && s.length > 0)
      .join(" ");
    const bio = stripMarkdown(rawBio).slice(0, cfg.rcBioMaxChars);
    return { id: p.id, name: p.name, slug: p.slug, bio };
  });
}

function trimZulipResults(results: TopicResult[], cfg: TrimConfig): ZulipMessageSummary[] {
  // Sort topics by most recently active first so we keep the freshest context.
  const sortedTopics = [...results].sort(
    (a, b) => b.lastActivity.getTime() - a.lastActivity.getTime()
  );

  const flat: ZulipMessageSummary[] = [];
  for (const r of sortedTopics) {
    for (const m of r.messages) {
      flat.push({
        sender: m.sender_full_name,
        channel: r.channel,
        topic: r.topic,
        content: stripMarkdown(m.content).slice(0, cfg.zulipMessageMaxChars),
      });
      if (flat.length >= cfg.zulipMessageMaxCount) return flat;
    }
  }
  return flat;
}

// ---------------------------------------------------------------------------
// Recommendation runner + URL builders
// ---------------------------------------------------------------------------

async function runRecommendation(
  query: string,
  trimmed: {
    recurseProfiles: RcProfileSummary[];
    zulipMessages: ZulipMessageSummary[];
  },
  model: string | undefined,
  knownRcProfiles: any[],
  knownZulipResults: TopicResult[]
): Promise<void> {
  let recommendations: Recommendation[];
  try {
    recommendations = await recommendPerson({
      query,
      recurseProfiles: trimmed.recurseProfiles,
      zulipMessages: trimmed.zulipMessages,
      model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`⚠ Couldn't generate recommendations: ${message}`);
    return;
  }

  if (recommendations.length === 0) {
    console.log("\nNo recommendations.");
    return;
  }

  console.log(`\n─── Top recommendations for "${query}" ───\n`);
  recommendations.forEach((rec, i) => {
    console.log(`${i + 1}. ${rec.name} — ${rec.reason}`);
    const profileUrl = buildRecurseProfileUrl(rec.recurseProfileSlug, knownRcProfiles);
    if (profileUrl) console.log(`   Profile: ${profileUrl}`);
    for (const t of rec.zulipTopics ?? []) {
      const topicUrl = buildZulipTopicUrl(t.channel, t.topic, knownZulipResults);
      if (topicUrl) console.log(`   Zulip:   ${topicUrl}`);
    }
    console.log();
  });
}

function buildRecurseProfileUrl(
  slug: string | null | undefined,
  knownProfiles: any[]
): string | null {
  if (!slug) return null;
  const found = knownProfiles.some((p) => p?.slug === slug);
  if (!found) return null;
  return `https://www.recurse.com/directory/${slug}`;
}

function buildZulipTopicUrl(
  channel: string,
  topic: string,
  knownResults: TopicResult[]
): string | null {
  const found = knownResults.some((r) => r.channel === channel && r.topic === topic);
  if (!found) return null;
  const encChannel = encodeURIComponent(channel);
  const encTopic = encodeURIComponent(topic);
  return `https://recurse.zulipchat.com/#narrow/channel/${encChannel}/topic/${encTopic}`;
}
```

Notes on what changed from the current `index.ts`:
- `runRcSearch` is gone. The RC fetch now happens inline in the loop and pushes profiles into `allRcProfiles` while still printing the raw JSON.
- `runZulipSearch` is no longer called. The loop uses `gatherZulipResults` + `printTopicResults` so it can both print AND accumulate into `allZulipResults`.
- New `--context` flag with validation.
- New `TrimConfig`, `TRIM_PRESETS`, `resolveTrimConfig`, `trimRcProfiles`, `trimZulipResults`.
- New `runRecommendation`, `buildRecurseProfileUrl`, `buildZulipTopicUrl`.
- `stripMarkdown` is imported from `utils/zulip-search.ts` (it was never defined in `index.ts` but is now needed by the trimmers).
- Local variable in `parseSelection` renamed `trimmed` → `trimmedInput` to avoid shadowing the top-level `trimmed` variable.
- `printUsage` gains the `--context` line.

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual check — end-to-end default flow**

Prerequisite: local Ollama server running with `llama3.2` (or whatever `$OLLAMA_MODEL` is set to) pulled.

Run: `bun index.ts --no-suggest "rust"`

Expected output (rough shape):
1. "Searching..." line and raw RC JSON for the query
2. "Searching for ... in Zulip ..." line and grouped Zulip results (or "No results found...")
3. A final block:
   ```
   ─── Top recommendations for "rust" ───

   1. Some Name — one-line reason
      Profile: https://www.recurse.com/directory/<slug>   (may be absent)
      Zulip:   https://recurse.zulipchat.com/#narrow/...   (may be absent, may be multiple)

   2. ...
   3. ...
   ```

If either source returned no data, the other source still feeds the recommender. If both returned nothing, you should see `No results to recommend from.` instead of a recommendation block.

- [ ] **Step 4: Manual check — `--context` flag validation**

Run: `bun index.ts --no-suggest --context bogus "rust"`
Expected: `⚠ Unknown --context value "bogus". Use small, medium, or large.` printed to stderr; exit code 1; no search or recommendation runs.

Run: `bun index.ts --no-suggest --context medium "rust"`
Expected: Runs to completion. (Visible difference from `small` is hard to eyeball; the trim caps are larger so more data is sent to the model.)

- [ ] **Step 5: Manual check — empty results path**

Run: `bun index.ts --no-suggest --recurse "zzzzzzzzz-bogus-query-xyz-123"`
Expected: The RC JSON prints (likely `{ "profiles": [] }` or similar), then `No results to recommend from.` is printed. No recommendation block.

- [ ] **Step 6: Manual check — Ollama failure path**

Run: `bun index.ts --no-suggest --model definitely-not-a-real-model-xyz "rust"`
Expected: Search results print as normal. Then stderr shows `⚠ Couldn't generate recommendations: <error>`. The process exits 0 (the raw results are still useful to the user).

- [ ] **Step 7: Manual check — hallucinated slug is dropped silently**

This one is opportunistic. If during any of the above runs the recommendation block prints a person who came from Zulip (no matching RC profile), confirm that no `Profile:` line appears for them. If during any run the model returns a recommendation but nothing in `allRcProfiles` matches its slug, confirm the `Profile:` line is silently omitted (not a broken link).

If you can't trigger this naturally, skip this step — the code path is covered by the `knownProfiles.some(...)` guard and is straightforward.

- [ ] **Step 8: Manual check — multi-query flow with suggestions**

Run: `bun index.ts "rust"` (no `--no-suggest`). When the keyword suggestion prompt appears, pick `1,2` or similar. Verify:
1. Per-query result banners still print for each effective query.
2. A single final recommendation block appears, keyed on the original query ("rust"), not any of the suggested keywords.

---

## Done Criteria

- [ ] `bunx tsc --noEmit` exits clean.
- [ ] `bun index.ts --no-suggest "rust"` prints search results followed by a `─── Top recommendations for "rust" ───` block (assuming Ollama is up).
- [ ] `bun index.ts --no-suggest --context bogus "rust"` exits 1 with a clear error.
- [ ] `bun index.ts --no-suggest --recurse "obviously-bogus-query-xyz"` prints `No results to recommend from.`
- [ ] `bun index.ts --no-suggest --model nonexistent "rust"` prints search results plus a warning; does NOT crash.
- [ ] No new files besides `utils/recommend-person.ts`. No automated test files. No commits made by the implementer.
