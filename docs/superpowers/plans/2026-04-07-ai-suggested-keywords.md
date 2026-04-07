# AI-Suggested Keywords Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-out AI-powered keyword suggestion step that runs before Recurse/Zulip searches, lets the user pick suggestions interactively, and runs the searches for the original query plus picked keywords.

**Architecture:** A thin generic Ollama wrapper (`utils/ollama.ts`) exposes one `chatStructured` function. A feature-specific layer (`utils/suggest-keywords.ts`) owns the keyword prompt and JSON schema. `index.ts` orchestrates: parse new flags → request suggestions → interactive prompt → run searches for each effective query.

**Tech Stack:** Bun, TypeScript, the first-party `ollama` npm package (uses its `format` parameter for structured outputs), Bun's built-in `prompt()` for interactive input.

**Spec:** `docs/superpowers/specs/2026-04-07-ai-suggested-keywords-design.md`

---

## File Structure

**Create:**
- `utils/ollama.ts` — generic `chatStructured<T>` wrapper. Knows nothing about keywords. Reusable for future AI features.
- `utils/suggest-keywords.ts` — feature layer. Owns prompt text + JSON schema. Exports `suggestKeywords(query, model?)`.
- `utils/ollama.test.ts` — unit tests for the generic wrapper (model resolution, schema passthrough, error propagation).
- `utils/suggest-keywords.test.ts` — unit tests for the feature layer (verifies schema shape, returns array from response).

**Modify:**
- `index.ts` — add `--no-suggest` and `--model` flags, suggestion step, interactive prompt parsing, multi-query search loop with banners.
- `package.json` — add `ollama` dependency (via `bun add`).

**No test file for `index.ts`:** the orchestration layer wires interactive `prompt()` and stdout side-effects. The unit-testable logic (selection parsing) is small enough to include inline; manual end-to-end verification is acceptable.

---

## Testing Notes

This project doesn't have any tests yet. We'll use `bun test` (built-in, no extra deps). Tests live next to the code as `*.test.ts`.

Ollama calls are mocked by stubbing the `ollama` package's default export using Bun's `mock.module()`.

---

## Task 1: Add the `ollama` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run: `bun add ollama`
Expected: `package.json` gains `"ollama": "^x.y.z"` under `dependencies`, `bun.lock` (or `bun.lockb`) updates.

- [ ] **Step 2: Verify install**

Run: `bun pm ls | grep ollama`
Expected: One line showing `ollama@<version>`.

---

## Task 2: Generic Ollama wrapper — failing test for default model resolution

**Files:**
- Create: `utils/ollama.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, mock, beforeEach, afterEach } from "bun:test";

// Capture the args ollama.chat is called with
let lastChatArgs: any = null;
const fakeChat = mock(async (args: any) => {
  lastChatArgs = args;
  return { message: { content: '{"ok": true}' } };
});

mock.module("ollama", () => ({
  default: { chat: fakeChat },
}));

const { chatStructured } = await import("./ollama");

beforeEach(() => {
  lastChatArgs = null;
  fakeChat.mockClear();
  delete process.env.OLLAMA_MODEL;
});

test("uses hard-coded default model when no override or env var", async () => {
  await chatStructured({
    prompt: "hi",
    schema: { type: "object", properties: {}, required: [] },
  });
  expect(lastChatArgs.model).toBe("llama3.2");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test utils/ollama.test.ts`
