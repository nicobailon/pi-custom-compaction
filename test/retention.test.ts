import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionBeforeCompactEvent, SessionEntry } from "@mariozechner/pi-coding-agent";
import { formatSummaryRetention, rebuildPreparationWithKeepRecentTokens, resolveSummaryRetention } from "../runtime/retention.ts";

function createPreparation(): SessionBeforeCompactEvent["preparation"] {
	return {
		firstKeptEntryId: "e1",
		messagesToSummarize: [],
		turnPrefixMessages: [],
		isSplitTurn: false,
		tokensBefore: 222,
		previousSummary: undefined,
		fileOps: {
			read: new Set<string>(),
			written: new Set<string>(),
			edited: new Set<string>(),
		},
		settings: {
			enabled: true,
			reserveTokens: 100,
			keepRecentTokens: 20_000,
		},
	};
}

function createBranchEntries(): SessionEntry[] {
	return [
		{
			type: "message",
			id: "e1",
			parentId: null,
			timestamp: "2026-04-04T00:00:00.000Z",
			message: {
				role: "user",
				content: "A".repeat(120),
				timestamp: Date.now(),
			},
		},
		{
			type: "message",
			id: "e2",
			parentId: "e1",
			timestamp: "2026-04-04T00:00:01.000Z",
			message: {
				role: "assistant",
				provider: "openai",
				model: "gpt-test",
				stopReason: "stop",
				content: [
					{ type: "text", text: "done" },
					{ type: "toolCall", id: "tc-1", name: "read", arguments: { path: "src/a.ts" } },
				],
				timestamp: Date.now(),
			},
		},
		{
			type: "message",
			id: "e3",
			parentId: "e2",
			timestamp: "2026-04-04T00:00:02.000Z",
			message: {
				role: "user",
				content: "B".repeat(120),
				timestamp: Date.now(),
			},
		},
		{
			type: "message",
			id: "e4",
			parentId: "e3",
			timestamp: "2026-04-04T00:00:03.000Z",
			message: {
				role: "assistant",
				provider: "openai",
				model: "gpt-test",
				stopReason: "stop",
				content: [{ type: "text", text: "result" }],
				timestamp: Date.now(),
			},
		},
	] as SessionEntry[];
}

describe("formatSummaryRetention", () => {
	it("formats percent and token modes", () => {
		assert.equal(formatSummaryRetention({ mode: "percent", value: 20 }), "keep 20%");
		assert.equal(formatSummaryRetention({ mode: "tokens", value: 30000 }), "keep 30000t");
		assert.equal(formatSummaryRetention(undefined), undefined);
	});
});

describe("resolveSummaryRetention", () => {
	it("returns empty result when summaryRetention is not configured", () => {
		assert.deepEqual(
			resolveSummaryRetention(undefined, {
				sessionContextWindow: 200000,
				summaryModelContextWindow: 200000,
				reserveTokens: 16384,
			}),
			{},
		);
	});

	it("resolves percent mode against min(session, summary) context windows", () => {
		const result = resolveSummaryRetention(
			{ mode: "percent", value: 20 },
			{ sessionContextWindow: 200000, summaryModelContextWindow: 100000, reserveTokens: 1000 },
		);
		assert.equal(result.fallbackReason, undefined);
		assert.equal(result.resolution?.keepRecentTokens, 20000);
	});

	it("returns fallback when percent mode cannot resolve context windows", () => {
		const result = resolveSummaryRetention(
			{ mode: "percent", value: 20 },
			{ sessionContextWindow: undefined, summaryModelContextWindow: 100000, reserveTokens: 1000 },
		);
		assert.match(result.fallbackReason ?? "", /needs both session and summary model context windows/);
	});

	it("returns fallback when computed keep budget exceeds available tokens", () => {
		const result = resolveSummaryRetention(
			{ mode: "tokens", value: 70000 },
			{ sessionContextWindow: 80000, summaryModelContextWindow: 90000, reserveTokens: 20000 },
		);
		assert.match(result.fallbackReason ?? "", /exceeds available budget/);
	});
});

describe("rebuildPreparationWithKeepRecentTokens", () => {
	it("rebuilds preparation with new split-turn boundaries and file ops", () => {
		const result = rebuildPreparationWithKeepRecentTokens(createBranchEntries(), createPreparation(), 1);
		assert.equal(result.fallbackReason, undefined);
		assert.equal(result.preparation?.firstKeptEntryId, "e4");
		assert.equal(result.preparation?.isSplitTurn, true);
		assert.equal(result.preparation?.messagesToSummarize.length, 2);
		assert.equal(result.preparation?.turnPrefixMessages.length, 1);
		assert.equal(result.preparation?.settings.keepRecentTokens, 1);
		assert.deepEqual([...(result.preparation?.fileOps.read ?? [])], ["src/a.ts"]);
	});
});
