import { parseArgs } from "util";
import { getRecurseData } from "./utils/rc-api";
import { runZulipSearch } from "./utils/zulip-search";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    recurse: { type: "boolean" },
    zulip: { type: "boolean" },
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

if (runRecurse) {
  await runRcSearch(query);
}

if (runZulip) {
  await runZulipSearch(query);
}

function printUsage(): void {
  console.error("Usage:");
  console.error("  bun index.ts [--recurse] [--zulip] <search query>");
  console.error("");
  console.error("Flags (accumulative; default is both):");
  console.error("  --recurse    Search the Recurse Center directory");
  console.error("  --zulip      Search Zulip topics (last 7 days)");
  console.error("");
  console.error("Examples:");
  console.error('  bun index.ts "machine learning"');
  console.error('  bun index.ts --recurse "jane doe"');
  console.error('  bun index.ts --recurse --zulip "rust"');
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
