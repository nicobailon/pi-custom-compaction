import { applyProfileOverrides } from "../policy/merge.js";
import type { CompactionPolicy, ProfileOverride, ProactiveTriggerInput } from "../policy/types.js";

export function resolveEffectivePolicy(
	ctx: { model?: { provider: string; id: string } },
	basePolicy: CompactionPolicy,
): {
	policy: CompactionPolicy;
	profileName: string | undefined;
	sessionModel: string | undefined;
	profileTemplates?: { template?: string; updateTemplate?: string };
} {
	const sessionModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
	const profile = findMatchingProfile(basePolicy.profiles, sessionModel);
	const policy = profile ? applyProfileOverrides(basePolicy, profile.override) : basePolicy;
	const profileTemplates = profile?.override.template || profile?.override.updateTemplate
		? { template: profile.override.template, updateTemplate: profile.override.updateTemplate }
		: undefined;
	return { policy, profileName: profile?.name, sessionModel, profileTemplates };
}

export function shouldTriggerProactiveCompact(input: ProactiveTriggerInput): boolean {
	const { lastAssistantMessage, usage, inFlight, nowMs, lastProactiveAtMs, policy } = input;
	if (!lastAssistantMessage) return false;
	if (lastAssistantMessage.stopReason === "error" || lastAssistantMessage.stopReason === "aborted") return false;
	if (!usage) return false;
	if (usage.tokens === null || usage.percent === null) return false;
	if (inFlight) return false;
	if (typeof lastProactiveAtMs === "number" && nowMs - lastProactiveAtMs < policy.trigger.cooldownMs) return false;
	const { maxTokens } = policy.trigger;
	if (maxTokens === undefined || maxTokens <= 0) return false;
	if (usage.tokens < policy.trigger.minTokens) return false;
	if (usage.tokens < maxTokens) return false;

	const builtinPercentRaw =
		usage.contextWindow > 0 ? 100 * (1 - policy.trigger.builtinReserveTokens / usage.contextWindow) : 100;
	const builtinPercent = Math.max(0, Math.min(100, builtinPercentRaw));
	if (usage.percent >= builtinPercent - policy.trigger.builtinSkipMarginPercent) return false;

	return true;
}

export function findMatchingProfile(
	profiles: Record<string, ProfileOverride> | undefined,
	modelSelector: string | undefined,
): { name: string; override: ProfileOverride } | undefined {
	if (!profiles || !modelSelector) return undefined;
	for (const name of Object.keys(profiles).sort()) {
		const profile = profiles[name];
		if (profile && profile.match === modelSelector) {
			return { name, override: profile };
		}
	}
	return undefined;
}

