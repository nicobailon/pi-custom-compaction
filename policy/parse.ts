import { setPatchValue } from "./merge.js";
import {
	type CompactionPolicyPatch,
	type ModelEntry,
	type ParseResult,
	type PolicyKey,
	POLICY_KEYS,
	type ProfileOverride,
	type SummaryModelOverride,
	type SummaryRetentionPolicy,
	type SummaryThinkingLevel,
} from "./types.js";

const POLICY_SECTIONS = new Set(["trigger", "ui", "summary"]);

function parsePolicyValue(key: PolicyKey, value: unknown): ParseResult<unknown> {
	switch (key) {
		case "trigger.builtinSkipMarginPercent":
			return parsePercent(value);
		case "trigger.maxTokens":
		case "trigger.minTokens":
		case "trigger.cooldownMs":
		case "trigger.builtinReserveTokens":
			return parseNonNegativeInt(value);
		case "ui.name":
			return parseUiName(value);
		case "ui.quiet":
		case "ui.showStatus":
		case "ui.minimalStatus":
			return parseBooleanLiteral(value);
		case "summary.thinkingLevel":
			return parseSummaryThinkingLevel(value);
		case "summary.preservationInstruction":
			return parseInstructionText(value);
		default:
			return { ok: false, error: `Unsupported policy key: ${key}` };
	}
}

function parsePercent(value: unknown): ParseResult<number> {
	const numeric = parseNumberLike(value);
	if (!numeric.ok) return numeric;
	if (numeric.value < 0 || numeric.value > 100) {
		return { ok: false, error: "expected percent in [0,100]" };
	}
	return numeric;
}

function parseNonNegativeInt(value: unknown): ParseResult<number> {
	if (typeof value === "number") {
		if (!Number.isInteger(value) || value < 0) {
			return { ok: false, error: "expected non-negative integer" };
		}
		return { ok: true, value };
	}
	if (typeof value === "string") {
		if (!/^\d+$/.test(value)) {
			return { ok: false, error: "expected base-10 non-negative integer" };
		}
		return { ok: true, value: Number(value) };
	}
	return { ok: false, error: "expected non-negative integer" };
}

export function parseModelSelector(value: unknown): ParseResult<string> {
	if (typeof value !== "string") {
		return { ok: false, error: "expected model selector provider/modelId" };
	}
	if (value.trim() !== value) {
		return { ok: false, error: "expected model selector provider/modelId" };
	}
	const slashIndex = value.indexOf("/");
	if (slashIndex <= 0 || slashIndex >= value.length - 1) {
		return { ok: false, error: "expected model selector provider/modelId" };
	}
	const provider = value.slice(0, slashIndex);
	const modelId = value.slice(slashIndex + 1);
	if (/\s/.test(provider) || /\s/.test(modelId)) {
		return { ok: false, error: "expected model selector provider/modelId" };
	}
	return { ok: true, value };
}

function parseModelEntry(value: unknown): ParseResult<ModelEntry> {
	if (typeof value === "string") {
		const parsed = parseModelSelector(value);
		if (!parsed.ok) return parsed;
		return { ok: true, value: { model: parsed.value } };
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false, error: "expected model selector string or { model, ...overrides } object" };
	}

	const raw = value as Record<string, unknown>;
	if (!("model" in raw)) {
		return { ok: false, error: 'model entry missing required "model" field' };
	}
	const parsedModel = parseModelSelector(raw.model);
	if (!parsedModel.ok) return { ok: false, error: `model entry: ${parsedModel.error}` };

	const entry: ModelEntry = { model: parsedModel.value };
	const knownKeys = new Set(["model", "thinkingLevel", "preservationInstruction"]);
	for (const key of Object.keys(raw)) {
		if (!knownKeys.has(key)) {
			return { ok: false, error: `model entry: unknown key "${key}"` };
		}
	}

	if ("thinkingLevel" in raw && raw.thinkingLevel !== undefined) {
		const parsed = parseSummaryThinkingLevel(raw.thinkingLevel);
		if (!parsed.ok) return { ok: false, error: `model entry thinkingLevel: ${parsed.error}` };
		entry.thinkingLevel = parsed.value;
	}
	if ("preservationInstruction" in raw && raw.preservationInstruction !== undefined) {
		const parsed = parseInstructionText(raw.preservationInstruction);
		if (!parsed.ok) return { ok: false, error: `model entry preservationInstruction: ${parsed.error}` };
		entry.preservationInstruction = parsed.value;
	}

	return { ok: true, value: entry };
}

function parseModelSelectorList(value: unknown): ParseResult<ModelEntry[]> {
	if (!Array.isArray(value)) {
		return { ok: false, error: "expected array of model entries" };
	}
	if (value.length === 0) {
		return { ok: false, error: "models array must not be empty" };
	}
	const entries: ModelEntry[] = [];
	for (const item of value) {
		const parsed = parseModelEntry(item);
		if (!parsed.ok) return parsed;
		entries.push(parsed.value);
	}
	return { ok: true, value: entries };
}

