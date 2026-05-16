import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentConfig } from "../../agents/agents.ts";
import { ASYNC_DIR } from "../../shared/types.ts";
import { writeAtomicJson } from "../../shared/atomic-json.ts";
import {
	SUBAGENT_CHILD_AGENT_ENV,
	SUBAGENT_PARENT_AGENT_ENV,
	SUBAGENT_ROOT_RUN_ID_ENV,
	SUBAGENT_RUN_ID_ENV,
} from "./pi-args.ts";

interface LimitsState {
	childCount: number;
	parallelChildCount: number;
}

export interface DelegationReservation {
	release(): void;
}

export interface DelegationGuardInput {
	agents: AgentConfig[];
	childAgents: string[];
	runId: string;
	rootRunId?: string;
	asyncDirRoot?: string;
	env?: NodeJS.ProcessEnv;
}

export interface DelegationGuardResult {
	ok: boolean;
	error?: string;
	reservation?: DelegationReservation;
}

function currentAgentName(env: NodeJS.ProcessEnv): string | undefined {
	return env[SUBAGENT_CHILD_AGENT_ENV] ?? env[SUBAGENT_PARENT_AGENT_ENV];
}

function coordinationDir(asyncDirRoot: string, rootRunId: string): string {
	return path.join(asyncDirRoot, rootRunId, "coord");
}

function limitsPath(asyncDirRoot: string, rootRunId: string): string {
	return path.join(coordinationDir(asyncDirRoot, rootRunId), "limits.json");
}

function readLimits(filePath: string): LimitsState {
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<LimitsState>;
		return {
			childCount: Number.isInteger(parsed.childCount) ? parsed.childCount! : 0,
			parallelChildCount: Number.isInteger(parsed.parallelChildCount) ? parsed.parallelChildCount! : 0,
		};
	} catch {
		return { childCount: 0, parallelChildCount: 0 };
	}
}

function eventTokens(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (!value || typeof value !== "object") return 0;
	const total = (value as { total?: unknown }).total;
	return typeof total === "number" && Number.isFinite(total) ? total : 0;
}

function sumRootEventTokens(asyncDirRoot: string, rootRunId: string): number {
	const rootDir = path.join(asyncDirRoot, rootRunId);
	let total = 0;
	const entries = fs.existsSync(asyncDirRoot) ? fs.readdirSync(asyncDirRoot, { withFileTypes: true }) : [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const statusPath = path.join(asyncDirRoot, entry.name, "status.json");
		let belongsToRoot = entry.name === rootRunId;
		try {
			const status = JSON.parse(fs.readFileSync(statusPath, "utf-8")) as { rootRunId?: string };
			belongsToRoot = belongsToRoot || status.rootRunId === rootRunId;
		} catch {}
		if (!belongsToRoot) continue;
		const eventsPath = path.join(asyncDirRoot, entry.name, "events.jsonl");
		if (!fs.existsSync(eventsPath)) continue;
		for (const line of fs.readFileSync(eventsPath, "utf-8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const event = JSON.parse(line) as { tokens?: unknown };
				total += eventTokens(event.tokens);
			} catch {}
		}
	}
	if (fs.existsSync(path.join(rootDir, "events.jsonl"))) {
		return total;
	}
	return total;
}

function formatChildList(children: string[]): string {
	return children.length ? children.join(", ") : "(none)";
}

export function reserveDelegation(input: DelegationGuardInput): DelegationGuardResult {
	const env = input.env ?? process.env;
	const parentAgentName = currentAgentName(env);
	if (!parentAgentName) return { ok: true, reservation: { release() {} } };

	const parent = input.agents.find((agent) => agent.name === parentAgentName || agent.localName === parentAgentName);
	if (!parent) {
		return { ok: false, error: `Delegation blocked: parent agent '${parentAgentName}' is not in the discovered agent set.` };
	}
	if (parent.canDelegate !== true) {
		return { ok: false, error: `Delegation blocked: agent '${parent.name}' has canDelegate=false.` };
	}
	if (parent.allowedChildAgents?.length) {
		const allowed = new Set(parent.allowedChildAgents);
		const disallowed = input.childAgents.filter((agent) => !allowed.has(agent));
		if (disallowed.length > 0) {
			return {
				ok: false,
				error: `Delegation blocked: agent '${parent.name}' can only spawn ${formatChildList(parent.allowedChildAgents)}; requested ${formatChildList(disallowed)}.`,
			};
		}
	}

	const rootRunId = input.rootRunId ?? env[SUBAGENT_ROOT_RUN_ID_ENV] ?? env[SUBAGENT_RUN_ID_ENV] ?? input.runId;
	const asyncDirRoot = input.asyncDirRoot ?? ASYNC_DIR;
	const filePath = limitsPath(asyncDirRoot, rootRunId);
	const current = readLimits(filePath);
	const requested = input.childAgents.length;
	if (parent.maxChildren !== undefined && current.childCount + requested > parent.maxChildren) {
		return { ok: false, error: `Delegation blocked: maxChildren=${parent.maxChildren} would be exceeded for root run ${rootRunId}.` };
	}
	if (parent.maxParallelChildren !== undefined && current.parallelChildCount + requested > parent.maxParallelChildren) {
		return { ok: false, error: `Delegation blocked: maxParallelChildren=${parent.maxParallelChildren} would be exceeded for root run ${rootRunId}.` };
	}
	if (parent.budgetTokens !== undefined) {
		const usedTokens = sumRootEventTokens(asyncDirRoot, rootRunId);
		if (usedTokens >= parent.budgetTokens) {
			return { ok: false, error: `Delegation blocked: budgetTokens=${parent.budgetTokens} is exhausted for root run ${rootRunId}.` };
		}
	}

	const next = {
		childCount: current.childCount + requested,
		parallelChildCount: current.parallelChildCount + requested,
	};
	writeAtomicJson(filePath, next);
	let released = false;
	return {
		ok: true,
		reservation: {
			release() {
				if (released) return;
				released = true;
				const latest = readLimits(filePath);
				writeAtomicJson(filePath, {
					childCount: latest.childCount,
					parallelChildCount: Math.max(0, latest.parallelChildCount - requested),
				});
			},
		},
	};
}
