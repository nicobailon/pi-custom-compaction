import type { Api, Model } from "@mariozechner/pi-ai";
import { compact, type ExtensionAPI, type ExtensionContext, type SessionBeforeCompactEvent } from "@mariozechner/pi-coding-agent";
import type { SummaryPolicy } from "../policy/types.js";
import {
	computeFileLists,
	formatFileOperations,
	generateTemplateSummary,
	generateTurnPrefixSummary,
	getReserveTokens,
} from "../summary/generate.js";
import { buildSummaryPrompt, discoverTemplate, resolveSummarySettings } from "../summary/template.js";
import { getLastAssistantMessage, resolveSummaryModel } from "../runtime/model-resolution.js";
import { resolveEffectivePolicy, shouldTriggerProactiveCompact } from "../runtime/pure.js";
import type { RuntimeServices } from "../runtime/session-state.js";

async function generateCustomCompaction(
	event: SessionBeforeCompactEvent,
	template: string,
	updateTemplate: string | undefined,
	summarySettings: SummaryPolicy,
	model: Model<Api>,
	apiKey: string,
) {
	const reserveTokens = getReserveTokens(event);
	const summaryPrompt = buildSummaryPrompt(
		template,
		updateTemplate,
		event.preparation.previousSummary,
		event.customInstructions,
		summarySettings.preservationInstruction,
	);
	const historySummary =
		event.preparation.messagesToSummarize.length > 0
			? await generateTemplateSummary(
					event.preparation.messagesToSummarize,
					model,
					apiKey,
					summaryPrompt,
					reserveTokens,
					event.signal,
					summarySettings.thinkingLevel,
					event.preparation.previousSummary,
			  )
			: event.preparation.previousSummary ?? "No prior history.";
	if (!historySummary.trim()) {
		throw new Error("Custom template summarization returned empty summary");
	}

	const turnPrefixSummary =
		event.preparation.isSplitTurn && event.preparation.turnPrefixMessages.length > 0
			? await generateTurnPrefixSummary(
					event.preparation.turnPrefixMessages,
					model,
					apiKey,
					reserveTokens,
					event.signal,
					summarySettings.thinkingLevel,
			  )
			: undefined;
	if (turnPrefixSummary !== undefined && !turnPrefixSummary.trim()) {
		throw new Error("Turn prefix summarization returned empty summary");
	}

	const mergedSummary = turnPrefixSummary
		? `${historySummary}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixSummary}`
		: historySummary;
	const details = computeFileLists(event.preparation.fileOps);
	const summary = `${mergedSummary}${formatFileOperations(details)}`;
	return {
		summary,
		firstKeptEntryId: event.preparation.firstKeptEntryId,
		tokensBefore: event.preparation.tokensBefore,
		details,
	};
}

function initializeSessionStatus(ctx: ExtensionContext, runtime: RuntimeServices): void {
	const basePolicy = runtime.loadEffectivePolicy(ctx, { warnOnInvalidConfig: false });
	if (!basePolicy.enabled) return;
	const { policy, profileName } = resolveEffectivePolicy(ctx, basePolicy);
	runtime.setActiveProfileName(profileName);
	runtime.updateStatus(ctx, policy);
}

