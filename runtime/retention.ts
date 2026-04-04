import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
	buildSessionContext,
	findCutPoint,
	type FileOperations,
	type SessionBeforeCompactEvent,
	type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import type { SummaryRetentionPolicy } from "../policy/types.js";

export interface SummaryRetentionResolution {
	keepRecentTokens: number;
}

export function formatSummaryRetention(summaryRetention: SummaryRetentionPolicy | undefined): string | undefined {
	if (!summaryRetention) return undefined;
	if (summaryRetention.mode === "percent") return `keep ${summaryRetention.value}%`;
	return `keep ${summaryRetention.value}t`;
}

export function resolveSummaryRetention(
	summaryRetention: SummaryRetentionPolicy | undefined,
	options: {
		sessionContextWindow: number | undefined;
		summaryModelContextWindow: number | undefined;
		reserveTokens: number;
	},
): { resolution?: SummaryRetentionResolution; fallbackReason?: string } {
	if (!summaryRetention) return {};

	let keepRecentTokens = summaryRetention.value;
	let validationWindow = toPositiveInt(options.sessionContextWindow);

	if (summaryRetention.mode === "percent") {
		const sessionWindow = toPositiveInt(options.sessionContextWindow);
		const summaryWindow = toPositiveInt(options.summaryModelContextWindow);
		if (sessionWindow === undefined || summaryWindow === undefined) {
			return {
				fallbackReason:
					"summaryRetention percent mode needs both session and summary model context windows. Falling back to Pi default compaction.",
			};
		}
		validationWindow = Math.min(sessionWindow, summaryWindow);
		keepRecentTokens = Math.floor((validationWindow * summaryRetention.value) / 100);
	}

	const reserveTokens = Math.max(0, options.reserveTokens);
	if (validationWindow !== undefined) {
		const maxKeepRecentTokens = validationWindow - reserveTokens;
		if (maxKeepRecentTokens <= 0) {
			return {
				fallbackReason: `summaryRetention cannot be applied because reserveTokens (${reserveTokens}) leaves no room in context window (${validationWindow}). Falling back to Pi default compaction.`,
			};
		}
		if (keepRecentTokens > maxKeepRecentTokens) {
			return {
				fallbackReason: `summaryRetention resolved to keepRecentTokens=${keepRecentTokens}, which exceeds available budget (${maxKeepRecentTokens}) after reserveTokens=${reserveTokens}. Falling back to Pi default compaction.`,
			};
		}
	}

	return { resolution: { keepRecentTokens } };
}

