import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseModelSelector, parsePolicyPatch } from "../policy/parse.ts";

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
