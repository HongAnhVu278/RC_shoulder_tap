import { chatStructured } from "./ollama";

const KEYWORD_SCHEMA = {
  type: "object",
  properties: {
    keywords: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["keywords"],
} as const;

export async function suggestKeywords(query: string, model?: string): Promise<string[]> {
  const prompt = [
    `You are helping a user search the Recurse Center directory and Zulip chat.`,
    `They searched for: "${query}"`,
    ``,
    `Generate 3 to 5 short related keyword phrases that would help them find adjacent people, projects, or discussions.`,
    `Return ONLY a JSON object matching the provided schema. Do not include the original query in the list.`,
  ].join("\n");

  const response = await chatStructured<{ keywords: string[] }>({
    prompt,
    schema: KEYWORD_SCHEMA,
    model,
  });

  return response.keywords;
}
