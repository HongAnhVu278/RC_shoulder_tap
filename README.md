# RC Shoulder Tap

Search Zulip for Recursers to connect with, or look up current Recursers via the Recurse Center API.

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

## Usage

```bash
bun index.ts <query>
bun index.ts rc <query>
```

**Examples:**
```bash
bun index.ts "machine learning"
bun index.ts "pair programming"
bun index.ts rust
bun index.ts rc "Jane Doe"
```

**Sample Zulip output:**
```
Searching for "rust" in Zulip (last 7 days)…

=== Welcome ===

Topic: "learning Rust this batch"  (last active: 2h ago, 3 messages)
  [Alice]  "Anyone else working through the Rust book? Happy to pair!"
  [Bob]    "Yes! I'm on chapter 10 — lifetimes are melting my brain."
  [Alice]  "Let's find time this week"

=== Checkins ===

Topic: "rust + wasm project"  (last active: 1d ago, 1 message)
  [Charlie]  "Day 12: got my Rust WASM module talking to the browser…"
```

**Sample RC API output:**
```json
[
  {
    "id": 12345,
    "name": "Jane Doe"
  }
]
```