Expected: FAIL with "Cannot find module './ollama'" (or similar — file doesn't exist yet).

---

## Task 3: Generic Ollama wrapper — minimal implementation

**Files:**
- Create: `utils/ollama.ts`

- [ ] **Step 1: Write the minimal implementation**

```ts
import ollama from "ollama";

const DEFAULT_MODEL = "llama3.2";

export interface ChatStructuredArgs {
  prompt: string;
  schema: object;
  model?: string;
}

export async function chatStructured<T>(args: ChatStructuredArgs): Promise<T> {
  const model = args.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;

  const response = await ollama.chat({
    model,
    messages: [{ role: "user", content: args.prompt }],
    format: args.schema as any,
  });

  return JSON.parse(response.message.content) as T;
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test utils/ollama.test.ts`
Expected: PASS (1 test).

---

## Task 4: Generic Ollama wrapper — env var override test

**Files:**
- Modify: `utils/ollama.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `utils/ollama.test.ts`:

```ts
test("uses OLLAMA_MODEL env var when no explicit model", async () => {
  process.env.OLLAMA_MODEL = "qwen2.5";
  await chatStructured({
    prompt: "hi",
    schema: { type: "object", properties: {}, required: [] },
  });
  expect(lastChatArgs.model).toBe("qwen2.5");
});
```

- [ ] **Step 2: Run the test**

Run: `bun test utils/ollama.test.ts`
Expected: PASS (2 tests). The implementation already supports this — we're locking in the behavior.

---

## Task 5: Generic Ollama wrapper — explicit model arg precedence test

**Files:**
- Modify: `utils/ollama.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `utils/ollama.test.ts`:

```ts
test("explicit model arg overrides env var", async () => {
  process.env.OLLAMA_MODEL = "qwen2.5";
  await chatStructured({
    prompt: "hi",
    schema: { type: "object", properties: {}, required: [] },
    model: "mistral",
  });
  expect(lastChatArgs.model).toBe("mistral");
});
```

- [ ] **Step 2: Run the test**

Run: `bun test utils/ollama.test.ts`
Expected: PASS (3 tests).

---

## Task 6: Generic Ollama wrapper — schema passthrough test

**Files:**
- Modify: `utils/ollama.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `utils/ollama.test.ts`:

```ts
test("passes the schema through as the format parameter", async () => {
  const schema = {
    type: "object",
    properties: { keywords: { type: "array", items: { type: "string" } } },
    required: ["keywords"],
  };
  await chatStructured({ prompt: "hi", schema });
  expect(lastChatArgs.format).toEqual(schema);
});
```

- [ ] **Step 2: Run the test**

Run: `bun test utils/ollama.test.ts`
Expected: PASS (4 tests).

---

## Task 7: Generic Ollama wrapper — JSON parse error propagates

**Files:**
- Modify: `utils/ollama.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `utils/ollama.test.ts`:

```ts
test("throws when response content is not valid JSON", async () => {
  fakeChat.mockImplementationOnce(async () => ({
    message: { content: "not json at all" },
  }));

  await expect(
    chatStructured({
      prompt: "hi",
      schema: { type: "object", properties: {}, required: [] },
    })
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Run the test**

Run: `bun test utils/ollama.test.ts`
Expected: PASS (5 tests). `JSON.parse` already throws synchronously, which becomes a rejected promise.

---

## Task 8: suggest-keywords — failing test for return shape

**Files:**
- Create: `utils/suggest-keywords.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, mock, beforeEach } from "bun:test";

let lastArgs: any = null;
const fakeChatStructured = mock(async (args: any) => {
  lastArgs = args;
  return { keywords: ["systems programming", "memory safety", "borrow checker"] };
});

mock.module("./ollama", () => ({
  chatStructured: fakeChatStructured,
}));

const { suggestKeywords } = await import("./suggest-keywords");

beforeEach(() => {
  lastArgs = null;
  fakeChatStructured.mockClear();
});

test("returns the keywords array from the model response", async () => {
  const result = await suggestKeywords("rust");
  expect(result).toEqual(["systems programming", "memory safety", "borrow checker"]);
});
```

- [ ] **Step 2: Run the test**

Run: `bun test utils/suggest-keywords.test.ts`
Expected: FAIL with "Cannot find module './suggest-keywords'".

---

## Task 9: suggest-keywords — minimal implementation

**Files:**
- Create: `utils/suggest-keywords.ts`

- [ ] **Step 1: Write the minimal implementation**

```ts
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

interface KeywordResponse {
  keywords: string[];
}

export async function suggestKeywords(query: string, model?: string): Promise<string[]> {
  const prompt = [
    `You are helping a user search the Recurse Center directory and Zulip chat.`,
    `They searched for: "${query}"`,
    ``,
    `Generate 3 to 5 short related keyword phrases that would help them find adjacent people, projects, or discussions.`,
    `Return ONLY a JSON object matching the provided schema. Do not include the original query in the list.`,
  ].join("\n");

  const response = await chatStructured<KeywordResponse>({
    prompt,
    schema: KEYWORD_SCHEMA,
    model,
  });

  return response.keywords;
}
```

- [ ] **Step 2: Run the test**

Run: `bun test utils/suggest-keywords.test.ts`
Expected: PASS (1 test).

---

## Task 10: suggest-keywords — verify it sends the schema and query to chatStructured

**Files:**
- Modify: `utils/suggest-keywords.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `utils/suggest-keywords.test.ts`:

```ts
test("passes a schema requiring a keywords array of strings", async () => {
  await suggestKeywords("rust");
  expect(lastArgs.schema).toMatchObject({
    type: "object",
    properties: {
      keywords: { type: "array", items: { type: "string" } },
    },
    required: ["keywords"],
  });
});

test("includes the user's query in the prompt", async () => {
  await suggestKeywords("borrow checker");
  expect(lastArgs.prompt).toContain("borrow checker");
});

test("forwards the model override", async () => {
  await suggestKeywords("rust", "mistral");
  expect(lastArgs.model).toBe("mistral");
});
```

- [ ] **Step 2: Run the tests**

Run: `bun test utils/suggest-keywords.test.ts`
Expected: PASS (4 tests total).

---

## Task 11: Run the full test suite

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass (5 from `ollama.test.ts` + 4 from `suggest-keywords.test.ts` = 9 tests).

---

## Task 12: index.ts — add new flags to parseArgs

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Add the new flags**

In the `parseArgs` call, update the `options` object to include the two new flags:

```ts
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
```

- [ ] **Step 2: Verify it parses without crashing**

Run: `bun index.ts --no-suggest --model mistral "test"`
Expected: Runs through to the existing search code path (will hit Recurse/Zulip with "test"). No `parseArgs` error. You can Ctrl-C once you see it start searching.

