import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_POLICY, type CompactionPolicy } from "../policy/types.ts";
import { getLastAssistantMessage, resolveSummaryModel } from "../runtime/model-resolution.ts";

describe("getLastAssistantMessage", () => {
	it("returns the last assistant message in the array", () => {
		const messages = [
			{ role: "assistant", id: 1 },
			{ role: "user", id: 2 },
			{ role: "assistant", id: 3 },
		] as never[];

		assert.deepEqual(getLastAssistantMessage(messages), { role: "assistant", id: 3 });
	});

	it("returns undefined for an empty message array", () => {
		assert.equal(getLastAssistantMessage([]), undefined);
	});

	it("skips non-assistant messages", () => {
		const messages = [
			{ role: "user", id: 1 },
			{ role: "tool", id: 2 },
		] as never[];

		assert.equal(getLastAssistantMessage(messages), undefined);
	});
});

describe("resolveSummaryModel", () => {
	it("reports invalid selectors instead of silently skipping", async () => {
		const notifications: string[] = [];
		const policy: CompactionPolicy = {
			...DEFAULT_POLICY,
			enabled: true,
			trigger: { ...DEFAULT_POLICY.trigger },
			models: [{ model: "invalid-selector" }],
			ui: { ...DEFAULT_POLICY.ui },
			summary: { ...DEFAULT_POLICY.summary },
		};
		const ctx = {
			modelRegistry: {
				find: () => undefined,
				getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }),
			},
		} as never;

		const result = await resolveSummaryModel(
			ctx,
			policy,
			(_ctx, _policy, _level, message) => {
				notifications.push(message);
				return true;
			},
		);

		assert.equal(result, undefined);
		assert.match(notifications[0] ?? "", /invalid-selector: expected model selector provider\/modelId/);
	});

	it("handles thrown model-registry auth errors as typed resolution failures", async () => {
		const notifications: string[] = [];
		const policy: CompactionPolicy = {
			...DEFAULT_POLICY,
			enabled: true,
			trigger: { ...DEFAULT_POLICY.trigger },
			models: [{ model: "openai/gpt-test" }],
			ui: { ...DEFAULT_POLICY.ui },
			summary: { ...DEFAULT_POLICY.summary },
		};
		const ctx = {
			modelRegistry: {
				find: () => ({ provider: "openai", id: "gpt-test" }),
				getApiKeyAndHeaders: async () => {
					throw new Error("network unavailable");
				},
			},
		} as never;

		const result = await resolveSummaryModel(
			ctx,
			policy,
			(_ctx, _policy, _level, message) => {
				notifications.push(message);
				return true;
			},
		);

		assert.equal(result, undefined);
		assert.match(notifications[0] ?? "", /openai\/gpt-test: failed to resolve model auth \(network unavailable\)/);
	});
});