export function registerEvents(pi: ExtensionAPI, runtime: RuntimeServices): void {
	pi.on("agent_end", async (event, ctx) => {
		const basePolicy = runtime.loadEffectivePolicy(ctx, { warnOnInvalidConfig: false });
		if (!basePolicy.enabled) {
			runtime.clearInFlight();
			runtime.setActiveProfileName(undefined);
			runtime.updateStatus(ctx, basePolicy);
			return;
		}

		const { policy, profileName } = resolveEffectivePolicy(ctx, basePolicy);
		runtime.setActiveProfileName(profileName);

		const shouldTrigger = shouldTriggerProactiveCompact({
			lastAssistantMessage: getLastAssistantMessage(event.messages),
			usage: ctx.getContextUsage(),
			inFlight: runtime.isInFlight(),
			nowMs: Date.now(),
			lastProactiveAtMs: runtime.getLastProactiveAtMs(),
			policy,
		});
		if (!shouldTrigger) {
			runtime.updateStatus(ctx, policy);
			return;
		}

		const triggered = runtime.triggerCompaction(ctx, policy, "proactive");
		if (triggered) {
			runtime.setLastProactiveAtMs(Date.now());
		}
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const basePolicy = runtime.loadEffectivePolicy(ctx, { warnOnInvalidConfig: false });
		if (!basePolicy.enabled) {
			runtime.clearInFlight();
			runtime.setActiveProfileName(undefined);
			runtime.updateStatus(ctx, basePolicy);
			return undefined;
		}

		const { policy, profileName, profileTemplates } = resolveEffectivePolicy(ctx, basePolicy);
		runtime.setActiveProfileName(profileName);
		runtime.setInFlight("session_before_compact");
		runtime.updateStatus(ctx, policy);

		const resolved = await resolveSummaryModel(ctx, policy, runtime.notify);
		if (!resolved) {
			runtime.clearInFlight();
			return undefined;
		}

		const summarySettings = resolveSummarySettings(policy, resolved.entry);
		const templateResolution = discoverTemplate(ctx.cwd, profileName, profileTemplates);
		if (templateResolution.fallbackReason) {
			runtime.notify(
				ctx,
				policy,
				"warning",
				`Could not load summary template ${templateResolution.resolvedPath} (${templateResolution.fallbackReason}). Falling back to built-in compaction format.`,
				{ dedupeKey: `template-fallback:${templateResolution.resolvedPath}:${templateResolution.fallbackReason}` },
			);
		}
		if (templateResolution.updateFallbackReason) {
			runtime.notify(
				ctx,
				policy,
				"warning",
				`Could not load update summary template ${templateResolution.updateResolvedPath} (${templateResolution.updateFallbackReason}). Falling back to initial summary template.`,
				{
					dedupeKey: `template-update-fallback:${templateResolution.updateResolvedPath}:${templateResolution.updateFallbackReason}`,
				},
			);
		}

		try {
			const result = templateResolution.template
				? await generateCustomCompaction(
						event,
						templateResolution.template,
						templateResolution.updateTemplate,
						summarySettings,
						resolved.model,
						resolved.apiKey,
				  )
				: await compact(
						event.preparation,
						resolved.model,
						resolved.apiKey,
						event.customInstructions,
						event.signal,
				  );

			return {
				compaction: {
					summary: result.summary,
					tokensBefore: result.tokensBefore,
					details: result.details,
					firstKeptEntryId: result.firstKeptEntryId,
				},
			};
		} catch (error) {
			runtime.clearInFlight();
			if (event.signal.aborted) return undefined;
			const message = error instanceof Error ? error.message : String(error);
			runtime.notify(ctx, policy, "error", `Compaction policy summary failed: ${message}`, {
				critical: true,
			});
			return undefined;
		}
	});

	pi.on("session_compact", async (_event, ctx) => {
		runtime.clearInFlight();
		runtime.markPostCompact();
		const basePolicy = runtime.loadEffectivePolicy(ctx, { warnOnInvalidConfig: false });
		const { policy, profileName } = resolveEffectivePolicy(ctx, basePolicy);
		runtime.setActiveProfileName(profileName);
		runtime.updateStatus(ctx, policy);
	});

	pi.on("session_start", async (_event, ctx) => {
		runtime.clearSessionScopedState(ctx);
		initializeSessionStatus(ctx, runtime);
	});

	pi.on("session_switch", async (_event, ctx) => {
		runtime.clearSessionScopedState(ctx);
		initializeSessionStatus(ctx, runtime);
	});

	pi.on("session_fork", async (_event, ctx) => {
		runtime.clearSessionScopedState(ctx);
		initializeSessionStatus(ctx, runtime);
	});

	pi.on("session_tree", async (_event, ctx) => {
		runtime.clearSessionScopedState(ctx);
		initializeSessionStatus(ctx, runtime);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		runtime.clearSessionScopedState(ctx);
	});
}
