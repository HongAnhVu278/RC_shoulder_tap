import { parseArgs } from "util";
import { getRecurseData } from "./utils/rc-api";
import { runZulipSearch } from "./utils/zulip-search";
import { suggestKeywords } from "./utils/suggest-keywords";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    recurse: { type: "boolean" },
    zulip: { type: "boolean" },
    "no-suggest": { type: "boolean" },
    model: { type: "string" },
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

const suggestionsEnabled = !values["no-suggest"];
const pickedKeywords = suggestionsEnabled
  ? await gatherKeywordSuggestions(query, values.model)
  : [];

const effectiveQueries = [query, ...pickedKeywords];

for (const effectiveQuery of effectiveQueries) {
  if (effectiveQueries.length > 1) {
    console.log(`\n─── Results for "${effectiveQuery}" ───`);
  }
  await runSearches(effectiveQuery, { recurse: runRecurse, zulip: runZulip });
}

function printUsage(): void {
  console.error("Usage:");
  console.error("  bun index.ts [--recurse] [--zulip] [--no-suggest] [--model <name>] <search query>");
  console.error("");
  console.error("Search flags (accumulative; default is both):");
  console.error("  --recurse       Search the Recurse Center directory");
  console.error("  --zulip         Search Zulip topics (last 7 days)");
  console.error("");
  console.error("AI suggestion flags:");
  console.error("  --no-suggest    Skip the AI keyword suggestion step (suggestions are on by default)");
  console.error("  --model <name>  Override the Ollama model (defaults to OLLAMA_MODEL env var or 'llama3.2')");
  console.error("");
  console.error("Examples:");
  console.error('  bun index.ts "machine learning"');
  console.error('  bun index.ts --recurse "jane doe"');
  console.error('  bun index.ts --no-suggest --recurse --zulip "rust"');
}

function parseSelection(input: string, suggestions: string[]): string[] {
  const trimmed = input.trim();
  if (trimmed === "") return [];
  if (trimmed.toLowerCase() === "all") return [...suggestions];

  const parts = trimmed.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  const looksNumeric = parts.every((p) => /^\d+$/.test(p));
  if (!looksNumeric) {
    console.error(`⚠ Couldn't parse "${trimmed}". Skipping suggestions.`);
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

  const answer = prompt('\nPick one or more to also search (e.g. "1,3", "all", or press Enter to skip):') ?? "";
  return parseSelection(answer, suggestions);
}

async function runSearches(
  effectiveQuery: string,
  opts: { recurse: boolean; zulip: boolean }
): Promise<void> {
  if (opts.recurse) {
    await runRcSearch(effectiveQuery);
  }
  if (opts.zulip) {
    await runZulipSearch(effectiveQuery);
  }
}

async function runRcSearch(query: string): Promise<void> {
  const apiKey = process.env.RC_API_KEY;
  if (!apiKey) {
    console.error("RC_API_KEY is not set in .env");
    process.exit(1);
  }

  const data = await getRecurseData(query, apiKey);
  console.log(JSON.stringify(data, null, 2));
}
