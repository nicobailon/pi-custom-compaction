import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findMatchingProfile, resolveEffectivePolicy, shouldTriggerProactiveCompact, styleStatusText } from "../runtime/pure.ts";
import { DEFAULT_POLICY, type CompactionPolicy, type ProactiveTriggerInput } from "../policy/types.ts";

function makePolicy(): CompactionPolicy {
	return {
		...DEFAULT_POLICY,
		trigger: {
			...DEFAULT_POLICY.trigger,
			maxTokens: 1000,
			minTokens: 900,
			cooldownMs: 1000,
			builtinReserveTokens: 200,
			builtinSkipMarginPercent: 5,
		},
		models: [{ model: "openai/gpt-4" }],
		ui: { ...DEFAULT_POLICY.ui },
		summary: { ...DEFAULT_POLICY.summary },
		profiles: undefined,
	};
}

function makeTriggerInput(): ProactiveTriggerInput {
	return {
		lastAssistantMessage: { role: "assistant", stopReason: "stop" } as never,
		usage: { tokens: 1200, percent: 40, contextWindow: 1000 } as never,
		inFlight: false,
		nowMs: 10_000,
		lastProactiveAtMs: 0,
		policy: makePolicy(),
	};
}

describe("shouldTriggerProactiveCompact", () => {
	it("returns false when there is no last assistant message", () => {
		const input = makeTriggerInput();
		assert.equal(shouldTriggerProactiveCompact({ ...input, lastAssistantMessage: undefined }), false);
	});

	it('returns false when last assistant stopReason is "error"', () => {
		const input = makeTriggerInput();
		assert.equal(
			shouldTriggerProactiveCompact({
				...input,
				lastAssistantMessage: { role: "assistant", stopReason: "error" } as never,
			}),
			false,
		);
	});

	it('returns false when last assistant stopReason is "aborted"', () => {
		const input = makeTriggerInput();
		assert.equal(
			shouldTriggerProactiveCompact({
				...input,
				lastAssistantMessage: { role: "assistant", stopReason: "aborted" } as never,
			}),
			false,
		);
	});

	it("returns false when usage is missing", () => {
		const input = makeTriggerInput();
		assert.equal(shouldTriggerProactiveCompact({ ...input, usage: undefined }), false);
	});

	it("returns false when usage.tokens is null", () => {
		const input = makeTriggerInput();
		assert.equal(
			shouldTriggerProactiveCompact({ ...input, usage: { tokens: null, percent: 40, contextWindow: 1000 } as never }),
			false,
		);
	});

	it("returns false when compaction is already in flight", () => {
		const input = makeTriggerInput();
		assert.equal(shouldTriggerProactiveCompact({ ...input, inFlight: true }), false);
	});

	it("returns false when within cooldown period", () => {
		const input = makeTriggerInput();
		assert.equal(shouldTriggerProactiveCompact({ ...input, nowMs: 500, lastProactiveAtMs: 0 }), false);
	});

	it("returns false when maxTokens is undefined", () => {
		const input = makeTriggerInput();
		assert.equal(
			shouldTriggerProactiveCompact({
				...input,
				policy: { ...input.policy, trigger: { ...input.policy.trigger, maxTokens: undefined } },
			}),
			false,
		);
	});

	it("returns false when maxTokens is less than or equal to zero", () => {
		const input = makeTriggerInput();
		assert.equal(
			shouldTriggerProactiveCompact({
				...input,
				policy: { ...input.policy, trigger: { ...input.policy.trigger, maxTokens: 0 } },
			}),
			false,
		);
	});

	it("returns false when usage.tokens is below minTokens", () => {
		const input = makeTriggerInput();
		assert.equal(
			shouldTriggerProactiveCompact({
				...input,
				usage: { tokens: 899, percent: 40, contextWindow: 1000 } as never,
			}),
			false,
		);
	});

	it("returns false when usage.tokens is below maxTokens", () => {
		const input = makeTriggerInput();
		assert.equal(
			shouldTriggerProactiveCompact({
				...input,
				usage: { tokens: 999, percent: 40, contextWindow: 1000 } as never,
			}),
			false,
		);
	});

	it("returns false when usage.percent is at or above builtin threshold", () => {
		const input = makeTriggerInput();
		assert.equal(
			shouldTriggerProactiveCompact({
				...input,
				usage: { tokens: 1200, percent: 75, contextWindow: 1000 } as never,
			}),
			false,
		);
	});

	it("returns true when all guard conditions pass", () => {
		assert.equal(shouldTriggerProactiveCompact(makeTriggerInput()), true);
	});
});

