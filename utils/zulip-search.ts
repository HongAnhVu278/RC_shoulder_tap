import { searchTopics, type TopicResult } from "./zulip-api";

export async function runZulipSearch(query: string): Promise<void> {
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