export function rebuildPreparationWithKeepRecentTokens(
	branchEntries: SessionEntry[],
	preparation: SessionBeforeCompactEvent["preparation"],
	keepRecentTokens: number,
): { preparation?: SessionBeforeCompactEvent["preparation"]; fallbackReason?: string } {
	if (!Number.isFinite(keepRecentTokens) || keepRecentTokens < 0) {
		return {
			fallbackReason: `summaryRetention resolved invalid keepRecentTokens=${keepRecentTokens}. Falling back to Pi default compaction.`,
		};
	}
	if (branchEntries.length === 0) {
		return {
			fallbackReason: "Cannot rebuild compaction preparation: branch is empty. Falling back to Pi default compaction.",
		};
	}
	if (branchEntries[branchEntries.length - 1]?.type === "compaction") {
		return {
			fallbackReason: "Cannot rebuild compaction preparation: branch is already compacted. Falling back to Pi default compaction.",
		};
	}

	let previousSummary: string | undefined;
	let boundaryStart = 0;
	let prevCompactionIndex = -1;

	for (let i = branchEntries.length - 1; i >= 0; i--) {
		if (branchEntries[i]?.type !== "compaction") continue;
		prevCompactionIndex = i;
		break;
	}

	if (prevCompactionIndex >= 0) {
		const previousCompaction = branchEntries[prevCompactionIndex];
		if (previousCompaction.type !== "compaction") {
			return {
				fallbackReason:
					"Cannot rebuild compaction preparation: invalid previous compaction entry. Falling back to Pi default compaction.",
			};
		}
		previousSummary = previousCompaction.summary;
		const firstKeptEntryIndex = branchEntries.findIndex((entry) => entry.id === previousCompaction.firstKeptEntryId);
		boundaryStart = firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : prevCompactionIndex + 1;
	}

	const cutPoint = findCutPoint(branchEntries, boundaryStart, branchEntries.length, keepRecentTokens);
	const firstKeptEntry = branchEntries[cutPoint.firstKeptEntryIndex];
	if (!firstKeptEntry?.id) {
		return {
			fallbackReason:
				"Cannot rebuild compaction preparation: first kept entry is missing an id. Falling back to Pi default compaction.",
		};
	}

	const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;
	if (historyEnd < boundaryStart) {
		return {
			fallbackReason: "Cannot rebuild compaction preparation: invalid cut point range. Falling back to Pi default compaction.",
		};
	}

	const messagesToSummarize = collectMessagesFromRange(branchEntries, boundaryStart, historyEnd);
	const turnPrefixMessages = cutPoint.isSplitTurn
		? collectMessagesFromRange(branchEntries, cutPoint.turnStartIndex, cutPoint.firstKeptEntryIndex)
		: [];

	const fileOps = buildFileOperations(messagesToSummarize, turnPrefixMessages, branchEntries, prevCompactionIndex);

	return {
		preparation: {
			...preparation,
			firstKeptEntryId: firstKeptEntry.id,
			messagesToSummarize,
			turnPrefixMessages,
			isSplitTurn: cutPoint.isSplitTurn,
			previousSummary,
			fileOps,
			settings: {
				...preparation.settings,
				keepRecentTokens,
			},
		},
	};
}

function collectMessagesFromRange(entries: SessionEntry[], start: number, end: number): AgentMessage[] {
	if (start < 0 || end <= start) return [];
	const slice = entries.slice(start, end);
	if (slice.length === 0) return [];
	return buildSessionContext(slice).messages;
}

function buildFileOperations(
	messagesToSummarize: AgentMessage[],
	turnPrefixMessages: AgentMessage[],
	entries: SessionEntry[],
	prevCompactionIndex: number,
): FileOperations {
	const fileOps: FileOperations = {
		read: new Set<string>(),
		written: new Set<string>(),
		edited: new Set<string>(),
	};

	if (prevCompactionIndex >= 0) {
		const previousCompaction = entries[prevCompactionIndex];
		if (previousCompaction.type === "compaction" && !previousCompaction.fromHook && previousCompaction.details) {
			const details = previousCompaction.details as { readFiles?: unknown; modifiedFiles?: unknown };
			if (Array.isArray(details.readFiles)) {
				for (const path of details.readFiles) {
					if (typeof path === "string") fileOps.read.add(path);
				}
			}
			if (Array.isArray(details.modifiedFiles)) {
				for (const path of details.modifiedFiles) {
					if (typeof path === "string") fileOps.edited.add(path);
				}
			}
		}
	}

	for (const message of messagesToSummarize) {
		extractFileOpsFromMessage(message, fileOps);
	}
	for (const message of turnPrefixMessages) {
		extractFileOpsFromMessage(message, fileOps);
	}

	return fileOps;
}

function extractFileOpsFromMessage(message: AgentMessage, fileOps: FileOperations): void {
	if (message.role !== "assistant") return;
	if (!Array.isArray(message.content)) return;

	for (const block of message.content) {
		if (typeof block !== "object" || block === null || block.type !== "toolCall") continue;
		const args = block.arguments;
		if (typeof args !== "object" || args === null) continue;
		const path = "path" in args && typeof args.path === "string" ? args.path : undefined;
		if (!path) continue;

		switch (block.name) {
			case "read":
				fileOps.read.add(path);
				break;
			case "write":
				fileOps.written.add(path);
				break;
			case "edit":
				fileOps.edited.add(path);
				break;
		}
	}
}

function toPositiveInt(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
	return Math.floor(value);
}
