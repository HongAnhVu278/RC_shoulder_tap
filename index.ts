import { parseArgs } from "util";
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

// ---------------------------------------------------------------------------
// Trim config (must be defined before top-level code calls resolveTrimConfig)
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
    throw new Error(); // unreachable; satisfies TypeScript narrowing
  }
  return preset;
}

// ---------------------------------------------------------------------------

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
