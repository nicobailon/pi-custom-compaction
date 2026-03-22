import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Loader } from "@mariozechner/pi-tui";
import { mergePolicy } from "../policy/merge.js";
import { readProjectPolicyPatch } from "../policy/config.js";
import { DEFAULT_POLICY, type CompactionPolicy } from "../policy/types.js";

const STATUS_KEY = "compact-policy";
const WATCHDOG_MS = 120_000;

interface InFlightState {
	active: boolean;
	source: string;
	timerId: NodeJS.Timeout | undefined;
}

export interface RuntimeServices {
	clearInFlight: () => void;
	setInFlight: (source: string) => void;
	isInFlight: () => boolean;
	getLastProactiveAtMs: () => number | undefined;
	setLastProactiveAtMs: (value: number | undefined) => void;
	setActiveProfileName: (name: string | undefined) => void;
	markPostCompact: () => void;
	notify: (
		ctx: ExtensionContext,
		policy: CompactionPolicy,
		level: "info" | "warning" | "error",
		message: string,
		options?: { critical?: boolean; dedupeKey?: string },
	) => boolean;
	updateStatus: (ctx: ExtensionContext, policy: CompactionPolicy) => void;
	clearSessionScopedState: (ctx: ExtensionContext) => void;
	loadEffectivePolicy: (
		ctx: ExtensionContext,
		options?: {
			warnOnInvalidConfig?: boolean;
		},
	) => CompactionPolicy;
	triggerCompaction: (
		ctx: ExtensionContext,
		policy: CompactionPolicy,
		source: string,
		customInstructions?: string,
	) => boolean;
}

export function createRuntimeServices(): RuntimeServices {
	const inFlight: InFlightState = { active: false, source: "", timerId: undefined };
	let lastProactiveAtMs: number | undefined;
	let activeProfileName: string | undefined;
	let configWarningLatched = false;
	const warnedReasons = new Set<string>();
	let widgetCtx: ExtensionContext | undefined;
	let postCompact = false;
	const WIDGET_KEY = "compact-loader";

	function showCompactionWidget(ctx: ExtensionContext) {
		hideCompactionWidget();
		ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
			const loader = new Loader(
				tui,
				(s) => theme.fg("accent", s),
				(t) => theme.fg("muted", t),
				"Compacting…",
			);
			return Object.assign(loader, { dispose: () => loader.stop() });
		});
		widgetCtx = ctx;
	}

	function hideCompactionWidget() {
		if (!widgetCtx) return;
		widgetCtx.ui.setWidget(WIDGET_KEY, undefined);
		widgetCtx = undefined;
	}

	function clearInFlight() {
		if (inFlight.timerId) {
			clearTimeout(inFlight.timerId);
			inFlight.timerId = undefined;
		}
		inFlight.active = false;
		inFlight.source = "";
	}

	function setInFlight(source: string) {
		clearInFlight();
		inFlight.active = true;
		inFlight.source = source;
		inFlight.timerId = setTimeout(() => {
			clearInFlight();
			hideCompactionWidget();
		}, WATCHDOG_MS);
	}

	function notify(
		ctx: ExtensionContext,
		policy: CompactionPolicy,
		level: "info" | "warning" | "error",
		message: string,
		options?: { critical?: boolean; dedupeKey?: string },
	): boolean {
		if (policy.ui.quiet && !options?.critical && level !== "error") return false;
		if (options?.dedupeKey) {
			if (warnedReasons.has(options.dedupeKey)) return false;
			warnedReasons.add(options.dedupeKey);
		}
		ctx.ui.notify(message, level);
		return true;
	}

	function updateStatus(ctx: ExtensionContext, policy: CompactionPolicy) {
		if (!policy.enabled || !policy.ui.showStatus) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}

		const base = policy.ui.name;
		const prefix = activeProfileName ? `${base}: ${activeProfileName}` : base;

		if (inFlight.active) {
			ctx.ui.setStatus(STATUS_KEY, `${prefix} · compacting…`);
			return;
		}

		const usage = ctx.getContextUsage();

		if (!usage || usage.tokens === null) {
			ctx.ui.setStatus(STATUS_KEY, postCompact ? prefix : `${prefix} · ?`);
			return;
		}
		postCompact = false;

		const { maxTokens } = policy.trigger;
		const limit = maxTokens && maxTokens > 0 && maxTokens < usage.contextWindow
			? maxTokens
			: usage.contextWindow;
		const pct = limit > 0 ? (usage.tokens / limit) * 100 : 0;

		ctx.ui.setStatus(
			STATUS_KEY,
			policy.ui.minimalStatus
				? `${prefix} · ${pct.toFixed(0)}%`
				: `${prefix} · ${pct.toFixed(1)}% (${usage.tokens}/${limit})`,
		);
	}

	function loadEffectivePolicy(
		ctx: ExtensionContext,
		options?: {
			warnOnInvalidConfig?: boolean;
		},
	): CompactionPolicy {
		const result = readProjectPolicyPatch(ctx.cwd);
		if (result.ok) {
			configWarningLatched = false;
			return mergePolicy(DEFAULT_POLICY, result.value);
		}
		if (options?.warnOnInvalidConfig !== false && !configWarningLatched) {
			const emitted = notify(
				ctx,
				DEFAULT_POLICY,
				"warning",
				`${result.error}. Using built-in defaults.`,
			);
			if (emitted) configWarningLatched = true;
		}
		return DEFAULT_POLICY;
	}

	function clearSessionScopedState(ctx: ExtensionContext) {
		clearInFlight();
		hideCompactionWidget();
		lastProactiveAtMs = undefined;
		activeProfileName = undefined;
		postCompact = false;
		configWarningLatched = false;
		warnedReasons.clear();
		ctx.ui.setStatus(STATUS_KEY, undefined);
	}

	function triggerCompaction(
		ctx: ExtensionContext,
		policy: CompactionPolicy,
		source: string,
		customInstructions?: string,
	): boolean {
		if (inFlight.active) {
			notify(ctx, policy, "warning", `Compaction already in progress (${inFlight.source}).`);
			updateStatus(ctx, policy);
			return false;
		}

		setInFlight(source);
		try {
			showCompactionWidget(ctx);
			ctx.compact({
				customInstructions,
				onComplete: () => {
					clearInFlight();
					hideCompactionWidget();
					updateStatus(ctx, policy);
				},
				onError: (error) => {
					clearInFlight();
					hideCompactionWidget();
					const message = error instanceof Error ? error.message : String(error);
					notify(ctx, policy, "error", `Compaction failed: ${message}`, { critical: true });
					updateStatus(ctx, policy);
				},
			});
		} catch (error) {
			clearInFlight();
			hideCompactionWidget();
			const message = error instanceof Error ? error.message : String(error);
			notify(ctx, policy, "error", `Compaction failed: ${message}`, { critical: true });
			updateStatus(ctx, policy);
			return false;
		}
		updateStatus(ctx, policy);
		return true;
	}

	return {
		clearInFlight,
		setInFlight,
		isInFlight: () => inFlight.active,
		getLastProactiveAtMs: () => lastProactiveAtMs,
		setLastProactiveAtMs: (value: number | undefined) => {
			lastProactiveAtMs = value;
		},
		setActiveProfileName: (name: string | undefined) => {
			activeProfileName = name;
		},
		markPostCompact: () => {
			postCompact = true;
		},
		notify,
		updateStatus,
		clearSessionScopedState,
		loadEffectivePolicy,
		triggerCompaction,
	};
}
