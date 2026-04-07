# AI-Recommended People from Search Results

**Date:** 2026-04-07
**Status:** Approved for implementation

## Goal

After search results are gathered from Recurse and Zulip across all effective queries, send the combined data to a local Ollama model and get back a top-3 ranked list of people to reach out to. Each recommendation includes a one-line reason and direct links to the person's Recurse profile and any Zulip topics that informed the pick.

## Motivation

The existing CLI prints raw search dumps. The user still has to scan profiles and Zulip messages and decide who to actually message. An LLM is well-suited to skimming this material and surfacing the most promising contact for the user's specific query. This is the third AI feature in the codebase (after `suggest-keywords` and the broader keyword flow), so it slots into the established two-layer Ollama pattern: a generic `chatStructured` wrapper plus a thin feature module that owns the prompt and schema.

## Non-Goals

- A `--no-recommend` flag — the recommendation IS the feature; turning it off makes no sense
- Caching, streaming, or parallel Ollama calls
- Validating that recommended names actually appear in the input data (model hallucinations are accepted; missing URLs serve as a hint)
- Deduplication if the model lists the same person twice
- Per-query recommendations (we deliberately produce one unified recommendation across all effective queries — see "Multi-query handling" below)
- Auto-generating a draft message to send to the recommended person
- Detailed/long-form reasoning — one-line reasons only

## Architecture

```
utils/
  ollama.ts                ← unchanged (generic chatStructured wrapper)
  suggest-keywords.ts      ← unchanged
  recommend-person.ts      ← NEW. Owns recommendation prompt + schema. Exports recommendPerson()
  zulip-search.ts          ← MODIFIED to expose Zulip results as data, not just stdout
  rc-api.ts                ← MODIFIED: bump RC API limit from 2 to 10
index.ts                   ← MODIFIED: collect results across queries, call recommender once at the end, new --context flag
```

The split mirrors `suggest-keywords`: `utils/recommend-person.ts` is a thin feature layer that owns its prompt and JSON schema, calling generic `chatStructured`. Future AI features keep adding their own layers next to it.

## Data Flow

```
parseArgs → query + flags
  ↓
suggestKeywords → user picks → effectiveQueries = [query, ...picked]
  ↓
for each effectiveQuery:
  rcResults    = getRecurseData(effectiveQuery)        ← profiles
  zulipResults = gatherZulipResults(effectiveQuery)    ← topics + messages
  print rcResults + zulipResults under banner          ← existing UX preserved
  collect into combinedResults                         ← new
  ↓
trim/normalize combinedResults via TrimConfig (cap counts, strip fields)
  ↓
recommendPerson({ query: originalQuery, recurseProfiles, zulipMessages })
  ↓
print "─── Top recommendations for '<query>' ───" + numbered list with URLs
```

## Components

### `utils/recommend-person.ts` (new)

Exports one function:

```ts
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

export async function recommendPerson(args: {
  query: string;
  recurseProfiles: RcProfileSummary[];
  zulipMessages: ZulipMessageSummary[];
  model?: string;
}): Promise<Recommendation[]>
```

**Owns:**

- The prompt (instructs the model to pick the top 3 people most worth reaching out to about `query`, using bios + Zulip activity as signal, asking for one-line reasons, and asking the model to reference back the slug and topic identifiers it saw in the input)
- The JSON schema:

```ts
{
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
                topic: { type: "string" }
              },
              required: ["channel", "topic"]
            }
          }
        },
        required: ["name", "reason"]
      }
    }
  },
  required: ["recommendations"]
}
```

- Calls `chatStructured` and returns `recommendations`

The model is instructed to reference slugs and topic IDs from the input data, not invent them. `index.ts` is responsible for translating those references into URLs.

### `utils/zulip-search.ts` (modified)

Currently `runZulipSearch` calls `searchTopics`, prints results, and returns `void`. We need the data too. Refactor:

