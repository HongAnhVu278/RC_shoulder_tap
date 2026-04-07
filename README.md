# RC Shoulder Tap

Search Zulip for Recursers to connect with, or look up current Recursers via the Recurse Center API. Optionally uses a local Ollama model to suggest related search keywords.

## Setup

1. Install dependencies:
   ```bash
   bun install
   ```

2. Create a `.env` file:
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and fill in the credentials you need:
   - `ZULIP_EMAIL` and `ZULIP_API_KEY` for Zulip search. You can find your Zulip API key at **Settings → Your account → API key**.
   - `RC_API_KEY` for Recurse Center profile search.
   - `OLLAMA_MODEL` _(optional)_ — override the default Ollama model (`llama3.2`).

3. _(Optional)_ Install and run [Ollama](https://ollama.com) locally for AI keyword suggestions. If Ollama isn't running, keyword suggestions are skipped with a warning.

## Usage

```bash
bun index.ts [--recurse] [--zulip] [--no-suggest] [--model <name>] <search query>
```

By default (no flags), both Recurse Center and Zulip are searched, and AI keyword suggestions are enabled.

**Flags:**

| Flag | Description |
|---|---|
| `--recurse` | Search the Recurse Center directory |
| `--zulip` | Search Zulip topics (last 7 days) |
| `--no-suggest` | Skip AI keyword suggestions |
| `--model <name>` | Override the Ollama model |

**Examples:**
```bash
bun index.ts "machine learning"          # search both RC + Zulip
bun index.ts --recurse "Jane Doe"        # RC directory only
bun index.ts --zulip rust                # Zulip only
bun index.ts --no-suggest "pair programming"  # skip AI suggestions
bun index.ts --model mistral "haskell"   # use a specific Ollama model
```

## AI Keyword Suggestions

When Ollama is running, the tool suggests related search terms before executing the search. You can pick one or more to run additional searches:

```
Suggested related keywords for "rust":
  1) systems programming
  2) WebAssembly
  3) memory safety

Pick one or more to also search (e.g. "1,3", "all", or press Enter to skip):
```

Pass `--no-suggest` to skip this step.

## Sample Output

**Zulip:**
```
Searching for "rust" in Zulip (last 7 days)…

=== Welcome ===

Topic: "learning Rust this batch"  (last active: 2h ago, 3 messages)
  [Alice]  "Anyone else working through the Rust book? Happy to pair!"
  [Bob]    "Yes! I'm on chapter 10 — lifetimes are melting my brain."
  [Alice]  "Let's find time this week"
```

**RC directory:**
```json
[
  {
    "id": 12345,
    "name": "Jane Doe"
  }
]
```
