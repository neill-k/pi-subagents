import type { AgentConfig } from "./agents.ts";
import { frontmatterNameForConfig } from "./identity.ts";

export const KNOWN_FIELDS = new Set([
	"name",
	"package",
	"description",
	"tools",
	"model",
	"fallbackModels",
	"thinking",
	"systemPromptMode",
	"inheritProjectContext",
	"inheritSkills",
	"defaultContext",
	"skill",
	"skills",
	"extensions",
	"output",
	"defaultReads",
	"defaultProgress",
	"interactive",
	"maxSubagentDepth",
	"canDelegate",
	"allowedChildAgents",
	"maxChildren",
	"maxParallelChildren",
	"budgetTokens",
	"budgetDollars",
	"capabilities",
	"coordinationModes",
	"allowedCoordinationActions",
]);

function joinComma(values: string[] | undefined): string | undefined {
	if (!values || values.length === 0) return undefined;
	return values.join(", ");
}

export function serializeAgent(config: AgentConfig): string {
	const lines: string[] = [];
	lines.push("---");
	lines.push(`name: ${frontmatterNameForConfig(config)}`);
	if (config.packageName) lines.push(`package: ${config.packageName}`);
	lines.push(`description: ${config.description}`);

	const tools = [
		...(config.tools ?? []),
		...(config.mcpDirectTools ?? []).map((tool) => `mcp:${tool}`),
	];
	const toolsValue = joinComma(tools);
	if (toolsValue) lines.push(`tools: ${toolsValue}`);

	if (config.model) lines.push(`model: ${config.model}`);
	const fallbackModelsValue = joinComma(config.fallbackModels);
	if (fallbackModelsValue) lines.push(`fallbackModels: ${fallbackModelsValue}`);
	if (config.thinking && config.thinking !== "off") lines.push(`thinking: ${config.thinking}`);
	lines.push(`systemPromptMode: ${config.systemPromptMode}`);
	lines.push(`inheritProjectContext: ${config.inheritProjectContext ? "true" : "false"}`);
	lines.push(`inheritSkills: ${config.inheritSkills ? "true" : "false"}`);
	if (config.defaultContext) lines.push(`defaultContext: ${config.defaultContext}`);

	const skillsValue = joinComma(config.skills);
	if (skillsValue) lines.push(`skills: ${skillsValue}`);

	if (config.extensions !== undefined) {
		const extensionsValue = joinComma(config.extensions);
		lines.push(`extensions: ${extensionsValue ?? ""}`);
	}

	if (config.output) lines.push(`output: ${config.output}`);

	const readsValue = joinComma(config.defaultReads);
	if (readsValue) lines.push(`defaultReads: ${readsValue}`);

	if (config.defaultProgress) lines.push("defaultProgress: true");
	if (config.interactive) lines.push("interactive: true");
	if (Number.isInteger(config.maxSubagentDepth) && config.maxSubagentDepth >= 0) {
		lines.push(`maxSubagentDepth: ${config.maxSubagentDepth}`);
	}
	const delegateDefault = (config.localName ?? config.name) === "delegate";
	if (config.canDelegate !== undefined && config.canDelegate !== delegateDefault) {
		lines.push(`canDelegate: ${config.canDelegate ? "true" : "false"}`);
	}
	const allowedChildAgents = joinComma(config.allowedChildAgents);
	if (allowedChildAgents) lines.push(`allowedChildAgents: ${allowedChildAgents}`);
	if (Number.isInteger(config.maxChildren) && config.maxChildren >= 0) lines.push(`maxChildren: ${config.maxChildren}`);
	if (Number.isInteger(config.maxParallelChildren) && config.maxParallelChildren >= 0) lines.push(`maxParallelChildren: ${config.maxParallelChildren}`);
	if (Number.isInteger(config.budgetTokens) && config.budgetTokens >= 0) lines.push(`budgetTokens: ${config.budgetTokens}`);
	if (typeof config.budgetDollars === "number" && Number.isFinite(config.budgetDollars) && config.budgetDollars >= 0) {
		lines.push(`budgetDollars: ${config.budgetDollars}`);
	}
	const capabilities = joinComma(config.capabilities);
	if (capabilities) lines.push(`capabilities: ${capabilities}`);
	const coordinationModes = joinComma(config.coordinationModes);
	if (coordinationModes) lines.push(`coordinationModes: ${coordinationModes}`);
	const allowedCoordinationActions = joinComma(config.allowedCoordinationActions);
	if (allowedCoordinationActions) lines.push(`allowedCoordinationActions: ${allowedCoordinationActions}`);

	if (config.extraFields) {
		for (const [key, value] of Object.entries(config.extraFields)) {
			if (KNOWN_FIELDS.has(key)) continue;
			lines.push(`${key}: ${value}`);
		}
	}

	lines.push("---");

	const body = config.systemPrompt ?? "";
	return `${lines.join("\n")}\n\n${body}\n`;
}
