import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type {
	CompactionPolicy,
	ModelEntry,
	SummaryPolicy,
	TemplateResolution,
} from "../policy/types.js";

const TEMPLATE_DIR = "compaction-templates";
const TEMPLATE_FILE = "compaction-template.md";
const UPDATE_TEMPLATE_FILE = "compaction-template-update.md";
const GLOBAL_BASE = join(homedir(), ".pi", "agent");

type TryReadResult = { content: string; path: string } | { error: string; path: string } | undefined;

function tryRead(path: string): TryReadResult {
	if (!existsSync(path)) return undefined;
	try {
		const content = readFileSync(path, "utf8").trim();
		if (!content) return { error: "template file is empty", path };
		return { content, path };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error), path };
	}
}

function tryReadExplicit(rawPath: string): TryReadResult {
	const resolved = rawPath.startsWith("~/") ? join(homedir(), rawPath.slice(2)) : rawPath;
	return tryRead(resolved) ?? { error: "file not found", path: resolved };
}

function findTemplate(
	cwd: string,
	profileName: string | undefined,
	defaultFile: string,
	profileSuffix: string,
): ReturnType<typeof tryRead> {
	if (profileName) {
		const profileFile = `${profileName}${profileSuffix}.md`;
		const projectProfile = tryRead(resolve(cwd, ".pi", TEMPLATE_DIR, profileFile));
		if (projectProfile) return projectProfile;
		const globalProfile = tryRead(join(GLOBAL_BASE, TEMPLATE_DIR, profileFile));
		if (globalProfile) return globalProfile;
	}
	const projectDefault = tryRead(resolve(cwd, ".pi", defaultFile));
	if (projectDefault) return projectDefault;
	return tryRead(join(GLOBAL_BASE, defaultFile));
}

export function discoverTemplate(
	cwd: string,
	profileName: string | undefined,
	explicitPaths?: { template?: string; updateTemplate?: string },
): TemplateResolution {
	const initial = explicitPaths?.template
		? tryReadExplicit(explicitPaths.template)
		: findTemplate(cwd, profileName, TEMPLATE_FILE, "");
	if (!initial) return {};
	if ("error" in initial) return { resolvedPath: initial.path, fallbackReason: initial.error };

	const result: TemplateResolution = { template: initial.content, resolvedPath: initial.path };

	const update = explicitPaths?.updateTemplate
		? tryReadExplicit(explicitPaths.updateTemplate)
		: findTemplate(cwd, profileName, UPDATE_TEMPLATE_FILE, "-update");
	if (update) {
		if ("content" in update) {
			result.updateTemplate = update.content;
			result.updateResolvedPath = update.path;
		} else {
			result.updateResolvedPath = update.path;
			result.updateFallbackReason = update.error;
		}
	}

	return result;
}

export function resolveSummarySettings(policy: CompactionPolicy, entry: ModelEntry): SummaryPolicy {
	return {
		thinkingLevel: entry.thinkingLevel ?? policy.summary.thinkingLevel,
		preservationInstruction: entry.preservationInstruction ?? policy.summary.preservationInstruction,
	};
}

export function buildSummaryPrompt(
	template: string,
	updateTemplate: string | undefined,
	previousSummary: string | undefined,
	customInstructions: string | undefined,
	preservationInstruction: string,
): string {
	const promptParts: string[] = [];
	if (previousSummary) {
		promptParts.push(
			"The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.",
			"",
			"Update the existing structured summary with new information. RULES:",
			"- PRESERVE all existing information from the previous summary",
			"- ADD new progress, decisions, and context from the new messages",
			"- Move completed items to Done, update Next Steps based on progress",
			"- If something is no longer relevant, you may remove it",
		);
	} else {
		promptParts.push(
			"The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.",
		);
	}

	const activeTemplate = previousSummary && updateTemplate ? updateTemplate : template;
	promptParts.push("", "Use this EXACT format:", "", activeTemplate, "", "Keep each section concise.");
	if (preservationInstruction) {
		promptParts.push(preservationInstruction);
	}
	if (customInstructions) {
		promptParts.push("", `Additional focus: ${customInstructions}`);
	}

	return promptParts.join("\n");
}

