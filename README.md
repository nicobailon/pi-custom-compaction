<p>
  <img src="banner.png" alt="pi-custom-compaction" width="1100">
</p>

# pi-custom-compaction

Swap the model and template Pi uses for compaction. Optionally trigger compaction at a specific token count.

Once enabled, the extension intercepts every compaction — whether triggered by Pi's built-in or by the extension itself — and uses your configured model and template to generate the summary. If all configured models fail to resolve, it falls back to Pi's built-in compaction silently.

Off by default. Pi's built-in compaction works normally until you enable it.

## Installation

```bash
pi install npm:pi-custom-compaction
```

## Quick start

Create `~/.pi/agent/compaction-policy.json` (global) or `<project>/.pi/compaction-policy.json` (project, takes priority):

```json
{
  "enabled": true,
  "models": [
    { "model": "anthropic/claude-sonnet-4", "thinkingLevel": "medium" }
  ]
}
```

Run `/reload`. Done. Pi still decides when to compact — you just swapped the model.

To also control **when** it triggers and how much raw context is retained:

```json
{
  "enabled": true,
  "trigger": { "maxTokens": 350000 },
  "summaryRetention": { "mode": "percent", "value": 20 },
  "ui": { "name": "ctx" },
  "models": [
    { "model": "anthropic/claude-haiku-4-5", "thinkingLevel": "medium" },
    { "model": "openai-codex/gpt-5.3-codex", "thinkingLevel": "low" }
  ]
}
```

Status bar shows: `ctx · keep 20% · 24.7% (86426/350000)`

## Commands

| Command | What it does |
| --- | --- |
| `/compact-policy` | Shows effective config (models, trigger, retention, profile, template) |
| `/compact-now [focus]` | Triggers compaction immediately |

## Models

Ordered fallback chain. Tries each model in order, uses the first one that resolves. If credits run out on one, the next takes over.

Choose compaction models with enough context window for the history they need to summarize. A small cheap model can work for lighter sessions, but if its context window is too small relative to the session history or your retention settings, compaction may fall back to Pi's default behavior instead of using the extension's custom path.

Plain strings inherit base `summary` settings. Objects let you override per model:

```json
"models": [
  { "model": "anthropic/claude-sonnet-4", "thinkingLevel": "medium" },
  "openai-codex/gpt-5.3-codex"
]
```

## Trigger

| Key | What it does | Default |
| --- | --- | --- |
| `maxTokens` | Compact at this token count. Omit to let Pi decide. | — |
| `minTokens` | Won't trigger below this count | 100000 |
| `cooldownMs` | Min time between proactive compactions | 60000 |

`maxTokens` makes compaction happen sooner. Without it, Pi waits until the context window is almost full (~984K on a 1M model). With `maxTokens: 350000`, compaction fires at 350K instead.

## Raw retention (`summaryRetention`)

Control how much recent context stays raw before summarization.

Add `summaryRetention` to your compaction config file:

- global: `~/.pi/agent/compaction-policy.json`
- project: `<project>/.pi/compaction-policy.json`

If both exist, the project file takes priority over the global one.

Example using an exact token budget:

```json
{
  "enabled": true,
  "summaryRetention": { "mode": "tokens", "value": 40000 },
  "models": [
    { "model": "anthropic/claude-sonnet-4", "thinkingLevel": "medium" }
  ]
}
```

Example using a percent of context window:

```json
{
  "enabled": true,
  "summaryRetention": { "mode": "percent", "value": 20 },
  "models": [
    { "model": "anthropic/claude-sonnet-4", "thinkingLevel": "medium" }
  ]
}
```

- `tokens`: direct override for effective `keepRecentTokens`
- `percent`: computes keep tokens from `min(session model window, summary model window)`

In percent mode, the summary model's context window matters too. If you choose a small fast model for compaction, it can reduce the usable retention budget or make your configured retention impossible for that run.

After editing the config, run `/reload` in Pi.

If retention config is invalid at runtime, or the computed keep budget is impossible with the current reserve/window, the extension warns and falls back to Pi default compaction for that compaction run.

