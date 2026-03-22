import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { readProjectPolicyPatch } from "../policy/config.ts";
import { CONFIG_FILE } from "../policy/types.ts";

describe("readProjectPolicyPatch", () => {
	let cwd = "";

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "pi-custom-compaction-config-"));
	});

	afterEach(() => {
		if (cwd) {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("returns empty patch when no config files exist", (t) => {
		const globalPath = join(homedir(), ".pi", "agent", "compaction-policy.json");
		if (existsSync(globalPath)) {
			t.skip(`global config exists at ${globalPath}, cannot assert empty fallback`);
			return;
		}

		assert.deepEqual(readProjectPolicyPatch(cwd), { ok: true, value: {} });
	});

	it("reads project-level .pi/compaction-policy.json", () => {
		const configPath = join(cwd, CONFIG_FILE);
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(configPath, JSON.stringify({ enabled: true, trigger: { minTokens: 12345 } }), "utf8");

		assert.deepEqual(readProjectPolicyPatch(cwd), {
			ok: true,
			value: { enabled: true, trigger: { minTokens: 12345 } },
		});
	});

	it("returns parse error for invalid JSON", () => {
		const configPath = join(cwd, CONFIG_FILE);
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(configPath, "{ invalid-json", "utf8");

		const result = readProjectPolicyPatch(cwd);
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.match(result.error, new RegExp(`^Invalid ${configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: `));
	});

	it("returns parse error for invalid schema", () => {
		const configPath = join(cwd, CONFIG_FILE);
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(configPath, JSON.stringify({ enabled: 42 }), "utf8");

		assert.deepEqual(readProjectPolicyPatch(cwd), {
			ok: false,
			error: `Invalid ${configPath}: Invalid enabled: expected literal true or false`,
		});
	});


});
