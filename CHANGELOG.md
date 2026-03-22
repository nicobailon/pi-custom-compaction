# Changelog

## 0.2.0 — 2026-03-22

- **Profile model overrides** — profiles can now override the `models` list per session model. Use a different summarization model when chatting with Opus vs Codex.
- **Profile template paths** — profiles can specify explicit `template` and `updateTemplate` paths, overriding convention-based discovery. Tilde-expanded.
- **Compaction spinner widget** — animated `Loader` spinner displays during extension-initiated compaction, matching pi's built-in appearance.
- **Post-compaction status fix** — status bar no longer shows `?` for 1-2 messages after compaction. Shows just the label until token counts are available again.
- **Watchdog widget cleanup** — if compaction hangs and the 2-minute watchdog fires, the spinner widget is now properly removed.
- **Test suite** — 62 tests across 6 files covering parse, merge, config, pure logic, model resolution, and template discovery. Run with `tsx --test test/*.test.ts`.

## 0.1.0 — 2026-03-21

Initial release.

Custom compaction for Pi — swap the model used for compaction summaries, define your own summary template structure, and optionally trigger compaction at a specific token count. Everything is driven by a JSON config file with no UI overlay.

Core features:

- **Custom compaction model** with ordered fallback chain (`models`). If one provider's credits run out, the next model takes over. Per-model `thinkingLevel` and `preservationInstruction` overrides.
- **Token-based trigger** (`trigger.maxTokens`). Omit to let Pi's built-in decide when to compact. Set a value to proactively compact at that token count.
- **Custom summary templates** via convention-based markdown files. Separate initial and update templates so the model knows what to extract vs how to merge. Profile-specific templates supported. Entirely optional — Pi's built-in format works without one.
- **Profiles** — named overrides for trigger and summary settings that activate based on the session model. Match on exact `provider/modelId`.
- **Global and project config** — `~/.pi/agent/compaction-policy.json` (global) and `<project>/.pi/compaction-policy.json` (project, takes priority).
- **Status bar** with configurable label (`ui.name`), showing token usage relative to the effective trigger point.
- **Commands**: `/compact-policy` (show effective config) and `/compact-now [focus]` (trigger immediately).
- **Builtin skip margin** prevents double-triggering when the extension's trigger is close to Pi's own compaction threshold.
