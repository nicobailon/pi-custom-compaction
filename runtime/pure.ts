import { applyProfileOverrides } from "../policy/merge.js";
import type { CompactionPolicy, ProfileOverride, ProactiveTriggerInput, StatusColor } from "../policy/types.js";

/**
 * Minimal slice of pi's `Theme` needed to render status text. Taking just the
 * `fg` method keeps this helper pure and easy to stub in unit tests.
 */
export interface StatusStyleTheme {
	fg(color: string, text: string): string;
}

/**
 * Wrap a plain status string with ANSI colouring according to `statusColor`.
 *
 * Called from `updateStatus` for every `setStatus(...)` write so the whole
 * status line (prefix + percentage + inline states like `compacting…`) shares
 * one colour. When `statusColor` is undefined the text is returned as-is so
 * the footer renders in the terminal's default foreground.
 *
 * If `statusColor.kind === "theme"` and the token isn't recognised by the
 * current theme, `theme.fg` throws; this helper swallows the throw and
 * returns the plain text, so an unknown token degrades gracefully instead of
 * crashing the footer. The runtime emits a one-time warning so the user can
 * see *why* the color didn't take effect.
 */
export function styleStatusText(
	text: string,
	statusColor: StatusColor | undefined,
	theme: StatusStyleTheme,
): string {
	if (!statusColor) return text;
	if (statusColor.kind === "theme") {
		try {
			return theme.fg(statusColor.token, text);
		} catch {
			return text;
		}
	}
	return `${statusColor.open}${text}${statusColor.close}`;
}

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

