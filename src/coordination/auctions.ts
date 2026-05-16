import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { writeAtomicJson } from "../shared/atomic-json.ts";
import { ASYNC_DIR } from "../shared/types.ts";

export interface AuctionState {
	id: string;
	rootRunId: string;
	status: "open" | "closed";
	task?: unknown;
	openedAt: number;
	deadlineMs?: number;
	closedAt?: number;
	bids: Array<Record<string, unknown>>;
	winners?: string[];
	scores?: Array<Record<string, unknown>>;
}

function auctionDir(rootRunId: string, asyncDirRoot = ASYNC_DIR): string {
	return path.join(asyncDirRoot, rootRunId, "coord", "auctions");
}

function auctionPath(rootRunId: string, auctionId: string, asyncDirRoot?: string): string {
	return path.join(auctionDir(rootRunId, asyncDirRoot), `${auctionId}.json`);
}

function readAuction(rootRunId: string, auctionId: string, asyncDirRoot?: string): AuctionState {
	try {
		return JSON.parse(fs.readFileSync(auctionPath(rootRunId, auctionId, asyncDirRoot), "utf-8")) as AuctionState;
	} catch {
		throw new Error(`Auction '${auctionId}' not found.`);
	}
}

function maybeExpire(state: AuctionState): AuctionState {
	if (state.status !== "open" || state.deadlineMs === undefined) return state;
	if (Date.now() < state.openedAt + state.deadlineMs) return state;
	return { ...state, status: "closed", closedAt: state.openedAt + state.deadlineMs };
}

export function openAuction(rootRunId: string, task: unknown, deadlineMs?: number, asyncDirRoot?: string): AuctionState {
	const state: AuctionState = {
		id: randomUUID(),
		rootRunId,
		status: "open",
		task,
		openedAt: Date.now(),
		...(deadlineMs !== undefined ? { deadlineMs } : {}),
		bids: [],
	};
	writeAtomicJson(auctionPath(rootRunId, state.id, asyncDirRoot), state);
	return state;
}

export function submitBid(rootRunId: string, auctionId: string, bid: Record<string, unknown>, asyncDirRoot?: string): AuctionState {
	const state = maybeExpire(readAuction(rootRunId, auctionId, asyncDirRoot));
	if (state.status !== "open") throw new Error(`Auction '${auctionId}' is closed.`);
	const next = { ...state, bids: [...state.bids, { ...bid, ts: Date.now() }] };
	writeAtomicJson(auctionPath(rootRunId, auctionId, asyncDirRoot), next);
	return next;
}

export function awardAuction(rootRunId: string, auctionId: string, winners: string[], asyncDirRoot?: string): AuctionState {
	const state = maybeExpire(readAuction(rootRunId, auctionId, asyncDirRoot));
	if (state.status !== "open") throw new Error(`Auction '${auctionId}' is closed.`);
	const next = { ...state, status: "closed" as const, closedAt: Date.now(), winners: [...winners] };
	writeAtomicJson(auctionPath(rootRunId, auctionId, asyncDirRoot), next);
	return next;
}

export function closeAuction(rootRunId: string, auctionId: string, asyncDirRoot?: string): AuctionState {
	const state = maybeExpire(readAuction(rootRunId, auctionId, asyncDirRoot));
	if (state.status === "closed") return state;
	const next = { ...state, status: "closed" as const, closedAt: Date.now() };
	writeAtomicJson(auctionPath(rootRunId, auctionId, asyncDirRoot), next);
	return next;
}

export function recordScore(rootRunId: string, auctionId: string | undefined, score: Record<string, unknown>, asyncDirRoot?: string): AuctionState | Record<string, unknown> {
	if (!auctionId) return { ...score, ts: Date.now() };
	const state = readAuction(rootRunId, auctionId, asyncDirRoot);
	const next = { ...state, scores: [...(state.scores ?? []), { ...score, ts: Date.now() }] };
	writeAtomicJson(auctionPath(rootRunId, auctionId, asyncDirRoot), next);
	return next;
}

export function listAuctions(rootRunId: string, asyncDirRoot?: string): AuctionState[] {
	const dir = auctionDir(rootRunId, asyncDirRoot);
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir)
		.filter((entry) => entry.endsWith(".json"))
		.map((entry) => JSON.parse(fs.readFileSync(path.join(dir, entry), "utf-8")) as AuctionState)
		.map(maybeExpire);
}
