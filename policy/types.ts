import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ContextUsage, ThemeColor } from "@mariozechner/pi-coding-agent";

export type SummaryThinkingLevel = "off" | "low" | "medium" | "high";

/**
 * Parsed status-bar color. Produced by `parseStatusColor` so runtime styling
 * is an O(1) string wrap with no re-validation.
 *
 * - `theme`: resolved at render time via `ctx.ui.theme.fg(token, text)`, so the
 *   color follows theme switching.
 * - `ansi`: pre-baked ANSI escape pair; applied as `open + text + close`. Use
 *   this for hex (`#00d7ff`) and named-ANSI (`cyan`, `brightMagenta`) inputs
 *   that should render identically across themes.
 */
export type StatusColor =
	| { kind: "theme"; token: ThemeColor }
	| { kind: "ansi"; open: string; close: string };

export type PolicyKey =
	| "trigger.maxTokens"
	| "trigger.minTokens"
	| "trigger.cooldownMs"
	| "trigger.builtinReserveTokens"
	| "trigger.builtinSkipMarginPercent"
	| "ui.name"
	| "ui.quiet"
	| "ui.showStatus"
	| "ui.minimalStatus"
	| "ui.statusColor"
	| "summary.thinkingLevel"
	| "summary.preservationInstruction";

export interface SummaryModelOverride {
	thinkingLevel?: SummaryThinkingLevel;
	preservationInstruction?: string;
}

export interface ModelEntry extends SummaryModelOverride {
	model: string;
}

export interface SummaryPolicy {
	thinkingLevel: SummaryThinkingLevel;
	preservationInstruction: string;
}

export interface SummaryRetentionPolicy {
	mode: "tokens" | "percent";
	value: number;
}

export interface CompactionPolicy {
	enabled: boolean;
	trigger: {
		maxTokens?: number;
		minTokens: number;
		cooldownMs: number;
		builtinReserveTokens: number;
		builtinSkipMarginPercent: number;
	};
	models: ModelEntry[];
	ui: {
		name: string;
		quiet: boolean;
		showStatus: boolean;
		minimalStatus: boolean;
		statusColor?: StatusColor;
	};
	summary: SummaryPolicy;
	summaryRetention?: SummaryRetentionPolicy;
	profiles?: Record<string, ProfileOverride>;
}

export interface CompactionPolicyPatch {
	enabled?: boolean;
	trigger?: Partial<CompactionPolicy["trigger"]>;
	models?: ModelEntry[];
	ui?: Partial<CompactionPolicy["ui"]>;
	summary?: Partial<CompactionPolicy["summary"]>;
	summaryRetention?: SummaryRetentionPolicy;
	profiles?: Record<string, ProfileOverride>;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ProactiveTriggerInput {
	lastAssistantMessage: AssistantMessage | undefined;
	usage: ContextUsage | undefined;
	inFlight: boolean;
	nowMs: number;
	lastProactiveAtMs: number | undefined;
	policy: CompactionPolicy;
}

export interface TemplateResolution {
	template?: string;
	updateTemplate?: string;
	resolvedPath?: string;
	updateResolvedPath?: string;
	fallbackReason?: string;
	updateFallbackReason?: string;
}

export interface ProfileOverride {
	match: string;
	trigger?: Partial<CompactionPolicy["trigger"]>;
	models?: ModelEntry[];
	summary?: SummaryModelOverride;
	summaryRetention?: SummaryRetentionPolicy;
	template?: string;
	updateTemplate?: string;
}

export interface CompactionDetails {
	readFiles: string[];
	modifiedFiles: string[];
}

export const CONFIG_FILE = ".pi/compaction-policy.json";

export const DEFAULT_POLICY: CompactionPolicy = {
	enabled: false,
	trigger: {
		minTokens: 100_000,
		cooldownMs: 60_000,
		builtinReserveTokens: 16_384,
		builtinSkipMarginPercent: 5,
	},
	models: [{ model: "openai-codex/gpt-5.3-codex" }],
	ui: {
		name: "compact",
		quiet: false,
		showStatus: true,
		minimalStatus: false,
	},
	summary: {
		thinkingLevel: "low",
		preservationInstruction: "Preserve exact file paths, function names, and error messages.",
	},
};

export const POLICY_KEYS: PolicyKey[] = [
	"trigger.maxTokens",
	"trigger.minTokens",
	"trigger.cooldownMs",
	"trigger.builtinReserveTokens",
	"trigger.builtinSkipMarginPercent",
	"ui.name",
	"ui.quiet",
	"ui.showStatus",
	"ui.minimalStatus",
	"ui.statusColor",
	"summary.thinkingLevel",
	"summary.preservationInstruction",
];
