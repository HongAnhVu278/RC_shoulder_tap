# AI-Suggested Keyword Search

**Date:** 2026-04-07
**Status:** Approved for implementation

## Goal

Before running Recurse Center and/or Zulip searches, ask a local Ollama model to generate 3–5 related keyword suggestions for the user's query. Present the suggestions interactively; the user can pick any subset (or skip). We then run the configured searches for the original query **plus** any picked keywords.

## Motivation

Users searching the RC directory and Zulip often think of a single term ("rust", "ml") but related terminology ("borrow checker", "systems programming", "embedded") would surface relevant people and discussions they wouldn't otherwise find. An LLM is well-suited to generating these lateral keywords.

This is also the first of several planned AI features, so the Ollama integration should be factored for reuse.

## Non-Goals

- Streaming responses from Ollama
- Retry logic on failure
- Caching suggestions across runs
- Spelling correction / "did you mean"
- Deduplicating between original query and AI-generated suggestions
- Running searches for multiple queries in parallel (we want deterministic output order)

## Architecture

Two new files, one modified file:

```
utils/
  ollama.ts            ← generic, reusable Ollama wrapper
  suggest-keywords.ts  ← feature-specific: prompt + schema for keyword suggestions
index.ts               ← modified: orchestrates suggest → prompt → search
```

The split is deliberate: `utils/ollama.ts` knows nothing about keywords. Future AI features call the same `chatStructured` function with a different schema and prompt. `suggest-keywords.ts` is the domain-specific layer that owns the prompt text and JSON schema for this particular feature.

## Dependencies

- Add `ollama` (first-party npm package from the Ollama team) via `bun add ollama`. It's the sanctioned SDK and supports structured outputs via its `format` parameter.
- No new dev dependencies. Interactive input uses Bun's built-in `prompt()`.

## Component: `utils/ollama.ts`

Generic, reusable wrapper around the `ollama` package. Exports one function:

```ts
chatStructured<T>(args: {
  prompt: string;
  schema: object;     // JSON Schema describing expected output shape
  model?: string;     // optional per-call override
}): Promise<T>
```

**Behavior:**

- Resolves the model name in this order:
  1. Explicit `model` argument
  2. `process.env.OLLAMA_MODEL`
  3. Hard-coded default: `"llama3.2"`
- Calls `ollama.chat()` with `format: schema` to enable structured output
- Parses `response.message.content` as JSON and returns it cast to `T`
- Throws on any network error, non-OK response, or JSON parse failure. Callers decide how to handle.

**What this layer does NOT do:** no retries, no streaming, no caching, no prompt templating. Thin by design.

## Component: `utils/suggest-keywords.ts`

Feature-specific layer. Owns:

- The prompt text instructing the model to generate 3–5 related keyword phrases for a search query
- The JSON schema:
  ```json
  {
    "type": "object",
    "properties": {
      "keywords": {
        "type": "array",
        "items": { "type": "string" }
      }
    },
    "required": ["keywords"]
  }
  ```
- One exported function:
  ```ts
  suggestKeywords(query: string, model?: string): Promise<string[]>
  ```

Internally calls `chatStructured` and returns the `keywords` array.

## Component: `index.ts` (modified)

### New CLI flags

Added to the existing `parseArgs` call:

- `--no-suggest` (boolean) — skip the suggestion step entirely. Suggestions are **on by default**.
- `--model <name>` (string) — override the Ollama model for this run. Takes precedence over `OLLAMA_MODEL` env var.

### New control flow

1. Parse args, get query (existing behavior)
2. Determine which searches to run from `--recurse`/`--zulip` flags (existing default: both)
3. **If suggestions are enabled (default, unless `--no-suggest`):**
   - Call `suggestKeywords(query, modelFlag)` inside a try/catch
   - **On success:** print numbered list of suggestions, prompt the user via `prompt()`, parse response into `pickedKeywords: string[]`
   - **On failure:** print a warning to stderr with the error message plus a hint about `--no-suggest`, set `pickedKeywords = []`
4. Build `effectiveQueries = [query, ...pickedKeywords]`
5. For each entry in `effectiveQueries`, print a banner and run the configured searches sequentially (Recurse and/or Zulip)

### Interactive prompt format

```
Suggested related keywords for "rust":
  1) systems programming
  2) memory safety
  3) borrow checker
  4) wasm
  5) embedded

Pick one or more to also search (e.g. "1,3", "all", or press Enter to skip):
>
```

### Prompt response parsing rules

- Empty or whitespace-only → skip (run only original query)
- `"all"` (case-insensitive) → select all suggestions
- Comma-separated numbers (e.g. `"1,3,5"`) → select those 1-based indices. Invalid indices are ignored with a warning printed to stderr.
- Any other unrecognized input → treat as skip, print a brief warning to stderr

### Error message format (Ollama failure)

Printed to stderr:

```
⚠ Couldn't get keyword suggestions from Ollama: <error.message>
  (Pass --no-suggest to skip this step.)
```

Then the searches continue with the original query only.

### Multi-query output format

When multiple effective queries run, each gets a banner before its output so results are clearly grouped:

```
─── Results for "rust" ───
[recurse output...]
[zulip output...]

─── Results for "borrow checker" ───
[recurse output...]
[zulip output...]
```

The existing `runRcSearch` and `runZulipSearch` functions do not change — `index.ts` simply calls them in a loop with a banner between iterations.

## Data Flow

```
user input → parseArgs → query + flags
                            │
                            ├── (if suggestions enabled)
                            │     suggestKeywords(query)
                            │         └── chatStructured({prompt, schema, model})
                            │               └── ollama.chat({model, messages, format})
                            │     → string[]
                            │     → interactive prompt → pickedKeywords
                            │
                            └── effectiveQueries = [query, ...pickedKeywords]
                                  └── for each: runRcSearch / runZulipSearch
```

## Error Handling Summary

| Failure | Behavior |
| --- | --- |
| Ollama server unreachable | Warn + hint about `--no-suggest`, continue with original query |
| Model not pulled | Warn + hint, continue with original query |
| JSON parse error on response | Warn + hint, continue with original query |
| User picks invalid index number | Warn, ignore that index, continue with valid picks |
| User enters garbage in prompt | Warn, treat as skip |
| Recurse or Zulip API failure | Existing behavior unchanged |

## Testing Considerations

- `utils/ollama.ts`: can be unit-tested by stubbing the `ollama` package's `chat` method
- `utils/suggest-keywords.ts`: unit test by stubbing `chatStructured` and verifying it passes the expected schema and returns the `keywords` array
- `index.ts`: interactive `prompt()` is harder to unit-test; manual end-to-end verification is acceptable for the orchestration layer given the small surface area

## Open Questions

None at design time. Open for future iteration:

- Whether to later add a CLI flag for controlling the number of suggestions
- Whether to surface suggestions in a "did you mean" mode even with `--no-suggest`
