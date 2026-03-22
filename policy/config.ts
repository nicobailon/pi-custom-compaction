import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parsePolicyPatch } from "./parse.js";
import {
	CONFIG_FILE,
	type CompactionPolicyPatch,
	type ParseResult,
} from "./types.js";

const GLOBAL_CONFIG_PATH = join(homedir(), ".pi", "agent", "compaction-policy.json");

function readConfigFile(configPath: string): ParseResult<CompactionPolicyPatch> {
	try {
		const raw = readFileSync(configPath, "utf8");
		const json = JSON.parse(raw);
		const parsed = parsePolicyPatch(json);
		if (!parsed.ok) {
			return { ok: false, error: `Invalid ${configPath}: ${parsed.error}` };
		}
		return parsed;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: `Invalid ${configPath}: ${message}` };
	}
}

export function readProjectPolicyPatch(cwd: string): ParseResult<CompactionPolicyPatch> {
	const projectPath = join(cwd, CONFIG_FILE);
	if (existsSync(projectPath)) return readConfigFile(projectPath);
	if (existsSync(GLOBAL_CONFIG_PATH)) return readConfigFile(GLOBAL_CONFIG_PATH);
	return { ok: true, value: {} };
}

