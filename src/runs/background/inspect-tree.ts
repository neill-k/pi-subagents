import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { ASYNC_DIR, RESULTS_DIR, type Details } from "../../shared/types.ts";
import { listAsyncRuns, type AsyncRunSummary } from "./async-status.ts";

interface InspectTreeParams {
	action?: "tree";
	id?: string;
	runId?: string;
}

interface InspectTreeDeps {
	asyncDirRoot?: string;
	resultsDir?: string;
}

interface TreeNode {
	id: string;
	label: string;
	parentRunId?: string;
	children: TreeNode[];
	run: AsyncRunSummary;
}

function formatAgents(run: AsyncRunSummary): string {
	const agents = run.steps.map((step) => step.agent);
	if (agents.length === 0) return "(no agents)";
	return agents.join(", ");
}

function renderNode(node: TreeNode, prefix = "", isLast = true): string[] {
	const branch = prefix ? (isLast ? "`- " : "|- ") : "";
	const line = `${prefix}${branch}${node.label}`;
	const childPrefix = prefix ? `${prefix}${isLast ? "   " : "|  "}` : "";
	const lines = [line];
	for (let index = 0; index < node.children.length; index++) {
		lines.push(...renderNode(node.children[index]!, childPrefix, index === node.children.length - 1));
	}
	return lines;
}

function buildTree(runs: AsyncRunSummary[]): TreeNode[] {
	const nodes = new Map<string, TreeNode>();
	for (const run of runs) {
		nodes.set(run.id, {
			id: run.id,
			parentRunId: run.parentRunId,
			label: `${run.id} | ${run.state} | ${run.mode} | ${formatAgents(run)}`,
			children: [],
			run,
		});
	}
	const roots: TreeNode[] = [];
	for (const node of nodes.values()) {
		const parent = node.parentRunId ? nodes.get(node.parentRunId) : undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
	}
	for (const node of nodes.values()) {
		node.children.sort((left, right) => (left.run.startedAt ?? 0) - (right.run.startedAt ?? 0));
	}
	return roots.sort((left, right) => (left.run.startedAt ?? 0) - (right.run.startedAt ?? 0));
}

export function inspectSubagentTree(params: InspectTreeParams, deps: InspectTreeDeps = {}): AgentToolResult<Details> {
	try {
		const runs = listAsyncRuns(deps.asyncDirRoot ?? ASYNC_DIR, {
			resultsDir: deps.resultsDir ?? RESULTS_DIR,
			reconcile: false,
		});
		const requested = params.id ?? params.runId;
		const selectedRoot = requested
			? runs.find((run) => run.id === requested || run.id.startsWith(requested) || run.rootRunId === requested || run.rootRunId?.startsWith(requested))?.rootRunId ?? requested
			: undefined;
		const scoped = selectedRoot
			? runs.filter((run) => run.rootRunId === selectedRoot || run.id === selectedRoot || run.id.startsWith(selectedRoot))
			: runs;
		const roots = buildTree(scoped);
		const text = roots.length ? roots.flatMap((root, index) => renderNode(root, "", index === roots.length - 1)).join("\n") : "(no async runs)";
		return {
			content: [{ type: "text", text }],
			details: { mode: "management", results: [] },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: message }],
			isError: true,
			details: { mode: "management", results: [] },
		};
	}
}