describe("resolveEffectivePolicy", () => {
	it("returns base policy when no profile matches", () => {
		const base = makePolicy();
		base.profiles = {
			alpha: { match: "openai/gpt-4", trigger: { minTokens: 700 } },
		};
		const result = resolveEffectivePolicy({ model: { provider: "anthropic", id: "claude-3-opus" } }, base);

		assert.equal(result.profileName, undefined);
		assert.equal(result.sessionModel, "anthropic/claude-3-opus");
		assert.deepEqual(result.policy, base);
	});

	it("returns merged policy when profile matches session model", () => {
		const base = makePolicy();
		base.profiles = {
			matched: {
				match: "openai/gpt-4",
				trigger: { minTokens: 700 },
				summary: { thinkingLevel: "high" },
				summaryRetention: { mode: "percent", value: 20 },
			},
		};
		const result = resolveEffectivePolicy({ model: { provider: "openai", id: "gpt-4" } }, base);

		assert.equal(result.profileName, "matched");
		assert.equal(result.sessionModel, "openai/gpt-4");
		assert.equal(result.policy.trigger.minTokens, 700);
		assert.equal(result.policy.summary.thinkingLevel, "high");
		assert.deepEqual(result.policy.summaryRetention, { mode: "percent", value: 20 });
	});
});

describe("findMatchingProfile", () => {
	it("returns undefined when profiles are missing", () => {
		assert.equal(findMatchingProfile(undefined, "openai/gpt-4"), undefined);
	});

	it("returns the matching profile when selector matches", () => {
		const result = findMatchingProfile(
			{
				b: { match: "anthropic/claude-3-opus" },
				a: { match: "openai/gpt-4", trigger: { minTokens: 1 } },
			},
			"openai/gpt-4",
		);
		assert.deepEqual(result, {
			name: "a",
			override: { match: "openai/gpt-4", trigger: { minTokens: 1 } },
		});
	});

	it("returns undefined when there is no match", () => {
		const result = findMatchingProfile({ only: { match: "openai/gpt-4" } }, "anthropic/claude-3-opus");
		assert.equal(result, undefined);
	});
});

describe("styleStatusText", () => {
	const fakeTheme = {
		fg: (color: string, text: string) => `<fg:${color}>${text}</fg>`,
	};

	it("returns the text unchanged when statusColor is undefined", () => {
		assert.equal(styleStatusText("compact · 42%", undefined, fakeTheme), "compact · 42%");
	});

	it("wraps text with theme.fg when statusColor.kind is 'theme'", () => {
		assert.equal(
			styleStatusText("compact · 42%", { kind: "theme", token: "accent" }, fakeTheme),
			"<fg:accent>compact · 42%</fg>",
		);
	});

	it("wraps text with raw ANSI open/close when statusColor.kind is 'ansi'", () => {
		assert.equal(
			styleStatusText(
				"compact · 42%",
				{ kind: "ansi", open: "\x1b[36m", close: "\x1b[39m" },
				fakeTheme,
			),
			"\x1b[36mcompact · 42%\x1b[39m",
		);
	});

	it("does not call theme.fg for ANSI colors", () => {
		let called = false;
		const spyTheme = {
			fg: (color: string, text: string) => {
				called = true;
				return `<should-not-happen:${color}>${text}</should-not-happen>`;
			},
		};
		styleStatusText("x", { kind: "ansi", open: "\x1b[31m", close: "\x1b[39m" }, spyTheme);
		assert.equal(called, false);
	});

	it("falls back to plain text when theme.fg throws (unknown theme token)", () => {
		// Mirrors pi's real Theme.fg behavior: `throw new Error('Unknown theme color: ...')`
		const throwingTheme = {
			fg: (color: string) => {
				throw new Error(`Unknown theme color: ${color}`);
			},
		};
		assert.equal(
			styleStatusText(
				"compact · 42%",
				{ kind: "theme", token: "not-a-real-token" as unknown as never },
				throwingTheme,
			),
			"compact · 42%",
		);
	});
});
