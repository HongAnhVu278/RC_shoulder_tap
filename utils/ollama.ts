import ollama from "ollama";

const DEFAULT_MODEL = "llama3.2";

export interface ChatStructuredArgs {
  prompt: string;
  schema: Record<string, unknown>;
  model?: string;
}

export async function chatStructured<T>(args: ChatStructuredArgs): Promise<T> {
  const model = args.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;

  const stream = await ollama.chat({
    model,
    messages: [{ role: "user", content: args.prompt }],
    format: args.schema,
    stream: true,
  });

  let content = "";
  process.stderr.write("\n");
  for await (const chunk of stream) {
    const token = chunk.message.content;
    content += token;
    process.stderr.write(token);
  }
  process.stderr.write("\n");

  return JSON.parse(content) as T;
}
