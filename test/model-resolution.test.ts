import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getLastAssistantMessage } from "../runtime/model-resolution.ts";

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
