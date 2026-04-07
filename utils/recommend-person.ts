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
