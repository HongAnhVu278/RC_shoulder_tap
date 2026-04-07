const REALM_URL = "https://recurse.zulipchat.com";
const ONE_WEEK_SECS = 7 * 24 * 60 * 60;

export interface ZulipMessage {
  id: number;
  sender_full_name: string;
  timestamp: number;
  content: string;
}

export interface TopicResult {
  channel: string;
  topic: string;
  lastActivity: Date;
  messages: ZulipMessage[];
}

interface RawMessage {
  id: number;
  sender_full_name: string;
  timestamp: number;
  content: string;
  subject: string;
}

function authHeader(): string {
  const email = process.env.ZULIP_EMAIL;
  const apiKey = process.env.ZULIP_API_KEY;
  if (!email) throw new Error("ZULIP_EMAIL is not set in .env");
  if (!apiKey) throw new Error("ZULIP_API_KEY is not set in .env");
  return "Basic " + btoa(`${email}:${apiKey}`);
}

async function zulipGet(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${REALM_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Authorization: authHeader() },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zulip API error ${res.status}: ${body}`);
  }

  return res.json();
}

async function fetchRecentMessages(channel: string, query: string, cutoff: number): Promise<RawMessage[]> {
  const narrow = JSON.stringify([
    { operator: "channel", operand: channel },
    { operator: "search", operand: query },
  ]);

  const collected: RawMessage[] = [];
  let anchor = "newest";

  while (true) {
    const data = (await zulipGet("/api/v1/messages", {
      anchor,
      num_before: "100",
      num_after: "0",
      narrow,
      apply_markdown: "false",
    })) as { messages: RawMessage[]; found_oldest: boolean };

    const { messages, found_oldest } = data;
    if (messages.length === 0) break;

    let hitOldMessage = false;
    for (const msg of messages) {
      if (msg.timestamp >= cutoff) {
        collected.push(msg);
      } else {
        hitOldMessage = true;
      }
    }

    if (found_oldest || hitOldMessage) break;

    anchor = String(messages[0].id - 1);
  }

  return collected;
}

async function resolveChannelNames(targets: string[]): Promise<string[]> {
  const data = (await zulipGet("/api/v1/streams")) as { streams: Array<{ name: string }> };
  const available = data.streams.map((s) => s.name);
  const resolved: string[] = [];

  for (const target of targets) {
    const match = available.find((name) => name.toLowerCase() === target.toLowerCase());
    if (match) {
      resolved.push(match);
    } else {
      console.warn(`Warning: channel "${target}" not found — skipping`);
    }
  }

  return resolved;
}

export async function searchTopics(query: string): Promise<TopicResult[]> {
  const cutoff = Math.floor(Date.now() / 1000) - ONE_WEEK_SECS;
  const channels = await resolveChannelNames(["👋 welcome!", "🧑‍💻 current batches", "Checkins"]);

  const channelMessages = await Promise.all(
    channels.map(async (channel) => ({
      channel,
      messages: await fetchRecentMessages(channel, query, cutoff),
    }))
  );

  const results: TopicResult[] = [];

  for (const { channel, messages } of channelMessages) {
    const topicMap = new Map<string, ZulipMessage[]>();

    for (const msg of messages) {
      const bucket = topicMap.get(msg.subject) ?? [];
      bucket.push({ id: msg.id, sender_full_name: msg.sender_full_name, timestamp: msg.timestamp, content: msg.content });
      topicMap.set(msg.subject, bucket);
    }

    for (const [topic, msgs] of topicMap) {
      const sorted = msgs.sort((a, b) => a.timestamp - b.timestamp);
      const lastActivity = new Date(sorted[sorted.length - 1].timestamp * 1000);
      results.push({ channel, topic, lastActivity, messages: sorted });
    }
  }

  // Sort results: most recently active first
  return results.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
}