---

## Task 13: index.ts — extract a helper for running configured searches against a single query

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Add a helper function**

Above the existing top-level `if (runRecurse) { ... }` block, add this helper. We'll use it in Task 16 to loop over multiple queries.

```ts
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
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit 2>&1 | grep -v "zulip-api.ts" || true`
Expected: No errors related to `index.ts`. (Pre-existing `zulip-api.ts` strict-null warnings are filtered out.)

---

## Task 14: index.ts — wire up the suggestion step (success path)

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Add the import**

Near the other utils imports at the top of `index.ts`:

```ts
import { suggestKeywords } from "./utils/suggest-keywords";
```

- [ ] **Step 2: Add a helper that prompts the user to pick from suggestions**

Add this function near the bottom of `index.ts` (next to `printUsage`):

```ts
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
  return picked;
}
```

- [ ] **Step 3: Add the suggestion-gathering helper**

Also near the bottom:

```ts
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
```

- [ ] **Step 4: Verify it compiles**

Run: `bunx tsc --noEmit 2>&1 | grep -v "zulip-api.ts" || true`
Expected: No errors related to `index.ts`.

---

## Task 15: index.ts — replace the top-level search invocation with the suggest+loop flow

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Replace the existing top-level search block**

Find this existing block:

```ts
if (runRecurse) {
  await runRcSearch(query);
}

if (runZulip) {
  await runZulipSearch(query);
}
```

Replace it with:

```ts
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
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit 2>&1 | grep -v "zulip-api.ts" || true`
Expected: No errors related to `index.ts`.

---

## Task 16: index.ts — update `printUsage` to reflect the new flags

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Update the usage text**

Replace the body of `printUsage` with:

```ts
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
```

- [ ] **Step 2: Verify it compiles and the usage prints**

Run: `bun index.ts`
Expected: New usage block prints to stderr; process exits 1.

---

## Task 17: Manual verification — `--no-suggest` path

- [ ] **Step 1: Run with `--no-suggest` and a real query**

Run: `bun index.ts --no-suggest --recurse "rust"`
Expected: No prompt appears. RC search runs normally and prints results (or an error if `RC_API_KEY` isn't set — which is the existing behavior).

---

## Task 18: Manual verification — Ollama-failure fallback

This verifies the friendly-fallback behavior. You don't need Ollama installed for this test.

- [ ] **Step 1: Run a default query without Ollama running**

Run: `bun index.ts --recurse "rust"`
Expected: A warning prints to stderr like:
```
⚠ Couldn't get keyword suggestions from Ollama: <some connection error>
  (Pass --no-suggest to skip this step.)
```
Then the RC search proceeds with just `"rust"` as the original query.

---

## Task 19: Manual verification — happy path with Ollama running (optional)

Skip this task if Ollama isn't installed locally.

- [ ] **Step 1: Make sure Ollama is up and the default model is available**

Run: `ollama list`
Expected: Shows `llama3.2` (or whichever model you'll use). If not, run `ollama pull llama3.2`.

- [ ] **Step 2: Run a default query**

Run: `bun index.ts --recurse "rust"`
Expected:
1. Suggestion list prints (e.g. 3-5 keywords)
2. Prompt appears: `Pick one or more to also search ...`
3. Type `1,3` and press Enter
4. Two banners print: `─── Results for "rust" ───` and `─── Results for "<picked keyword>" ───` etc.
5. RC search runs for each effective query in order

- [ ] **Step 3: Test the "skip" path**

Run: `bun index.ts --recurse "rust"` and press Enter at the prompt.
Expected: No banner (only one query), RC search runs once for `"rust"` only.

- [ ] **Step 4: Test the "all" path**

Run: `bun index.ts --recurse "rust"` and type `all` at the prompt.
Expected: Banners for each effective query, RC search runs once per keyword.

- [ ] **Step 5: Test invalid input**

Run: `bun index.ts --recurse "rust"` and type `9,99` (out of range).
Expected: Two warnings about ignored indices, then RC search runs once for `"rust"` only.

---

## Task 20: Final test run

- [ ] **Step 1: Run all unit tests one more time**

Run: `bun test`
Expected: All 9 tests pass.

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit 2>&1 | grep -v "zulip-api.ts" || true`
Expected: No errors related to the new files or `index.ts`.

---

## Completion Checklist

- [ ] `ollama` package installed
- [ ] `utils/ollama.ts` created with `chatStructured<T>` (model resolution: arg → env → default)
- [ ] `utils/suggest-keywords.ts` created with `suggestKeywords` and the keyword JSON schema
- [ ] Unit tests pass for both new files
- [ ] `index.ts` parses `--no-suggest` and `--model` flags
- [ ] Suggestion step runs by default; `--no-suggest` skips it
- [ ] Interactive prompt parses comma-separated indices, `all`, empty input, and invalid input correctly
- [ ] Ollama failures print a friendly warning + `--no-suggest` hint and fall back to original query
- [ ] Multi-query mode prints per-query banners
- [ ] Usage text reflects the new flags
- [ ] Manual end-to-end verification passes
