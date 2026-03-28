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
): Promise<{ model: Model<Api>; apiKey?: string; headers?: Record<string, string> } | { reason: string } | undefined> {
	const parts = parseSelector(selector);
	if (!parts.ok) return undefined;

	const model = ctx.modelRegistry.find(parts.value.provider, parts.value.modelId);
	if (!model) return { reason: `model not found: ${parts.value.provider}/${parts.value.modelId}` };

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) return { reason: `${selector}: ${auth.error}` };

	return { model, apiKey: auth.apiKey, headers: auth.headers };
}

export async function resolveSummaryModel(
	ctx: ExtensionContext,
	policy: CompactionPolicy,
	notify: NotifyFn,
): Promise<{ entry: ModelEntry; model: Model<Api>; apiKey?: string; headers?: Record<string, string> } | undefined> {
	const failures: string[] = [];
	for (const entry of policy.models) {
		const resolved = await tryResolveModel(ctx, entry.model);
		if (!resolved) continue;
		if ("reason" in resolved) { failures.push(resolved.reason); continue; }
		return { entry, model: resolved.model, apiKey: resolved.apiKey, headers: resolved.headers };
	}

	const tried = policy.models.map((e) => e.model).join(", ");
	const detail = failures.length > 0 ? ` [${failures.join("; ")}]` : "";
	notify(
		ctx,
		policy,
		"warning",
		`No compaction models could be resolved (tried: ${tried}).${detail} Falling back to default compaction.`,
		{ dedupeKey: `no-models:${tried}` },
	);
	return undefined;
}
