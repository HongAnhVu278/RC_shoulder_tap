import ollama from "ollama";

const DEFAULT_MODEL = "llama3.2";

export interface ChatStructuredArgs {
  prompt: string;
  schema: Record<string, unknown>;
  model?: string;
}

export async function chatStructured<T>(args: ChatStructuredArgs): Promise<T> {
  const model = args.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;

  const response = await ollama.chat({
    model,
    messages: [{ role: "user", content: args.prompt }],
    format: args.schema,
  });

  return JSON.parse(response.message.content) as T;
}
