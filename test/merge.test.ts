import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyProfileOverrides, mergePolicy, setPatchValue } from "../policy/merge.ts";
import { DEFAULT_POLICY, type CompactionPolicy, type CompactionPolicyPatch, POLICY_KEYS, type PolicyKey } from "../policy/types.ts";

function makeBasePolicy(): CompactionPolicy {
	return {
		...DEFAULT_POLICY,
		trigger: { ...DEFAULT_POLICY.trigger, maxTokens: 200000 },
		models: [{ model: "openai/gpt-4" }],
		ui: { ...DEFAULT_POLICY.ui },
		summary: { ...DEFAULT_POLICY.summary },
		summaryRetention: undefined,
		profiles: {
			default: {
				match: "openai/gpt-4",
				trigger: { minTokens: 90000 },
				summary: { thinkingLevel: "medium" },
			},
		},
	};
}

describe("mergePolicy", () => {
	it("returns an unchanged policy for an empty patch", () => {
		const base = makeBasePolicy();
		const merged = mergePolicy(base, {});
		assert.deepEqual(merged, base);
	});

	it("merges partial trigger overrides with base trigger", () => {
		const base = makeBasePolicy();
		const merged = mergePolicy(base, { trigger: { minTokens: 12345 } });
		assert.equal(merged.trigger.minTokens, 12345);
		assert.equal(merged.trigger.cooldownMs, base.trigger.cooldownMs);
		assert.equal(merged.trigger.maxTokens, base.trigger.maxTokens);
	});

	it("replaces models when models are provided in patch", () => {
		const base = makeBasePolicy();
		const merged = mergePolicy(base, { models: [{ model: "anthropic/claude-3-opus" }] });
		assert.deepEqual(merged.models, [{ model: "anthropic/claude-3-opus" }]);
	});

	it("replaces profiles when profiles are provided in patch", () => {
		const base = makeBasePolicy();
		const merged = mergePolicy(base, {
			profiles: {
				alt: {
					match: "anthropic/claude-3-opus",
					trigger: { maxTokens: 150000 },
				},
			},
		});
		assert.deepEqual(merged.profiles, {
			alt: {
				match: "anthropic/claude-3-opus",
				trigger: { maxTokens: 150000 },
			},
		});
	});

	it("merges ui and summary partial overrides", () => {
		const base = makeBasePolicy();
		const merged = mergePolicy(base, {
			ui: { quiet: true },
			summary: { preservationInstruction: "Preserve stack traces." },
		});
		assert.equal(merged.ui.quiet, true);
		assert.equal(merged.ui.name, base.ui.name);
		assert.equal(merged.summary.preservationInstruction, "Preserve stack traces.");
		assert.equal(merged.summary.thinkingLevel, base.summary.thinkingLevel);
	});

	it("replaces summaryRetention when provided", () => {
		const base = makeBasePolicy();
		const merged = mergePolicy(base, {
			summaryRetention: { mode: "percent", value: 20 },
		});
		assert.deepEqual(merged.summaryRetention, { mode: "percent", value: 20 });
	});
});

describe("setPatchValue", () => {
	it("sets all known policy keys on the correct nested fields", () => {
		const patch: CompactionPolicyPatch = {};
		const values: Record<PolicyKey, unknown> = {
			"trigger.maxTokens": 1,
			"trigger.minTokens": 2,
			"trigger.cooldownMs": 3,
			"trigger.builtinReserveTokens": 4,
			"trigger.builtinSkipMarginPercent": 5,
			"ui.name": "compact2",
			"ui.quiet": true,
			"ui.showStatus": false,
			"ui.minimalStatus": true,
			"summary.thinkingLevel": "high",
			"summary.preservationInstruction": "Keep exact text.",
		};

		for (const key of POLICY_KEYS) {
			setPatchValue(patch, key, values[key]);
		}

		assert.deepEqual(patch, {
			trigger: {
				maxTokens: 1,
				minTokens: 2,
				cooldownMs: 3,
				builtinReserveTokens: 4,
				builtinSkipMarginPercent: 5,
			},
			ui: {
				name: "compact2",
				quiet: true,
				showStatus: false,
				minimalStatus: true,
			},
			summary: {
				thinkingLevel: "high",
				preservationInstruction: "Keep exact text.",
			},
		});
	});
});

describe("applyProfileOverrides", () => {
	it("merges trigger, models, summary, and retention overrides into policy", () => {
		const base = makeBasePolicy();
		const result = applyProfileOverrides(base, {
			match: "openai/gpt-4",
			trigger: { cooldownMs: 5000 },
			models: [{ model: "anthropic/claude-haiku-4-5" }],
			summary: { thinkingLevel: "high" },
			summaryRetention: { mode: "tokens", value: 30000 },
		});

		assert.equal(result.trigger.cooldownMs, 5000);
		assert.equal(result.trigger.minTokens, base.trigger.minTokens);
		assert.deepEqual(result.models, [{ model: "anthropic/claude-haiku-4-5" }]);
		assert.equal(result.summary.thinkingLevel, "high");
		assert.equal(result.summary.preservationInstruction, base.summary.preservationInstruction);
		assert.deepEqual(result.summaryRetention, { mode: "tokens", value: 30000 });
	});

	it("returns unchanged policy when profile has no overrides", () => {
		const base = makeBasePolicy();
		const result = applyProfileOverrides(base, { match: "openai/gpt-4" });
		assert.deepEqual(result, base);
	});
});
