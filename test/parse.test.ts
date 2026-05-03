import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseModelSelector, parsePolicyPatch, parseStatusColor } from "../policy/parse.ts";

describe("parsePolicyPatch", () => {
	it("accepts an empty object as an empty patch", () => {
		const result = parsePolicyPatch({});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.deepEqual(result.value, {});
	});

	it("parses enabled true and false", () => {
		const enabled = parsePolicyPatch({ enabled: true });
		assert.deepEqual(enabled, { ok: true, value: { enabled: true } });

		const disabled = parsePolicyPatch({ enabled: false });
		assert.deepEqual(disabled, { ok: true, value: { enabled: false } });
	});

	it("parses trigger values", () => {
		const result = parsePolicyPatch({
			trigger: {
				maxTokens: "200000",
				minTokens: 100000,
				cooldownMs: 60000,
				builtinReserveTokens: "16384",
				builtinSkipMarginPercent: "7.5",
			},
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.deepEqual(result.value.trigger, {
			maxTokens: 200000,
			minTokens: 100000,
			cooldownMs: 60000,
			builtinReserveTokens: 16384,
			builtinSkipMarginPercent: 7.5,
		});
	});

	it("parses ui section values", () => {
		const result = parsePolicyPatch({
			ui: { name: "compact-status", quiet: "true", showStatus: false, minimalStatus: "false" },
		});
		assert.deepEqual(result, {
			ok: true,
			value: { ui: { name: "compact-status", quiet: true, showStatus: false, minimalStatus: false } },
		});
	});

	it("parses summary section values", () => {
		const result = parsePolicyPatch({
			summary: { thinkingLevel: "medium", preservationInstruction: "Keep exact errors." },
		});
		assert.deepEqual(result, {
			ok: true,
			value: { summary: { thinkingLevel: "medium", preservationInstruction: "Keep exact errors." } },
		});
	});

	it("parses summaryRetention in both tokens and percent modes", () => {
		assert.deepEqual(parsePolicyPatch({ summaryRetention: { mode: "tokens", value: "24000" } }), {
			ok: true,
			value: { summaryRetention: { mode: "tokens", value: 24000 } },
		});

		assert.deepEqual(parsePolicyPatch({ summaryRetention: { mode: "percent", value: "20" } }), {
			ok: true,
			value: { summaryRetention: { mode: "percent", value: 20 } },
		});
	});

	it("parses models array with string and object entries", () => {
		const result = parsePolicyPatch({
			models: [
				"openai/gpt-4",
				{
					model: "anthropic/claude-3-opus",
					thinkingLevel: "high",
					preservationInstruction: "Keep all stack traces.",
				},
			],
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.deepEqual(result.value.models, [
			{ model: "openai/gpt-4" },
			{
				model: "anthropic/claude-3-opus",
				thinkingLevel: "high",
				preservationInstruction: "Keep all stack traces.",
			},
		]);
	});

	it("parses profiles with trigger, models, summary, retention, and template overrides", () => {
		const result = parsePolicyPatch({
			profiles: {
				codex: {
					match: "openai/gpt-4",
					trigger: { minTokens: "80000", builtinSkipMarginPercent: 4.5 },
					models: ["anthropic/claude-haiku-4-5"],
					summary: {
						thinkingLevel: "low",
						preservationInstruction: "Preserve filenames and error text.",
					},
					summaryRetention: { mode: "percent", value: 15 },
					template: "~/.pi/agent/templates/codex.md",
					updateTemplate: "~/.pi/agent/templates/codex-update.md",
				},
			},
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.deepEqual(result.value.profiles, {
			codex: {
				match: "openai/gpt-4",
				trigger: { minTokens: 80000, builtinSkipMarginPercent: 4.5 },
				models: [{ model: "anthropic/claude-haiku-4-5" }],
				summary: {
					thinkingLevel: "low",
					preservationInstruction: "Preserve filenames and error text.",
				},
				summaryRetention: { mode: "percent", value: 15 },
				template: "~/.pi/agent/templates/codex.md",
				updateTemplate: "~/.pi/agent/templates/codex-update.md",
			},
		});
	});

	it("rejects non-object input", () => {
		for (const input of [null, [], "text", 42]) {
			assert.deepEqual(parsePolicyPatch(input), { ok: false, error: "Policy patch must be an object" });
		}
	});

	it("rejects unknown top-level keys", () => {
		assert.deepEqual(parsePolicyPatch({ nope: true }), {
			ok: false,
			error: "Unknown policy key: nope",
		});
	});

	it("rejects unknown trigger keys", () => {
		assert.deepEqual(parsePolicyPatch({ trigger: { unknown: 1 } }), {
			ok: false,
			error: "Unknown policy key: trigger.unknown",
		});
	});

	it("rejects invalid types for enabled, trigger, ui, and summary fields", () => {
		assert.deepEqual(parsePolicyPatch({ enabled: 1 }), {
			ok: false,
			error: "Invalid enabled: expected literal true or false",
		});
		assert.deepEqual(parsePolicyPatch({ trigger: { minTokens: "1.5" } }), {
			ok: false,
			error: "Invalid trigger.minTokens: expected base-10 non-negative integer",
		});
		assert.deepEqual(parsePolicyPatch({ ui: { quiet: "yes" } }), {
			ok: false,
			error: "Invalid ui.quiet: expected literal true or false",
		});
		assert.deepEqual(parsePolicyPatch({ summary: { thinkingLevel: "max" } }), {
			ok: false,
			error: "Invalid summary.thinkingLevel: expected one of: off, low, medium, high",
		});
	});

	it("rejects an empty models array", () => {
		assert.deepEqual(parsePolicyPatch({ models: [] }), {
			ok: false,
			error: "Invalid models: models array must not be empty",
		});
	});

	it('rejects a model object without a "model" field', () => {
		assert.deepEqual(parsePolicyPatch({ models: [{ thinkingLevel: "low" }] }), {
			ok: false,
			error: 'Invalid models: model entry missing required "model" field',
		});
	});

	it("rejects invalid model selector formats in models", () => {
		for (const model of ["gpt-4", "openai /gpt-4", " openai/gpt-4 ", "openai/"]) {
			assert.deepEqual(parsePolicyPatch({ models: [model] }), {
				ok: false,
				error: "Invalid models: expected model selector provider/modelId",
			});
		}
	});

	it("rejects invalid preservationInstruction values", () => {
		assert.deepEqual(parsePolicyPatch({ summary: { preservationInstruction: 123 } }), {
			ok: false,
			error: "Invalid summary.preservationInstruction: expected instruction string",
		});
		assert.deepEqual(parsePolicyPatch({ summary: { preservationInstruction: " keep " } }), {
			ok: false,
			error: "Invalid summary.preservationInstruction: expected instruction string without surrounding whitespace",
		});
	});

	it("rejects invalid summaryRetention values", () => {
		assert.deepEqual(parsePolicyPatch({ summaryRetention: { mode: "ratio", value: 20 } }), {
			ok: false,
			error: 'Invalid summaryRetention: mode must be "tokens" or "percent"',
		});
		assert.deepEqual(parsePolicyPatch({ summaryRetention: { mode: "tokens", value: "2.5" } }), {
			ok: false,
			error: "Invalid summaryRetention: tokens mode value: expected base-10 non-negative integer",
		});
		assert.deepEqual(parsePolicyPatch({ summaryRetention: { mode: "percent", value: 120 } }), {
			ok: false,
			error: "Invalid summaryRetention: percent mode value: expected percent in [0,100]",
		});
	});

	it('rejects profiles missing the required "match" field', () => {
		assert.deepEqual(parsePolicyPatch({ profiles: { fast: { trigger: { minTokens: 10 } } } }), {
			ok: false,
			error: 'profiles.fast: missing required "match" field',
		});
	});

	it("rejects profiles with unknown keys", () => {
		assert.deepEqual(parsePolicyPatch({ profiles: { fast: { match: "openai/gpt-4", extra: true } } }), {
			ok: false,
			error: "profiles.fast: unknown key: extra",
		});
	});

	it("rejects invalid profile summaryRetention values", () => {
		assert.deepEqual(
			parsePolicyPatch({
				profiles: {
					fast: {
						match: "openai/gpt-4",
						summaryRetention: { mode: "percent", value: -1 },
					},
				},
			}),
			{
				ok: false,
				error: "profiles.fast.summaryRetention: percent mode value: expected percent in [0,100]",
			},
		);
	});
});

describe("parseModelSelector", () => {
	it("accepts valid provider/model selectors", () => {
		assert.deepEqual(parseModelSelector("openai/gpt-4"), { ok: true, value: "openai/gpt-4" });
		assert.deepEqual(parseModelSelector("anthropic/claude-3-opus"), {
			ok: true,
			value: "anthropic/claude-3-opus",
		});
	});

	it("rejects malformed selectors, non-string input, and whitespace-padded strings", () => {
		for (const selector of [
			"gpt-4",
			"/gpt-4",
			"openai/",
			"open ai/gpt-4",
			"openai/gpt 4",
			" openai/gpt-4",
			"openai/gpt-4 ",
			123,
		]) {
			assert.deepEqual(parseModelSelector(selector), {
				ok: false,
				error: "expected model selector provider/modelId",
			});
		}
	});
});

describe("parseStatusColor", () => {
	const EXPECTED_ERROR =
		'expected a ThemeColor token (e.g. "accent"), a hex color (e.g. "#00d7ff"), or an ANSI color name (e.g. "cyan", "brightMagenta")';

	it("accepts a ThemeColor token", () => {
		assert.deepEqual(parseStatusColor("accent"), {
			ok: true,
			value: { kind: "theme", token: "accent" },
		});
		assert.deepEqual(parseStatusColor("borderAccent"), {
			ok: true,
			value: { kind: "theme", token: "borderAccent" },
		});
		assert.deepEqual(parseStatusColor("bashMode"), {
			ok: true,
			value: { kind: "theme", token: "bashMode" },
		});
	});

	it("accepts any identifier-shaped string as a theme token (validated lazily by theme.fg at render time)", () => {
		// We intentionally do NOT hardcode pi's ThemeColor union here; instead,
		// `theme.fg` rejects unknown tokens at render time and `styleStatusText`
		// falls back to plain text. This test documents that intent.
		assert.deepEqual(parseStatusColor("someFutureThemeToken"), {
			ok: true,
			value: { kind: "theme", token: "someFutureThemeToken" },
		});
	});

	it("accepts a 6-digit hex color and bakes it into truecolor ANSI", () => {
		assert.deepEqual(parseStatusColor("#00d7ff"), {
			ok: true,
			value: { kind: "ansi", open: "\x1b[38;2;0;215;255m", close: "\x1b[39m" },
		});
		assert.deepEqual(parseStatusColor("#FFFFFF"), {
			ok: true,
			value: { kind: "ansi", open: "\x1b[38;2;255;255;255m", close: "\x1b[39m" },
		});
	});

	it("accepts a 3-digit hex color and expands it", () => {
		assert.deepEqual(parseStatusColor("#f0a"), {
			ok: true,
			value: { kind: "ansi", open: "\x1b[38;2;255;0;170m", close: "\x1b[39m" },
		});
	});

	it("accepts named ANSI colors (standard and bright)", () => {
		assert.deepEqual(parseStatusColor("cyan"), {
			ok: true,
			value: { kind: "ansi", open: "\x1b[36m", close: "\x1b[39m" },
		});
		assert.deepEqual(parseStatusColor("brightMagenta"), {
			ok: true,
			value: { kind: "ansi", open: "\x1b[95m", close: "\x1b[39m" },
		});
	});

	it("rejects malformed hex values", () => {
		for (const value of ["#", "#00", "#12345", "#1234567", "#zzzzzz", "00d7ff"]) {
			assert.deepEqual(parseStatusColor(value), { ok: false, error: EXPECTED_ERROR });
		}
	});

	it("rejects unknown-shaped values and non-string input", () => {
		// Shape rules: must be non-empty, no leading/trailing whitespace, and
		// (if not hex/ANSI) must look like a camelCase identifier. `bright-magenta`
		// and `bright_magenta` hit the wrong casing branch; ` accent ` has padding.
		for (const value of [
			"",
			"bright-magenta",
			"bright_magenta",
			" accent ",
			"1abc",
			123,
			null,
			undefined,
			{},
			[],
		]) {
			assert.deepEqual(parseStatusColor(value), { ok: false, error: EXPECTED_ERROR });
		}
	});

	it("round-trips through parsePolicyPatch for ui.statusColor", () => {
		const result = parsePolicyPatch({ ui: { statusColor: "#00d7ff" } });
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.deepEqual(result.value, {
			ui: { statusColor: { kind: "ansi", open: "\x1b[38;2;0;215;255m", close: "\x1b[39m" } },
		});
	});

	it("reports ui.statusColor parse errors with the standard prefix", () => {
		assert.deepEqual(parsePolicyPatch({ ui: { statusColor: "not-a-color" } }), {
			ok: false,
			error: `Invalid ui.statusColor: ${EXPECTED_ERROR}`,
		});
	});
});

describe("ui.statusColor end-to-end (parse -> merge -> styleStatusText)", () => {
	// Inline import to avoid circular test-file concerns; keeps this near the
	// parse tests it exercises.
	it("round-trips a ThemeColor token all the way to theme.fg", async () => {
		const { mergePolicy } = await import("../policy/merge.ts");
		const { styleStatusText } = await import("../runtime/pure.ts");
		const { DEFAULT_POLICY } = await import("../policy/types.ts");

		const parsed = parsePolicyPatch({ ui: { statusColor: "accent" } });
		assert.equal(parsed.ok, true);
		if (!parsed.ok) return;

		const merged = mergePolicy(DEFAULT_POLICY, parsed.value);
		assert.deepEqual(merged.ui.statusColor, { kind: "theme", token: "accent" });

		const styled = styleStatusText("x", merged.ui.statusColor, {
			fg: (color, text) => `<fg:${color}>${text}</fg>`,
		});
		assert.equal(styled, "<fg:accent>x</fg>");
	});

	it("round-trips a hex color into a truecolor ANSI wrap", async () => {
		const { mergePolicy } = await import("../policy/merge.ts");
		const { styleStatusText } = await import("../runtime/pure.ts");
		const { DEFAULT_POLICY } = await import("../policy/types.ts");

		const parsed = parsePolicyPatch({ ui: { statusColor: "#00d7ff" } });
		assert.equal(parsed.ok, true);
		if (!parsed.ok) return;

		const merged = mergePolicy(DEFAULT_POLICY, parsed.value);
		const styled = styleStatusText("x", merged.ui.statusColor, {
			fg: () => "SHOULD-NOT-BE-CALLED",
		});
		assert.equal(styled, "\x1b[38;2;0;215;255mx\x1b[39m");
	});
});
