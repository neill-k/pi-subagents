import { appendJsonl } from "../shared/artifacts.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentConfig } from "../agents/agents.ts";
import {
	ASYNC_DIR,
	SUBAGENT_COORDINATION_EVENT,
	type Details,
} from "../shared/types.ts";
import {
	SUBAGENT_CHILD_AGENT_ENV,
	SUBAGENT_CHILD_INDEX_ENV,
	SUBAGENT_ROOT_RUN_ID_ENV,
	SUBAGENT_RUN_ID_ENV,
} from "../runs/shared/pi-args.ts";
import { envelopEvent } from "../runs/shared/event-envelope.ts";
import {
	AGENT_RESULT_SCORED,
	ARTIFACT_PUBLISHED,
	AUCTION_CLOSED,
	AUCTION_OPENED,
	BID_FAILED,
	BID_SUBMITTED,
	BID_WON,
	DECISION_RECORDED,
	FINDING_PUBLISHED,
	TASK_CLAIMED,
	TASK_COMPLETED,
	TASK_POSTED,
	TASK_RELEASED,
} from "./event-types.ts";
import {
	appendBlackboard,
	claimTask,
	completeTask,
	coordinationEventsPath,
	getBlackboard,
	listArtifacts,
	listBlackboard,
	listDecisions,
	listFindings,
	listTasks,
	postTask,
	publishArtifact,
	recordDecision,
	recordFinding,
	releaseTask,
	type CoordinationRecord,
} from "./store.ts";
import { awardAuction, closeAuction, listAuctions, openAuction, recordScore, submitBid } from "./auctions.ts";

export interface CoordinationActionParams {
	action?: "coordination";
	coord?: {
		op?: string;
		rootRunId?: string;
		scope?: string;
		key?: string;
		value?: unknown;
		taskId?: string;
		task?: Record<string, unknown>;
		finding?: Record<string, unknown>;
		decision?: Record<string, unknown>;
		artifact?: Record<string, unknown>;
		reason?: string;
		auctionId?: string;
		bid?: Record<string, unknown>;
		winners?: string[];
		score?: Record<string, unknown>;
		[key: string]: unknown;
	};
}

interface CoordinationDeps {
	pi?: { events?: { emit(channel: string, payload: unknown): void } };
	agents: AgentConfig[];
	asyncDirRoot?: string;
	env?: NodeJS.ProcessEnv;
}

interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: Details;
	isError?: boolean;
}

const OP_PERMISSION = new Map<string, string>([
	["blackboard.append", "record_finding"],
	["task.post", "post_task"],
	["task.claim", "claim"],
	["task.release", "claim"],
	["task.complete", "claim"],
	["decision.record", "record_decision"],
	["artifact.publish", "publish_artifact"],
	["finding.publish", "record_finding"],
	["auction.bid", "submit_bid"],
	["score.record", "score"],
]);

function result(text: string, isError = false): ToolResult {
	return { content: [{ type: "text", text }], isError, details: { mode: "management", results: [] } };
}

function currentAgent(env: NodeJS.ProcessEnv): { agent?: string; index?: number; runId?: string; rootRunId?: string } {
	const indexRaw = env[SUBAGENT_CHILD_INDEX_ENV];
	const index = indexRaw === undefined ? undefined : Number(indexRaw);
	return {
		agent: env[SUBAGENT_CHILD_AGENT_ENV],
		index: Number.isInteger(index) ? index : undefined,
		runId: env[SUBAGENT_RUN_ID_ENV],
		rootRunId: env[SUBAGENT_ROOT_RUN_ID_ENV],
	};
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
	return value.trim();
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
	return value as Record<string, unknown>;
}

function assertPermission(op: string, agents: AgentConfig[], env: NodeJS.ProcessEnv): void {
	const current = currentAgent(env).agent;
	if (!current) return;
	const required = OP_PERMISSION.get(op);
	if (!required) return;
	const agent = agents.find((candidate) => candidate.name === current || candidate.localName === current);
	if (!agent) throw new Error(`Coordination blocked: agent '${current}' is not in the discovered agent set.`);
	if (!agent.allowedCoordinationActions?.includes(required)) {
		throw new Error(`Coordination blocked: agent '${agent.name}' lacks allowedCoordinationActions: ${required}.`);
	}
}

function emitCoordinationEvent(input: {
	deps: CoordinationDeps;
	rootRunId: string;
	runId?: string;
	agent?: string;
	index?: number;
	type: string;
	payload: Record<string, unknown>;
}): void {
	const event = envelopEvent({
		runId: input.runId ?? input.rootRunId,
		rootRunId: input.rootRunId,
		agent: input.agent,
		index: input.index,
	}, {
		type: input.type,
		ts: Date.now(),
		...input.payload,
	});
	const eventsPath = coordinationEventsPath(input.rootRunId, input.deps.asyncDirRoot);
	fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
	appendJsonl(eventsPath, JSON.stringify(event));
	input.deps.pi?.events?.emit(SUBAGENT_COORDINATION_EVENT, event);
}

