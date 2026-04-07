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