function parseSummaryThinkingLevel(value: unknown): ParseResult<SummaryThinkingLevel> {
	if (value === "off" || value === "low" || value === "medium" || value === "high") {
		return { ok: true, value };
	}
	return { ok: false, error: "expected one of: off, low, medium, high" };
}

function parseInstructionText(value: unknown): ParseResult<string> {
	if (typeof value !== "string") {
		return { ok: false, error: "expected instruction string" };
	}
	if (value.trim() !== value) {
		return { ok: false, error: "expected instruction string without surrounding whitespace" };
	}
	return { ok: true, value };
}

function parseUiName(value: unknown): ParseResult<string> {
	const parsed = parseInstructionText(value);
	if (!parsed.ok) return parsed;
	if (parsed.value.length === 0) {
		return { ok: false, error: "expected non-empty status name" };
	}
	return parsed;
}

function parseSummaryRetention(value: unknown): ParseResult<SummaryRetentionPolicy> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false, error: "expected object" };
	}

	const raw = value as Record<string, unknown>;
	const mode = raw.mode;
	if (mode !== "tokens" && mode !== "percent") {
		return { ok: false, error: "mode must be \"tokens\" or \"percent\"" };
	}
	if (!("value" in raw)) {
		return { ok: false, error: 'missing required "value" field' };
	}

	for (const key of Object.keys(raw)) {
		if (key !== "mode" && key !== "value") {
			return { ok: false, error: `unknown key: ${key}` };
		}
	}

	if (mode === "tokens") {
		const parsedValue = parseNonNegativeInt(raw.value);
		if (!parsedValue.ok) {
			return { ok: false, error: `tokens mode value: ${parsedValue.error}` };
		}
		return { ok: true, value: { mode, value: parsedValue.value } };
	}

	const parsedValue = parsePercent(raw.value);
	if (!parsedValue.ok) {
		return { ok: false, error: `percent mode value: ${parsedValue.error}` };
	}
	return { ok: true, value: { mode, value: parsedValue.value } };
}

function parseSummaryModelOverride(value: unknown): ParseResult<SummaryModelOverride> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false, error: "expected object" };
	}

	const override: SummaryModelOverride = {};
	for (const [field, fieldValue] of Object.entries(value)) {
		switch (field) {
			case "thinkingLevel": {
				const parsed = parseSummaryThinkingLevel(fieldValue);
				if (!parsed.ok) return { ok: false, error: `Invalid thinkingLevel: ${parsed.error}` };
				override.thinkingLevel = parsed.value;
				break;
			}
			case "preservationInstruction": {
				const parsed = parseInstructionText(fieldValue);
				if (!parsed.ok) return { ok: false, error: `Invalid preservationInstruction: ${parsed.error}` };
				override.preservationInstruction = parsed.value;
				break;
			}
			default:
				return { ok: false, error: `Unknown key: ${field}` };
		}
	}

	return { ok: true, value: override };
}

function parseProfileOverride(name: string, value: unknown): ParseResult<ProfileOverride> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false, error: `profiles.${name}: expected object` };
	}

	const raw = value as Record<string, unknown>;
	if (!("match" in raw)) {
		return { ok: false, error: `profiles.${name}: missing required "match" field` };
	}
	const parsedMatch = parseModelSelector(raw.match);
	if (!parsedMatch.ok) {
		return { ok: false, error: `profiles.${name}.match: ${parsedMatch.error}` };
	}

	const profile: ProfileOverride = { match: parsedMatch.value };

	if ("trigger" in raw && raw.trigger !== undefined) {
		if (typeof raw.trigger !== "object" || raw.trigger === null || Array.isArray(raw.trigger)) {
			return { ok: false, error: `profiles.${name}.trigger: expected object` };
		}
		const triggerOverride: Partial<Record<string, unknown>> = {};
		for (const [field, fieldValue] of Object.entries(raw.trigger)) {
			const fullKey = `trigger.${field}`;
			if (!POLICY_KEYS.includes(fullKey as PolicyKey)) {
				return { ok: false, error: `profiles.${name}: unknown trigger key: ${field}` };
			}
			const parsed = parsePolicyValue(fullKey as PolicyKey, fieldValue);
			if (!parsed.ok) {
				return { ok: false, error: `profiles.${name}.trigger.${field}: ${parsed.error}` };
			}
			triggerOverride[field] = parsed.value;
		}
		profile.trigger = triggerOverride as ProfileOverride["trigger"];
	}

	if ("models" in raw && raw.models !== undefined) {
		const parsedModels = parseModelSelectorList(raw.models);
		if (!parsedModels.ok) {
			return { ok: false, error: `profiles.${name}.models: ${parsedModels.error}` };
		}
		profile.models = parsedModels.value;
	}

	if ("summary" in raw && raw.summary !== undefined) {
		const parsedSummary = parseSummaryModelOverride(raw.summary);
		if (!parsedSummary.ok) {
			return { ok: false, error: `profiles.${name}.summary: ${parsedSummary.error}` };
		}
		profile.summary = parsedSummary.value;
	}

	if ("summaryRetention" in raw && raw.summaryRetention !== undefined) {
		const parsedSummaryRetention = parseSummaryRetention(raw.summaryRetention);
		if (!parsedSummaryRetention.ok) {
			return { ok: false, error: `profiles.${name}.summaryRetention: ${parsedSummaryRetention.error}` };
		}
		profile.summaryRetention = parsedSummaryRetention.value;
	}

	if ("template" in raw && raw.template !== undefined) {
		if (typeof raw.template !== "string" || !raw.template.trim() || raw.template.trim() !== raw.template) {
			return { ok: false, error: `profiles.${name}.template: expected non-empty path string without surrounding whitespace` };
		}
		profile.template = raw.template;
	}

	if ("updateTemplate" in raw && raw.updateTemplate !== undefined) {
		if (typeof raw.updateTemplate !== "string" || !raw.updateTemplate.trim() || raw.updateTemplate.trim() !== raw.updateTemplate) {
			return { ok: false, error: `profiles.${name}.updateTemplate: expected non-empty path string without surrounding whitespace` };
		}
		profile.updateTemplate = raw.updateTemplate;
	}

	const knownKeys = new Set(["match", "trigger", "models", "summary", "summaryRetention", "template", "updateTemplate"]);
	for (const key of Object.keys(raw)) {
		if (!knownKeys.has(key)) {
			return { ok: false, error: `profiles.${name}: unknown key: ${key}` };
		}
	}

	return { ok: true, value: profile };
}

