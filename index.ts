import { getRecurseData } from "./utils/rc-api";
import { searchTopics, type TopicResult } from "./zulip";

const args = process.argv.slice(2);
const maybeCommand = args[0];

if (args.length === 0) {
  printUsage();
  process.exit(1);
}

if (maybeCommand === "rc") {
  const query = args.slice(1).join(" ").trim();
  await runRcSearch(query);
  process.exit(0);
}

const query = args.join(" ").trim();

if (!query) {
  printUsage();
  process.exit(1);
}

await runZulipSearch(query);

function printUsage(): void {
  console.error("Usage:");
  console.error("  bun index.ts <search query>");
  console.error("  bun index.ts rc <search query>");
  console.error("");
  console.error("Examples:");
  console.error('  bun index.ts "machine learning"');
  console.error('  bun index.ts rc "jane doe"');
}

async function runRcSearch(query: string): Promise<void> {
  if (!query) {
    printUsage();
    process.exit(1);
  }

  const apiKey = process.env.RC_API_KEY;
  if (!apiKey) {
    console.error("RC_API_KEY is not set in .env");
    process.exit(1);
  }

  const data = await getRecurseData(query, apiKey);
  console.log(JSON.stringify(data, null, 2));
}

async function runZulipSearch(query: string): Promise<void> {
  console.log(`Searching for "${query}" in Zulip (last 7 days)...`);

  try {
    const results = await searchTopics(query);
    printTopicResults(query, results);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error:", message);
    process.exit(1);
  }
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\n+/g, " ")
    .trim();
}

function printTopicResults(query: string, results: TopicResult[]): void {
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
