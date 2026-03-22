import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { completeSimple } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";
import {
	convertToLlm,
	serializeConversation,
	type SessionBeforeCompactEvent,
} from "@mariozechner/pi-coding-agent";
import type { CompactionDetails, SummaryThinkingLevel } from "../policy/types.js";

const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI coding assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the kept suffix]

Be concise. Focus on what's needed to understand the retained recent work.`;

export async function generateTemplateSummary(
	messages: AgentMessage[],
	model: Model<Api>,
	apiKey: string,
	promptText: string,
	reserveTokens: number,
	signal: AbortSignal,
	thinkingLevel: SummaryThinkingLevel,
	previousSummary?: string,
): Promise<string> {
	const llmMessages = convertToLlm(messages);
	const conversationText = serializeConversation(llmMessages);
	let fullPrompt = `<conversation>\n${conversationText}\n</conversation>\n\n`;
	if (previousSummary) {
		fullPrompt += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
	}
	fullPrompt += promptText;

	const summarizationMessages = [
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: fullPrompt }],
			timestamp: Date.now(),
		},
	];

	const completionOptions = getSummarizationCompletionOptions(
		model,
		apiKey,
		signal,
		reserveTokens,
		0.8,
		thinkingLevel,
	);
	const response = await completeSimple(
		model,
		{ systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
		completionOptions,
	);

	if (response.stopReason === "error") {
		throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);
	}

	return response.content
		.filter((content): content is { type: "text"; text: string } => content.type === "text")
		.map((content) => content.text)
		.join("\n");
}

export async function generateTurnPrefixSummary(
	messages: AgentMessage[],
	model: Model<Api>,
	apiKey: string,
	reserveTokens: number,
	signal: AbortSignal,
	thinkingLevel: SummaryThinkingLevel,
): Promise<string> {
	const llmMessages = convertToLlm(messages);
	const conversationText = serializeConversation(llmMessages);
	const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`;

	const completionOptions = getSummarizationCompletionOptions(
		model,
		apiKey,
		signal,
		reserveTokens,
		0.5,
		thinkingLevel,
	);
	const response = await completeSimple(
		model,
		{
			systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
			messages: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: promptText }],
					timestamp: Date.now(),
				},
			],
		},
		completionOptions,
	);

	if (response.stopReason === "error") {
		throw new Error(`Turn prefix summarization failed: ${response.errorMessage || "Unknown error"}`);
	}

	return response.content
		.filter((content): content is { type: "text"; text: string } => content.type === "text")
		.map((content) => content.text)
		.join("\n");
}

function toFilePathSet(value: unknown): Set<string> {
	if (value instanceof Set) {
		const result = new Set<string>();
		for (const item of value) {
			if (typeof item === "string") result.add(item);
		}
		return result;
	}
	if (Array.isArray(value)) {
		const result = new Set<string>();
		for (const item of value) {
			if (typeof item === "string") result.add(item);
		}
		return result;
	}
	return new Set<string>();
}

export function computeFileLists(fileOps: unknown): CompactionDetails {
	const raw = (fileOps as { read?: unknown; edited?: unknown; written?: unknown }) ?? {};
	const read = toFilePathSet(raw.read);
	const edited = toFilePathSet(raw.edited);
	const written = toFilePathSet(raw.written);

	const modified = new Set([...edited, ...written]);
	const readFiles = [...read].filter((path) => !modified.has(path)).sort();
	const modifiedFiles = [...modified].sort();
	return { readFiles, modifiedFiles };
}

export function formatFileOperations(details: CompactionDetails): string {
	const sections: string[] = [];
	if (details.readFiles.length > 0) {
		sections.push(`<read-files>\n${details.readFiles.join("\n")}\n</read-files>`);
	}
	if (details.modifiedFiles.length > 0) {
		sections.push(`<modified-files>\n${details.modifiedFiles.join("\n")}\n</modified-files>`);
	}
	if (sections.length === 0) return "";
	return `\n\n${sections.join("\n\n")}`;
}

export function getReserveTokens(event: SessionBeforeCompactEvent): number {
	return event.preparation.settings.reserveTokens || 16_384;
}

function getSummarizationCompletionOptions(
	model: Model<Api>,
	apiKey: string,
	signal: AbortSignal,
	reserveTokens: number,
	ratio: number,
	thinkingLevel: SummaryThinkingLevel,
): { maxTokens: number; signal: AbortSignal; apiKey: string; reasoning?: "low" | "medium" | "high" } {
	const maxTokens = Math.max(256, Math.floor(reserveTokens * ratio));
	if (!model.reasoning || thinkingLevel === "off") {
		return { maxTokens, signal, apiKey };
	}
	return { maxTokens, signal, apiKey, reasoning: thinkingLevel };
}
