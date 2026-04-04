import type {
	CompactionPolicy,
	CompactionPolicyPatch,
	PolicyKey,
	ProfileOverride,
	SummaryThinkingLevel,
} from "./types.js";

export function setPatchValue(patch: CompactionPolicyPatch, key: PolicyKey, value: unknown): void {
	switch (key) {
		case "trigger.maxTokens":
			patch.trigger = { ...patch.trigger, maxTokens: value as number };
			return;
		case "trigger.minTokens":
			patch.trigger = { ...patch.trigger, minTokens: value as number };
			return;
		case "trigger.cooldownMs":
			patch.trigger = { ...patch.trigger, cooldownMs: value as number };
			return;
		case "trigger.builtinReserveTokens":
			patch.trigger = { ...patch.trigger, builtinReserveTokens: value as number };
			return;
		case "trigger.builtinSkipMarginPercent":
			patch.trigger = { ...patch.trigger, builtinSkipMarginPercent: value as number };
			return;
		case "ui.name":
			patch.ui = { ...patch.ui, name: value as string };
			return;
		case "ui.quiet":
			patch.ui = { ...patch.ui, quiet: value as boolean };
			return;
		case "ui.showStatus":
			patch.ui = { ...patch.ui, showStatus: value as boolean };
			return;
		case "ui.minimalStatus":
			patch.ui = { ...patch.ui, minimalStatus: value as boolean };
			return;
		case "summary.thinkingLevel":
			patch.summary = { ...patch.summary, thinkingLevel: value as SummaryThinkingLevel };
			return;
		case "summary.preservationInstruction":
			patch.summary = { ...patch.summary, preservationInstruction: value as string };
			return;
		default:
			return;
	}
}

export function mergePolicy(base: CompactionPolicy, patch: CompactionPolicyPatch): CompactionPolicy {
	return {
		enabled: patch.enabled ?? base.enabled,
		trigger: { ...base.trigger, ...(patch.trigger ?? {}) },
		models: patch.models ?? base.models,
		ui: { ...base.ui, ...(patch.ui ?? {}) },
		summary: { ...base.summary, ...(patch.summary ?? {}) },
		summaryRetention: patch.summaryRetention ?? base.summaryRetention,
		profiles: patch.profiles !== undefined ? patch.profiles : base.profiles,
	};
}

export function applyProfileOverrides(policy: CompactionPolicy, profile: ProfileOverride): CompactionPolicy {
	return {
		...policy,
		trigger: { ...policy.trigger, ...(profile.trigger ?? {}) },
		models: profile.models ?? policy.models,
		summary: { ...policy.summary, ...(profile.summary ?? {}) },
		summaryRetention: profile.summaryRetention ?? policy.summaryRetention,
	};
}
