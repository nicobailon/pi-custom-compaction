import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { DEFAULT_POLICY, type CompactionPolicy } from "../policy/types.ts";
import { buildSummaryPrompt, discoverTemplate, resolveSummarySettings } from "../summary/template.ts";

describe("discoverTemplate", () => {
	let cwd = "";

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "pi-custom-compaction-template-"));
	});

	afterEach(() => {
		if (cwd) rmSync(cwd, { recursive: true, force: true });
	});

	it("returns an empty object when no template files exist", (t) => {
		const globalDefault = join(homedir(), ".pi", "agent", "compaction-template.md");
		if (existsSync(globalDefault)) {
			t.skip(`global default template exists at ${globalDefault}, cannot assert empty fallback`);
			return;
		}

		assert.deepEqual(discoverTemplate(cwd, undefined), {});
	});

	it("returns template content from project .pi/compaction-template.md", () => {
		const path = resolve(cwd, ".pi", "compaction-template.md");
		mkdirSync(resolve(cwd, ".pi"), { recursive: true });
		writeFileSync(path, "  # Template\nBody  ", "utf8");

		const result = discoverTemplate(cwd, undefined);
		assert.equal(result.template, "# Template\nBody");
		assert.equal(result.resolvedPath, path);

		const globalUpdate = join(homedir(), ".pi", "agent", "compaction-template-update.md");
		if (existsSync(globalUpdate)) {
			assert.equal(result.updateResolvedPath, globalUpdate);
			assert.equal(Boolean(result.updateTemplate || result.updateFallbackReason), true);
		}
	});

	it("returns fallbackReason when template file exists but is empty", () => {
		const path = resolve(cwd, ".pi", "compaction-template.md");
		mkdirSync(resolve(cwd, ".pi"), { recursive: true });
		writeFileSync(path, "   ", "utf8");

		assert.deepEqual(discoverTemplate(cwd, undefined), {
			resolvedPath: path,
			fallbackReason: "template file is empty",
		});
	});

	it("returns updateTemplate when update template file exists", () => {
		const templatePath = resolve(cwd, ".pi", "compaction-template.md");
		const updatePath = resolve(cwd, ".pi", "compaction-template-update.md");
		mkdirSync(resolve(cwd, ".pi"), { recursive: true });
		writeFileSync(templatePath, "Base template", "utf8");
		writeFileSync(updatePath, "Update template", "utf8");

		assert.deepEqual(discoverTemplate(cwd, undefined), {
			template: "Base template",
			resolvedPath: templatePath,
			updateTemplate: "Update template",
			updateResolvedPath: updatePath,
		});
	});

	it("uses explicit template paths when provided", () => {
		const templatePath = join(cwd, "custom-initial.md");
		const updatePath = join(cwd, "custom-update.md");
		writeFileSync(templatePath, "Explicit initial", "utf8");
		writeFileSync(updatePath, "Explicit update", "utf8");

		const result = discoverTemplate(cwd, undefined, {
			template: templatePath,
			updateTemplate: updatePath,
		});
		assert.equal(result.template, "Explicit initial");
		assert.equal(result.resolvedPath, templatePath);
		assert.equal(result.updateTemplate, "Explicit update");
		assert.equal(result.updateResolvedPath, updatePath);
	});

	it("returns fallbackReason when explicit template path does not exist", () => {
		const missingPath = join(cwd, "nonexistent.md");
		const result = discoverTemplate(cwd, undefined, { template: missingPath });
		assert.equal(result.template, undefined);
		assert.equal(result.resolvedPath, missingPath);
		assert.equal(result.fallbackReason, "file not found");
	});
});

describe("resolveSummarySettings", () => {
	const policy: CompactionPolicy = {
		...DEFAULT_POLICY,
		trigger: { ...DEFAULT_POLICY.trigger },
		models: [...DEFAULT_POLICY.models],
		ui: { ...DEFAULT_POLICY.ui },
		summary: { thinkingLevel: "low", preservationInstruction: "Policy preserve instruction." },
	};

	it("uses model entry overrides when present", () => {
		const result = resolveSummarySettings(policy, {
			model: "openai/gpt-4",
			thinkingLevel: "high",
			preservationInstruction: "Entry preserve instruction.",
		});
		assert.deepEqual(result, {
			thinkingLevel: "high",
			preservationInstruction: "Entry preserve instruction.",
		});
	});

	it("falls back to policy defaults when model entry has no overrides", () => {
		const result = resolveSummarySettings(policy, { model: "openai/gpt-4" });
		assert.deepEqual(result, {
			thinkingLevel: "low",
			preservationInstruction: "Policy preserve instruction.",
		});
	});
});

describe("buildSummaryPrompt", () => {
	it("includes the base template in output", () => {
		const result = buildSummaryPrompt("BASE_TEMPLATE", undefined, undefined, undefined, "Keep exact paths.");
		assert.match(result, /Use this EXACT format:/);
		assert.match(result, /BASE_TEMPLATE/);
	});

	it("uses updateTemplate when previous summary exists and updateTemplate is provided", () => {
		const result = buildSummaryPrompt(
			"BASE_TEMPLATE",
			"UPDATE_TEMPLATE",
			"Old summary",
			undefined,
			"Keep exact paths.",
		);
		assert.match(result, /UPDATE_TEMPLATE/);
		assert.equal(result.includes("BASE_TEMPLATE"), false);
		assert.match(result, /Update the existing structured summary with new information/);
	});

	it("includes custom instructions when provided", () => {
		const result = buildSummaryPrompt(
			"BASE_TEMPLATE",
			undefined,
			undefined,
			"Focus on failures only.",
			"Keep exact paths.",
		);
		assert.match(result, /Additional focus: Focus on failures only\./);
	});

	it("includes preservation instruction in the prompt", () => {
		const result = buildSummaryPrompt("BASE_TEMPLATE", undefined, undefined, undefined, "Preserve exact errors.");
		assert.match(result, /Preserve exact errors\./);
	});
});
