import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { resolveEffectivePolicy } from "../runtime/pure.js";
import type { RuntimeServices } from "../runtime/session-state.js";
import { discoverTemplate } from "../summary/template.js";

function formatModels(policy: { models: Array<{ model: string; thinkingLevel?: string }> }): string {
	return policy.models
		.map((e) => (e.thinkingLevel ? `${e.model} (thinking: ${e.thinkingLevel})` : e.model))
		.join(" → ");
}

function formatTrigger(policy: {
	trigger: { maxTokens?: number; minTokens: number; cooldownMs: number };
}): string {
	const { maxTokens, minTokens, cooldownMs } = policy.trigger;
	const threshold = maxTokens && maxTokens > 0 ? `${maxTokens} tokens` : "inherited from pi";
	return `${threshold} | minTokens: ${minTokens} | cooldown: ${cooldownMs}ms`;
}

export function registerCommands(pi: ExtensionAPI, runtime: RuntimeServices): void {
	pi.registerCommand("compact-policy", {
		description: "Show current compaction policy",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			const basePolicy = runtime.loadEffectivePolicy(ctx);
			const { policy, profileName, sessionModel, profileTemplates } = resolveEffectivePolicy(ctx, basePolicy);
			const template = discoverTemplate(ctx.cwd, profileName, profileTemplates);
			const templatePath = template.fallbackReason
				? `${template.resolvedPath ?? "(unknown)"} (invalid: ${template.fallbackReason}; using built-in)`
				: template.resolvedPath ?? "(none — using built-in)";
			const updateTemplatePath = template.updateFallbackReason
				? `${template.updateResolvedPath ?? "(unknown)"} (invalid: ${template.updateFallbackReason}; using initial template)`
				: template.updateResolvedPath ?? "(none — using initial template)";

			const lines = [
				`enabled: ${policy.enabled}`,
				`models: ${formatModels(policy)}`,
				`trigger: ${formatTrigger(policy)}`,
				`summary: thinking=${policy.summary.thinkingLevel}`,
				`session model: ${sessionModel ?? "unknown"}`,
				`profile: ${profileName ?? "none"}`,
				`template: ${templatePath}`,
				`template update: ${updateTemplatePath}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("compact-now", {
		description: "Trigger compaction immediately",
		handler: async (args, ctx: ExtensionCommandContext) => {
			const basePolicy = runtime.loadEffectivePolicy(ctx);
			const { policy, profileName } = resolveEffectivePolicy(ctx, basePolicy);
			runtime.setActiveProfileName(profileName);

			const focus = args.trim() || undefined;
			if (!policy.enabled) {
				ctx.compact({ customInstructions: focus });
				return;
			}
			runtime.triggerCompaction(ctx, policy, "compact-now", focus);
		},
	});
}
