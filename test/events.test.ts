import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI, SessionBeforeCompactEvent } from "@mariozechner/pi-coding-agent";
import { registerEvents } from "../events/register-events.ts";
import { DEFAULT_POLICY, type CompactionPolicy } from "../policy/types.ts";

function createPolicy(): CompactionPolicy {
	return {
		...DEFAULT_POLICY,
		enabled: true,
		trigger: { ...DEFAULT_POLICY.trigger },
		models: [{ model: "openai/gpt-test" }],
		ui: { ...DEFAULT_POLICY.ui },
		summary: { ...DEFAULT_POLICY.summary },
		summaryRetention: { mode: "percent", value: 20 },
	};
}

function createEvent(): SessionBeforeCompactEvent {
	const signal = new AbortController().signal;
	return {
		type: "session_before_compact",
		signal,
		customInstructions: undefined,
		branchEntries: [
			{
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: "2026-04-04T00:00:00.000Z",
				message: { role: "user", content: "hello", timestamp: Date.now() },
			},
		],
		preparation: {
			firstKeptEntryId: "m1",
			messagesToSummarize: [],
			turnPrefixMessages: [],
			isSplitTurn: false,
			tokensBefore: 123,
			previousSummary: undefined,
			fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
			settings: {
				enabled: true,
				reserveTokens: 140,
				keepRecentTokens: 20000,
			},
		},
	};
}

describe("registerEvents session_before_compact retention fallback", () => {
	it("falls back to Pi default compaction and emits warning every time", async () => {
		const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
		const pi = {
			on: (name: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
				handlers.set(name, handler);
			},
		} as unknown as ExtensionAPI;

		const notifications: string[] = [];
		let clearInFlightCalls = 0;
		let updateStatusCalls = 0;
		const runtime = {
			clearInFlight: () => {
				clearInFlightCalls += 1;
			},
			setInFlight: () => {},
			isInFlight: () => false,
			getLastProactiveAtMs: () => undefined,
			setLastProactiveAtMs: () => {},
			setActiveProfileName: () => {},
			markPostCompact: () => {},
			notify: (_ctx: unknown, _policy: unknown, _level: unknown, message: string) => {
				notifications.push(message);
				return true;
			},
			updateStatus: () => {
				updateStatusCalls += 1;
			},
			clearSessionScopedState: () => {},
			loadEffectivePolicy: () => createPolicy(),
			triggerCompaction: () => true,
		};

		registerEvents(pi, runtime as never);
		const beforeCompact = handlers.get("session_before_compact");
		if (!beforeCompact) throw new Error("session_before_compact handler not registered");

		const ctx = {
			cwd: process.cwd(),
			model: { provider: "openai", id: "gpt-test", contextWindow: 200 },
			modelRegistry: {
				find: () => ({ provider: "openai", id: "gpt-test", contextWindow: 150 }),
				getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
			},
			ui: {
				notify: () => {},
				setStatus: () => {},
				setWidget: () => {},
			},
			getContextUsage: () => undefined,
			compact: () => {},
		};

		const event = createEvent();
		const first = await beforeCompact(event, ctx);
		const second = await beforeCompact(event, ctx);

		assert.equal(first, undefined);
		assert.equal(second, undefined);
		assert.equal(clearInFlightCalls, 2);
		assert.equal(notifications.length, 2);
		assert.equal(updateStatusCalls, 4);
		assert.match(notifications[0] ?? "", /exceeds available budget/);
	});
});