- Add new exported function `gatherZulipResults(query: string): Promise<TopicResult[]>` that wraps `searchTopics` with the same try/catch + error message as today, but returns the data instead of printing
- Refactor `runZulipSearch` into a thin wrapper that calls `gatherZulipResults` then `printTopicResults`
- Move `stripMarkdown` from `index.ts` into `utils/zulip-search.ts` (it's currently used only by Zulip output and will also be used by the trimming functions in `index.ts`)
- Existing print behavior is unchanged

### `utils/rc-api.ts` (modified)

Single line change: `RecurseAPIURL.searchParams.set("limit", "10")` (was `"2"`). The recommender needs more candidates than two to pick from.

### `index.ts` (modified)

Several coordinated changes:

**1. New `--context` CLI flag**

Add to `parseArgs`:
```ts
context: { type: "string" }, // small | medium | large, default small
```

Validate the value; reject anything other than `small`/`medium`/`large` with a clear error message.

**2. Remove `runRcSearch`**

`runRcSearch` is currently a 2-line wrapper around `getRecurseData` + `console.log`. Inline it: `index.ts` calls `getRecurseData(effectiveQuery, apiKey)` directly inside the loop, prints the JSON, AND collects the data into the accumulator.

**3. Replace the per-query loop body**

Inside the existing `for (const effectiveQuery of effectiveQueries)` loop, instead of just calling print-only helpers:

```ts
const allRcProfiles: any[] = [];
const allZulipResults: TopicResult[] = [];

for (const effectiveQuery of effectiveQueries) {
  if (effectiveQueries.length > 1) {
    console.log(`\n─── Results for "${effectiveQuery}" ───`);
  }

  if (runRecurse) {
    const data = await getRecurseData(effectiveQuery, apiKey);
    console.log(JSON.stringify(data, null, 2));
    if (Array.isArray(data?.profiles)) allRcProfiles.push(...data.profiles);
  }

  if (runZulip) {
    const zulipResults = await gatherZulipResults(effectiveQuery);
    printTopicResults(effectiveQuery, zulipResults);  // existing print
    allZulipResults.push(...zulipResults);
  }
}
```

Note: `printTopicResults` would also need to be exported from `utils/zulip-search.ts` so `index.ts` can call it. Alternatively we keep using `runZulipSearch` (which already does the print) and add a separate accumulation step. Implementer should pick whichever yields cleaner code.

**4. Trim, then call recommender**

After the loop:

```ts
const trimConfig = resolveTrimConfig(values.context);
const trimmed = {
  recurseProfiles: trimRcProfiles(allRcProfiles, trimConfig),
  zulipMessages: trimZulipResults(allZulipResults, trimConfig),
};

if (trimmed.recurseProfiles.length === 0 && trimmed.zulipMessages.length === 0) {
  console.log("\nNo results to recommend from.");
} else {
  await runRecommendation(query, trimmed, values.model);
}
```

**5. Recommendation runner helper**

```ts
async function runRecommendation(
  query: string,
  trimmed: { recurseProfiles: RcProfileSummary[]; zulipMessages: ZulipMessageSummary[] },
  model: string | undefined
): Promise<void> {
  let recommendations: Recommendation[];
  try {
    recommendations = await recommendPerson({ query, ...trimmed, model });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`⚠ Couldn't generate recommendations: ${message}`);
    return;
  }

  if (recommendations.length === 0) {
    console.log("\nNo recommendations.");
    return;
  }

  console.log(`\n─── Top recommendations for "${query}" ───\n`);
  recommendations.forEach((rec, i) => {
    console.log(`${i + 1}. ${rec.name} — ${rec.reason}`);
    const profileUrl = buildRecurseProfileUrl(rec.recurseProfileSlug, allRcProfiles);
    if (profileUrl) console.log(`   Profile: ${profileUrl}`);
    for (const t of rec.zulipTopics ?? []) {
      const topicUrl = buildZulipTopicUrl(t.channel, t.topic, allZulipResults);
      if (topicUrl) console.log(`   Zulip:   ${topicUrl}`);
    }
    console.log();
  });
}
```

**6. URL builders**

```ts
function buildRecurseProfileUrl(slug: string | null | undefined, knownProfiles: any[]): string | null {
  if (!slug) return null;
  // Only build the URL if the slug actually exists in our input data
  const found = knownProfiles.some((p) => p?.slug === slug);
  if (!found) return null;
  return `https://www.recurse.com/directory/${slug}`;
}

function buildZulipTopicUrl(channel: string, topic: string, knownResults: TopicResult[]): string | null {
  const found = knownResults.some((r) => r.channel === channel && r.topic === topic);
  if (!found) return null;
  // Zulip narrow URL format
  const encChannel = encodeURIComponent(channel);
  const encTopic = encodeURIComponent(topic);
  return `https://recurse.zulipchat.com/#narrow/channel/${encChannel}/topic/${encTopic}`;
}
```

If the model returns a slug or topic that doesn't appear in the input data, we drop the URL silently. This protects against hallucinated URLs without crashing.

**7. Trim config + trim functions**

```ts
interface TrimConfig {
  rcBioMaxChars: number;
  zulipMessageMaxChars: number;
  zulipMessageMaxCount: number;
}

const TRIM_PRESETS: Record<string, TrimConfig> = {
  small:  { rcBioMaxChars: 300,  zulipMessageMaxChars: 200, zulipMessageMaxCount: 50  },
  medium: { rcBioMaxChars: 800,  zulipMessageMaxChars: 400, zulipMessageMaxCount: 100 },
  large:  { rcBioMaxChars: 2000, zulipMessageMaxChars: 800, zulipMessageMaxCount: 200 },
};

function resolveTrimConfig(contextFlag: string | undefined): TrimConfig {
  const key = contextFlag ?? "small";
  const preset = TRIM_PRESETS[key];
  if (!preset) {
    console.error(`⚠ Unknown --context value "${key}". Use small, medium, or large.`);
    process.exit(1);
  }
  return preset;
}

