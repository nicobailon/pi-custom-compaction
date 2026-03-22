import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Api, AssistantMessage, Model } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { parseModelSelector } from "../policy/parse.js";
import type { CompactionPolicy, ModelEntry, ParseResult } from "../policy/types.js";

type NotifyFn = (
	ctx: ExtensionContext,
	policy: CompactionPolicy,
	level: "info" | "warning" | "error",
	message: string,
	options?: { critical?: boolean; dedupeKey?: string },
) => boolean;

function parseSelector(selector: string): ParseResult<{ provider: string; modelId: string }> {
	const parsed = parseModelSelector(selector);
	if (!parsed.ok) return parsed;
	const slashIndex = parsed.value.indexOf("/");
	return {
		ok: true,
		value: {
			provider: parsed.value.slice(0, slashIndex),
			modelId: parsed.value.slice(slashIndex + 1),
		},
	};
}

export function getLastAssistantMessage(messages: AgentMessage[]): AssistantMessage | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const candidate = messages[index];
		if (candidate?.role === "assistant") return candidate;
	}
	return undefined;
}

async function tryResolveModel(
	ctx: ExtensionContext,
	selector: string,
): Promise<{ model: Model<Api>; apiKey: string } | undefined> {
	const parts = parseSelector(selector);
	if (!parts.ok) return undefined;

	const model = ctx.modelRegistry.find(parts.value.provider, parts.value.modelId);
	if (!model) return undefined;

	let apiKey: string | undefined;
	try {
		apiKey = await ctx.modelRegistry.getApiKey(model);
	} catch {
		// Caller iterates models and reports the full list if all fail
		return undefined;
	}
	if (!apiKey) return undefined;

	return { model, apiKey };
}

export async function resolveSummaryModel(
	ctx: ExtensionContext,
	policy: CompactionPolicy,
	notify: NotifyFn,
): Promise<{ entry: ModelEntry; model: Model<Api>; apiKey: string } | undefined> {
	for (const entry of policy.models) {
		const resolved = await tryResolveModel(ctx, entry.model);
		if (resolved) return { entry, model: resolved.model, apiKey: resolved.apiKey };
	}

	const tried = policy.models.map((e) => e.model).join(", ");
	notify(
		ctx,
		policy,
		"warning",
		`No compaction models could be resolved (tried: ${tried}). Falling back to default compaction.`,
		{ dedupeKey: `no-models:${tried}` },
	);
	return undefined;
}