function textPayload(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function eventForOperation(op: string, record: CoordinationRecord | Record<string, unknown>): string | undefined {
	switch (op) {
		case "task.post": return TASK_POSTED;
		case "task.claim": return TASK_CLAIMED;
		case "task.release": return TASK_RELEASED;
		case "task.complete": return TASK_COMPLETED;
		case "finding.publish": return FINDING_PUBLISHED;
		case "decision.record": return DECISION_RECORDED;
		case "artifact.publish": return ARTIFACT_PUBLISHED;
		case "auction.open": return AUCTION_OPENED;
		case "auction.bid": return BID_SUBMITTED;
		case "auction.close":
		case "auction.award": return AUCTION_CLOSED;
		case "score.record": return AGENT_RESULT_SCORED;
		default: return undefined;
	}
}

export function handleCoordinationAction(params: CoordinationActionParams, deps: CoordinationDeps): ToolResult {
	const env = deps.env ?? process.env;
	const coord = params.coord;
	if (!coord || typeof coord !== "object" || Array.isArray(coord)) return result("coord object required for action='coordination'.", true);
	const op = requireString(coord.op, "coord.op");
	const current = currentAgent(env);
	const rootRunId = coord.rootRunId ?? current.rootRunId;
	if (!rootRunId) return result("coord.rootRunId is required outside a subagent root run.", true);
	const runId = current.runId ?? rootRunId;
	const meta = { runId, agent: current.agent, index: current.index };
	const asyncDirRoot = deps.asyncDirRoot ?? ASYNC_DIR;
	try {
		assertPermission(op, deps.agents, env);
		let payload: unknown;
		switch (op) {
			case "blackboard.append":
				payload = appendBlackboard(rootRunId, requireString(coord.scope, "coord.scope"), requireString(coord.key, "coord.key"), coord.value, meta, asyncDirRoot);
				break;
			case "blackboard.get":
				payload = getBlackboard(rootRunId, requireString(coord.scope, "coord.scope"), requireString(coord.key, "coord.key"), asyncDirRoot) ?? null;
				break;
			case "blackboard.list":
				payload = listBlackboard(rootRunId, typeof coord.scope === "string" ? coord.scope : undefined, typeof coord.key === "string" ? coord.key : undefined, asyncDirRoot);
				break;
			case "task.post":
				payload = postTask(rootRunId, requireObject(coord.task, "coord.task") as { title: string }, meta, asyncDirRoot);
				break;
			case "task.claim":
				payload = claimTask(rootRunId, requireString(coord.taskId, "coord.taskId"), current.agent ?? "parent", runId, meta, asyncDirRoot);
				break;
			case "task.release":
				payload = releaseTask(rootRunId, requireString(coord.taskId, "coord.taskId"), current.agent ?? "parent", runId, typeof coord.reason === "string" ? coord.reason : undefined, meta, asyncDirRoot);
				break;
			case "task.complete":
				payload = completeTask(rootRunId, requireString(coord.taskId, "coord.taskId"), current.agent ?? "parent", runId, meta, asyncDirRoot);
				break;
			case "task.list":
				payload = listTasks(rootRunId, asyncDirRoot);
				break;
			case "finding.publish":
				payload = recordFinding(rootRunId, requireObject(coord.finding, "coord.finding"), meta, asyncDirRoot);
				break;
			case "finding.list":
				payload = listFindings(rootRunId, asyncDirRoot);
				break;
			case "decision.record":
				payload = recordDecision(rootRunId, requireObject(coord.decision, "coord.decision"), meta, asyncDirRoot);
				break;
			case "decision.list":
				payload = listDecisions(rootRunId, asyncDirRoot);
				break;
			case "artifact.publish":
				payload = publishArtifact(rootRunId, requireObject(coord.artifact, "coord.artifact"), meta, asyncDirRoot);
				break;
			case "artifact.list":
				payload = listArtifacts(rootRunId, asyncDirRoot);
				break;
			case "auction.open":
				payload = openAuction(rootRunId, coord.task, typeof coord.deadlineMs === "number" ? coord.deadlineMs : undefined, asyncDirRoot);
				break;
			case "auction.bid":
				payload = submitBid(rootRunId, requireString(coord.auctionId, "coord.auctionId"), requireObject(coord.bid, "coord.bid"), asyncDirRoot);
				break;
			case "auction.award":
				payload = awardAuction(rootRunId, requireString(coord.auctionId, "coord.auctionId"), Array.isArray(coord.winners) ? coord.winners.filter((entry): entry is string => typeof entry === "string") : [], asyncDirRoot);
				break;
			case "auction.close":
				payload = closeAuction(rootRunId, requireString(coord.auctionId, "coord.auctionId"), asyncDirRoot);
				break;
			case "auction.list":
				payload = listAuctions(rootRunId, asyncDirRoot);
				break;
			case "score.record":
				payload = recordScore(rootRunId, typeof coord.auctionId === "string" ? coord.auctionId : undefined, requireObject(coord.score, "coord.score"), asyncDirRoot);
				break;
			default:
				return result(`Unknown coordination op: ${op}`, true);
		}
		const eventType = eventForOperation(op, payload as Record<string, unknown>);
		if (eventType) {
			emitCoordinationEvent({
				deps,
				rootRunId,
				runId,
				agent: current.agent,
				index: current.index,
				type: eventType,
				payload: payload && typeof payload === "object" ? payload as Record<string, unknown> : { value: payload },
			});
			if (op === "auction.award" && Array.isArray((payload as { bids?: unknown }).bids)) {
				const winners = new Set((payload as { winners?: string[] }).winners ?? []);
				for (const bid of (payload as { bids: Array<Record<string, unknown>> }).bids) {
					const bidder = typeof bid.agent === "string" ? bid.agent : typeof bid.bidder === "string" ? bid.bidder : undefined;
					if (!bidder) continue;
					emitCoordinationEvent({
						deps,
						rootRunId,
						runId,
						agent: current.agent,
						index: current.index,
						type: winners.has(bidder) ? BID_WON : BID_FAILED,
						payload: { auctionId: (payload as { id?: string }).id, bid },
					});
				}
			}
		}
		return result(textPayload(payload));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return result(message, true);
	}
}