function parseProfiles(value: unknown): ParseResult<Record<string, ProfileOverride>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { ok: false, error: "profiles: expected object" };
	}

	const profiles: Record<string, ProfileOverride> = {};
	for (const [name, profileValue] of Object.entries(value)) {
		const parsed = parseProfileOverride(name, profileValue);
		if (!parsed.ok) return parsed;
		profiles[name] = parsed.value;
	}
	return { ok: true, value: profiles };
}

function parseBooleanLiteral(value: unknown): ParseResult<boolean> {
	if (value === true || value === "true") return { ok: true, value: true };
	if (value === false || value === "false") return { ok: true, value: false };
	return { ok: false, error: "expected literal true or false" };
}

function parseNumberLike(value: unknown): ParseResult<number> {
	if (typeof value === "number" && Number.isFinite(value)) {
		return { ok: true, value };
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) {
			return { ok: false, error: "expected number" };
		}
		const parsed = Number(trimmed);
		if (!Number.isFinite(parsed)) {
			return { ok: false, error: "expected number" };
		}
		return { ok: true, value: parsed };
	}
	return { ok: false, error: "expected number" };
}

export function parsePolicyPatch(input: unknown): ParseResult<CompactionPolicyPatch> {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return { ok: false, error: "Policy patch must be an object" };
	}

	const patch: CompactionPolicyPatch = {};
	for (const [sectionKey, sectionValue] of Object.entries(input)) {
		if (sectionKey === "enabled") {
			const parsedEnabled = parseBooleanLiteral(sectionValue);
			if (!parsedEnabled.ok) {
				return { ok: false, error: `Invalid enabled: ${parsedEnabled.error}` };
			}
			patch.enabled = parsedEnabled.value;
			continue;
		}
		if (sectionKey === "models") {
			const parsedModels = parseModelSelectorList(sectionValue);
			if (!parsedModels.ok) {
				return { ok: false, error: `Invalid models: ${parsedModels.error}` };
			}
			patch.models = parsedModels.value;
			continue;
		}
		if (sectionKey === "profiles") {
			const parsedProfiles = parseProfiles(sectionValue);
			if (!parsedProfiles.ok) return parsedProfiles;
			patch.profiles = parsedProfiles.value;
			continue;
		}
		if (sectionKey === "summaryRetention") {
			const parsedSummaryRetention = parseSummaryRetention(sectionValue);
			if (!parsedSummaryRetention.ok) {
				return { ok: false, error: `Invalid summaryRetention: ${parsedSummaryRetention.error}` };
			}
			patch.summaryRetention = parsedSummaryRetention.value;
			continue;
		}
		if (!POLICY_SECTIONS.has(sectionKey)) {
			return { ok: false, error: `Unknown policy key: ${sectionKey}` };
		}
		if (typeof sectionValue !== "object" || sectionValue === null || Array.isArray(sectionValue)) {
			return { ok: false, error: `Policy section must be an object: ${sectionKey}` };
		}
		for (const [field, value] of Object.entries(sectionValue)) {
			const fullKey = `${sectionKey}.${field}`;
			if (!POLICY_KEYS.includes(fullKey as PolicyKey)) {
				return { ok: false, error: `Unknown policy key: ${fullKey}` };
			}
			const parsedValue = parsePolicyValue(fullKey as PolicyKey, value);
			if (!parsedValue.ok) {
				return { ok: false, error: `Invalid ${fullKey}: ${parsedValue.error}` };
			}
			setPatchValue(patch, fullKey as PolicyKey, parsedValue.value);
		}
	}

	return { ok: true, value: patch };
}
