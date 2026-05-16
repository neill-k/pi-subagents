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

export interface CoordinationReplayState {
	tasks: Record<string, Record<string, unknown>>;
	findings: Array<Record<string, unknown>>;
	decisions: Array<Record<string, unknown>>;
	artifacts: Array<Record<string, unknown>>;
	auctions: Record<string, Record<string, unknown>>;
	bids: Array<Record<string, unknown>>;
	scores: Array<Record<string, unknown>>;
	bidOutcomes: Record<string, { won: number; failed: number }>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function taskIdOf(record: Record<string, unknown>): string | undefined {
	if (typeof record.taskId === "string") return record.taskId;
	if (typeof record.id === "string") return record.id;
	return undefined;
}

function auctionIdOf(record: Record<string, unknown>): string | undefined {
	if (typeof record.auctionId === "string") return record.auctionId;
	if (typeof record.id === "string") return record.id;
	return undefined;
}

function bidderOf(record: Record<string, unknown>): string | undefined {
	const bid = asRecord(record.bid);
	if (typeof bid?.agent === "string") return bid.agent;
	if (typeof bid?.bidder === "string") return bid.bidder;
	if (typeof record.agent === "string") return record.agent;
	if (typeof record.bidder === "string") return record.bidder;
	return undefined;
}

export function createEmptyCoordinationReplayState(): CoordinationReplayState {
	return {
		tasks: {},
		findings: [],
		decisions: [],
		artifacts: [],
		auctions: {},
		bids: [],
		scores: [],
		bidOutcomes: {},
	};
}

export function replayCoordinationEvents(events: Iterable<unknown>): CoordinationReplayState {
	const state = createEmptyCoordinationReplayState();
	for (const event of events) {
		const record = asRecord(event);
		if (!record || typeof record.type !== "string") continue;
		switch (record.type) {
			case TASK_POSTED: {
				const taskId = taskIdOf(record);
				if (taskId) state.tasks[taskId] = { ...record, id: taskId, status: "open" };
				break;
			}
			case TASK_CLAIMED:
			case TASK_RELEASED:
			case TASK_COMPLETED: {
				const taskId = taskIdOf(record);
				if (!taskId) break;
				state.tasks[taskId] = { ...(state.tasks[taskId] ?? { id: taskId }), ...record, id: taskId };
				break;
			}
			case FINDING_PUBLISHED:
				state.findings.push(record);
				break;
			case DECISION_RECORDED:
				state.decisions.push(record);
				break;
			case ARTIFACT_PUBLISHED:
				state.artifacts.push(record);
				break;
			case AUCTION_OPENED:
			case BID_SUBMITTED:
			case AUCTION_CLOSED: {
				const auctionId = auctionIdOf(record);
				if (auctionId) state.auctions[auctionId] = { ...record, id: auctionId };
				if (record.type === BID_SUBMITTED) state.bids.push(record);
				break;
			}
			case BID_WON:
			case BID_FAILED: {
				const bidder = bidderOf(record);
				if (!bidder) break;
				state.bidOutcomes[bidder] ??= { won: 0, failed: 0 };
				if (record.type === BID_WON) state.bidOutcomes[bidder].won += 1;
				else state.bidOutcomes[bidder].failed += 1;
				break;
			}
			case AGENT_RESULT_SCORED:
				state.scores.push(record);
				break;
		}
	}
	return state;
}