function trimRcProfiles(profiles: any[], cfg: TrimConfig): RcProfileSummary[] {
  return profiles.map((p) => {
    const rawBio = [p.bio_rendered, p.before_rc_rendered, p.during_rc_rendered]
      .filter((s) => typeof s === "string" && s.length > 0)
      .join(" ");
    const bio = stripMarkdown(rawBio).slice(0, cfg.rcBioMaxChars);
    return { id: p.id, name: p.name, slug: p.slug, bio };
  });
}

function trimZulipResults(results: TopicResult[], cfg: TrimConfig): ZulipMessageSummary[] {
  // Flatten topic-grouped structure into one list, sorted by recency (most recent first), capped at maxCount
  const flat: ZulipMessageSummary[] = [];
  for (const r of results) {
    for (const m of r.messages) {
      flat.push({
        sender: m.sender_full_name,
        channel: r.channel,
        topic: r.topic,
        content: stripMarkdown(m.content).slice(0, cfg.zulipMessageMaxChars),
      });
    }
  }
  // Most recent first; the `messages` arrays inside TopicResult are already sorted oldest→newest,
  // so we sort the flat list by index implicitly by topic recency. Simpler: sort by topic lastActivity desc.
  // For implementation, the implementer can use any reasonable ordering — recency is the goal.
  return flat.slice(0, cfg.zulipMessageMaxCount);
}
```

The implementer can refine the recency sort. The important properties are: hard count cap, hard char cap per message, fields stripped to what the model needs.

Note `stripMarkdown` is now imported from `utils/zulip-search.ts` (moved per the Zulip refactor).

## Output Format

After all the per-query result blocks print, a final block:

```
─── Top recommendations for "rust" ───

1. Jane Doe — has been active in the Rust topic this week and lists "systems programming" in her bio
   Profile: https://www.recurse.com/directory/1234-jane-doe
   Zulip:   https://recurse.zulipchat.com/#narrow/channel/...

2. Bob Smith — wrote a borrow-checker tutorial during their batch
   Profile: https://www.recurse.com/directory/5678-bob-smith

3. Alice Lee — currently in the "🧑‍💻 current batches" channel asking about Rust async runtimes
   Zulip:   https://recurse.zulipchat.com/#narrow/...
```

The block is keyed on the **original** query (not the suggested keywords) since the user is the one who typed the original.

## Edge Cases

| Case | Behavior |
| --- | --- |
| RC empty across all queries, Zulip has results | Call recommender with `recurseProfiles: []`. Model picks from Zulip senders. URLs may be Zulip-only. |
| Zulip empty across all queries, RC has results | Call recommender with `zulipMessages: []`. Standard case. |
| Both empty across all queries | Skip recommender entirely. Print `No results to recommend from.` |
| Ollama call fails | Print `⚠ Couldn't generate recommendations: <err>` to stderr. Search results were already printed above, so the user keeps the raw data. |
| Model returns 0 recommendations | Print `No recommendations.` |
| Model returns a slug not in input | Drop the profile URL silently (no broken link). |
| Model returns a (channel, topic) not in input | Drop the Zulip URL silently. |
| Model invents a person name | We don't validate. Missing URLs hint that the model hallucinated. |
| `--context` value is invalid | Print error to stderr and exit 1 |
| Combined RC profiles + Zulip messages exceed token budget | The trim step has hard caps; we trust those caps. No further protection. |
| User is running with `--zulip` only and no Zulip results | Combined empty path triggers, prints `No results to recommend from.` |
| User is running with `--recurse` only and no RC results | Combined empty path triggers, prints `No results to recommend from.` |

## Token Budget

Defaults are tuned for `llama3.2` (3B). The `--context` flag picks a preset:

| Preset | RC bio chars | Zulip msg chars | Zulip msg count | Suggested model size |
| --- | --- | --- | --- | --- |
| `small` (default) | 300 | 200 | 50 | ~3B |
| `medium` | 800 | 400 | 100 | ~8B |
| `large` | 2000 | 800 | 200 | 20B+ |

If the presets prove too coarse, we can add individual env-var escape hatches in a follow-up.

## Dependencies

No new packages. We already have `ollama`.

## Testing

No automated tests for any of this work. Manual end-to-end verification:

1. `bun index.ts "rust"` — full default flow: suggestions → searches → recommendation block
2. `bun index.ts --no-suggest "rust"` — skip suggestions, recommendation still runs
3. `bun index.ts --recurse "obviously-bogus-query-xyz"` — empty path: prints "No results to recommend from."
4. `bun index.ts --no-suggest --model nonexistent-model "rust"` — Ollama failure: prints warning, raw results still visible
5. `bun index.ts --context medium "rust"` — verify medium preset triggers (look at output volume)
6. `bun index.ts --context bogus "rust"` — invalid context value: prints error, exits 1

## Open Questions

None at design time. Possible follow-ups:
- Per-knob env var overrides (`RECOMMEND_RC_BIO_MAX` etc.) if presets prove too coarse
- A `--explain` mode for longer recommendation reasoning
- A `--draft-message` mode that generates a Zulip opener