## How maxTokens interacts with the context window

You don't need to tune `maxTokens` per model. One config works across models with different context sizes:

- **Well below context window** (350K on a 1M model) — extension fires at 350K, plenty of room for the summary.
- **Close to context window** (260K on a 272K model) — extension backs off and lets Pi's built-in fire at 256K with its own reserve, preventing double-compaction.
- **Larger than context window** (350K on a 272K model) — proactive trigger can never fire, Pi handles it at 256K.

<details>
<summary>Advanced trigger tuning</summary>

| Key | What it does | Default |
| --- | --- | --- |
| `builtinReserveTokens` | Tokens Pi's built-in reserves before triggering | 16384 |
| `builtinSkipMarginPercent` | Skip if Pi's builtin would trigger within this margin | 5 |

</details>

## Profiles

Override trigger, models, summary settings, and retention per session model:

```json
"profiles": {
  "opus-large-ctx": {
    "match": "anthropic/claude-opus-4-6",
    "trigger": { "maxTokens": 500000 },
    "summaryRetention": { "mode": "percent", "value": 15 },
    "models": [{ "model": "anthropic/claude-haiku-4-5", "thinkingLevel": "medium" }],
    "template": "~/.pi/agent/templates/opus.md",
    "updateTemplate": "~/.pi/agent/templates/opus-update.md"
  },
  "fast-codex": {
    "match": "openai-codex/gpt-5.3-codex",
    "models": ["openai-codex/gpt-5.3-codex"],
    "summary": { "thinkingLevel": "low" }
  }
}
```

`match` is the exact `provider/modelId` of the session model. First alphabetical match wins. Profile `models` replaces the base models list for that session. `summaryRetention` overrides base retention for the matched session model. `template` and `updateTemplate` override template discovery with explicit paths (tilde-expanded). Active profile shows in the status bar.

## Templates (optional)

Without a template, Pi's built-in compaction format is used. To customize the summary structure, drop markdown files at convention paths — no config needed.

Two template types:
- **Initial** (`compaction-template.md`) — first compaction, brackets describe what to extract
- **Update** (`compaction-template-update.md`) — subsequent compactions, brackets describe how to merge (optional, falls back to initial)

Discovery order (first found wins):

```
Initial template:
  <project>/.pi/compaction-templates/PROFILE.md
  ~/.pi/agent/compaction-templates/PROFILE.md
  <project>/.pi/compaction-template.md
  ~/.pi/agent/compaction-template.md

Update template:
  <project>/.pi/compaction-templates/PROFILE-update.md
  ~/.pi/agent/compaction-templates/PROFILE-update.md
  <project>/.pi/compaction-template-update.md
  ~/.pi/agent/compaction-template-update.md
```

Profile-specific paths are only checked when a profile is active. Template files are never modified — they're format definitions read on every compaction. The model fills in the brackets based on the conversation.

Example initial template (`compaction-template.md`):

```markdown
## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]
```

Example update template (`compaction-template-update.md`):

```markdown
## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]
```

`summary.preservationInstruction` is appended as an extra directive after the template.

## UI options

```json
"ui": {
  "name": "ctx",
  "showStatus": true,
  "minimalStatus": false,
  "quiet": false
}
```

| Key | What it does | Default |
| --- | --- | --- |
| `name` | Status bar label | `"compact"` |
| `showStatus` | Show status bar | `true` |
| `minimalStatus` | Short format (just percentage) | `false` |
| `quiet` | Suppress non-critical notifications | `false` |

Status bar examples:

```
ctx · keep 20% · 24.7% (86426/350000)
ctx: opus-large-ctx · keep 15% · 50.1% (250500/500000)
ctx · keep 40000t · 31%
```

## Summary options

```json
"summary": {
  "thinkingLevel": "medium",
  "preservationInstruction": "Preserve exact file paths, function names, and error messages."
}
```

These are base settings. Model entries and profiles can override `thinkingLevel` and `preservationInstruction` individually.
