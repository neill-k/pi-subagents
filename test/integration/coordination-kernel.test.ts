import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import {
	AGENT_RESULT_SCORED,
	AUCTION_CLOSED,
	AUCTION_OPENED,
	BID_FAILED,
	BID_SUBMITTED,
	BID_WON,
	DECISION_RECORDED,
	FINDING_PUBLISHED,
	QUESTION_ANSWERED,
	QUESTION_ASKED,
	TASK_CLAIMED,
	TASK_POSTED,
} from "../../src/coordination/event-types.ts";
import { replayCoordinationEvents } from "../../src/coordination/replay.ts";
import { executeAsyncChain, executeAsyncSingle, isAsyncAvailable } from "../../src/runs/background/async-execution.ts";
import { createSubagentExecutor } from "../../src/runs/foreground/subagent-executor.ts";
import {
	SUBAGENT_CHILD_AGENT_ENV,
	SUBAGENT_CHILD_INDEX_ENV,
	SUBAGENT_ROOT_RUN_ID_ENV,
	SUBAGENT_RUN_ID_ENV,
} from "../../src/runs/shared/pi-args.ts";
import { ASYNC_DIR, RESULTS_DIR, SUBAGENT_COORDINATION_EVENT } from "../../src/shared/types.ts";
import type { MockPi } from "../support/helpers.ts";
import { createMockPi, createTempDir, events, makeAgent, makeMinimalCtx, removeTempDir } from "../support/helpers.ts";

const available = isAsyncAvailable();

const artifactConfig = {
	enabled: false,
	includeInput: false,
	includeOutput: false,
	includeJsonl: false,
	includeMetadata: false,
	cleanupDays: 7,
};

function uniqueId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function createRecordingEventBus() {
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	const emitted: Array<{ channel: string; payload: unknown }> = [];
	return {
		emitted,
		on(channel: string, handler: (payload: unknown) => void) {
			const channelListeners = listeners.get(channel) ?? new Set();
			channelListeners.add(handler);
			listeners.set(channel, channelListeners);
			return () => {
				channelListeners.delete(handler);
			};
		},
		emit(channel: string, payload: unknown) {
			emitted.push({ channel, payload });
			for (const handler of listeners.get(channel) ?? []) handler(payload);
		},
	};
}

async function waitForResult(id: string, timeoutMs = 10_000): Promise<void> {
	const resultPath = path.join(RESULTS_DIR, `${id}.json`);
	const deadline = Date.now() + timeoutMs;
	while (!fs.existsSync(resultPath)) {
		if (Date.now() > deadline) assert.fail(`Timed out waiting for async result file: ${resultPath}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

function cleanupRun(id: string): void {
	fs.rmSync(path.join(ASYNC_DIR, id), { recursive: true, force: true });
	fs.rmSync(path.join(RESULTS_DIR, `${id}.json`), { force: true });
}

function readRunEvents(id: string): Array<Record<string, unknown>> {
	const eventsPath = path.join(ASYNC_DIR, id, "events.jsonl");
	return fs.readFileSync(eventsPath, "utf-8")
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function makeExecutor(tempDir: string, bus = createRecordingEventBus(), agents = [makeAgent("worker")]) {
	return {
		bus,
		executor: createSubagentExecutor({
			pi: { events: bus, getSessionName: () => undefined },
			state: { baseCwd: tempDir, currentSessionId: null, asyncJobs: new Map(), foregroundControls: new Map(), lastForegroundControlId: null },
			config: {},
			asyncByDefault: false,
			tempArtifactsDir: tempDir,
			getSubagentSessionRoot: () => tempDir,
			expandTilde: (p: string) => p,
			discoverAgents: () => ({ agents }),
		}),
	};
}

async function withChildEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(env)) {
		previous.set(key, process.env[key]);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		return await fn();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

function parseToolJson(result: { content: Array<{ text?: string }> }): Record<string, unknown> {
	return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

function countTypes(records: Array<Record<string, unknown>>): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const record of records) {
		if (typeof record.type !== "string") continue;
		counts[record.type] = (counts[record.type] ?? 0) + 1;
	}
	return counts;
}

function reputation(events: Array<Record<string, unknown>>): Record<string, { wins: number; losses: number }> {
	const scores: Record<string, { wins: number; losses: number }> = {};
	for (const event of events) {
		if (event.type !== BID_WON && event.type !== BID_FAILED) continue;
		const bid = event.bid && typeof event.bid === "object" ? event.bid as Record<string, unknown> : {};
		const agent = typeof bid.agent === "string" ? bid.agent : undefined;
		if (!agent) continue;
		scores[agent] ??= { wins: 0, losses: 0 };
		if (event.type === BID_WON) scores[agent].wins += 1;
		else scores[agent].losses += 1;
	}
	return scores;
}

describe("coordination kernel integration", { skip: !available ? "jiti not available" : undefined }, () => {
	let tempDir: string;
	let mockPi: MockPi;
	const runIds: string[] = [];

	before(() => {
		mockPi = createMockPi();
		mockPi.install();
	});

	after(() => {
		mockPi.uninstall();
	});

	beforeEach(() => {
		tempDir = createTempDir("pi-subagent-coordination-kernel-");
		mockPi.reset();
	});

	afterEach(() => {
		for (const id of runIds.splice(0)) cleanupRun(id);
		removeTempDir(tempDir);
	});

	it("run-tree and inspect-events expose root identity and filtered step events", async () => {
		const rootId = uniqueId("tree-root");
		const plannerId = uniqueId("tree-planner");
		const scoutsId = uniqueId("tree-scouts");
		const inspectId = uniqueId("inspect-events");
		runIds.push(rootId, plannerId, scoutsId, inspectId);
		const bus = createRecordingEventBus();
		const common = {
			ctx: { pi: { events: bus }, cwd: tempDir, currentSessionId: "session-tree" },
			artifactConfig,
			shareEnabled: false,
			maxSubagentDepth: 3,
		};

		mockPi.onCall({ output: "root ready" });
		executeAsyncSingle(rootId, { agent: "root", task: "Start", agentConfig: makeAgent("root"), ...common });
		await waitForResult(rootId);

		mockPi.onCall({ output: "planner ready" });
		executeAsyncSingle(plannerId, { agent: "planner", task: "Plan", agentConfig: makeAgent("planner"), parentRunId: rootId, rootRunId: rootId, ...common });
		await waitForResult(plannerId);

		mockPi.onCall({ output: "scout a" });
		mockPi.onCall({ output: "scout b" });
		executeAsyncChain(scoutsId, {
			chain: [{ parallel: [{ agent: "scout-a", task: "A" }, { agent: "scout-b", task: "B" }] }],
			agents: [makeAgent("scout-a"), makeAgent("scout-b")],
			parentRunId: plannerId,
			rootRunId: rootId,
			...common,
		});
		await waitForResult(scoutsId);

		for (const [id, parentRunId] of [[rootId, undefined], [plannerId, rootId], [scoutsId, plannerId]] as const) {
			const runEvents = readRunEvents(id);
			assert.ok(runEvents.length > 0, `${id} should have events`);
			assert.equal(runEvents.every((event) => event.rootRunId === rootId), true);
			assert.equal(runEvents.every((event) => event.parentRunId === parentRunId), true);
		}

		const { executor } = makeExecutor(tempDir, bus, [makeAgent("root"), makeAgent("planner"), makeAgent("scout-a"), makeAgent("scout-b")]);
		const tree = await executor.execute("tree", { action: "tree", id: rootId }, new AbortController().signal, undefined, makeMinimalCtx(tempDir));
		const treeText = tree.content[0]?.text ?? "";
		assert.match(treeText, /root/);
		assert.match(treeText, /planner/);
		assert.match(treeText, /scout-a, scout-b/);
		assert.ok(treeText.indexOf(rootId) < treeText.indexOf(plannerId));
		assert.ok(treeText.indexOf(plannerId) < treeText.indexOf(scoutsId));

		mockPi.onCall({
			jsonl: [
				events.toolStart("read", { path: "a.ts" }),
				events.toolResult("read", "file"),
				events.assistantMessage("done"),
			],
		});
		executeAsyncSingle(inspectId, { agent: "worker", task: "Inspect events", agentConfig: makeAgent("worker"), ...common });
		await waitForResult(inspectId);
		const filtered = await executor.execute("events", { action: "events", id: inspectId, type: "subagent.step.*" }, new AbortController().signal, undefined, makeMinimalCtx(tempDir));
		const filteredEvents = (filtered.content[0]?.text ?? "")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { type?: string });
		assert.ok(filteredEvents.length > 0);
		assert.equal(filteredEvents.every((event) => event.type?.startsWith("subagent.step.")), true);
	});

	it("coordination actions round-trip through the store, event stream, and replay", async () => {
		const rootRunId = uniqueId("coord-root");
		runIds.push(rootRunId);
		const childA = `${rootRunId}-a`;
		const childB = `${rootRunId}-b`;
		const { executor } = makeExecutor(tempDir, createRecordingEventBus(), [
			makeAgent("child-a", { allowedCoordinationActions: ["claim", "record_finding"] }),
			makeAgent("child-b", { allowedCoordinationActions: ["record_decision"] }),
		]);
		const ctx = makeMinimalCtx(tempDir);

		await executor.execute("post", { action: "coordination", coord: { op: "task.post", rootRunId, task: { id: "task-1", title: "Investigate" } } }, new AbortController().signal, undefined, ctx);
		await withChildEnv({
			[SUBAGENT_CHILD_AGENT_ENV]: "child-a",
			[SUBAGENT_CHILD_INDEX_ENV]: "0",
			[SUBAGENT_RUN_ID_ENV]: childA,
			[SUBAGENT_ROOT_RUN_ID_ENV]: rootRunId,
		}, async () => {
			await executor.execute("claim", { action: "coordination", coord: { op: "task.claim", taskId: "task-1" } }, new AbortController().signal, undefined, ctx);
			await executor.execute("finding", { action: "coordination", coord: { op: "finding.publish", finding: { taskId: "task-1", summary: "Found signal", confidence: 0.9 } } }, new AbortController().signal, undefined, ctx);
			await executor.execute("blackboard", { action: "coordination", coord: { op: "blackboard.append", scope: "findings", key: "task-1", value: "Found signal" } }, new AbortController().signal, undefined, ctx);
		});
		await withChildEnv({
			[SUBAGENT_CHILD_AGENT_ENV]: "child-b",
			[SUBAGENT_CHILD_INDEX_ENV]: "1",
			[SUBAGENT_RUN_ID_ENV]: childB,
			[SUBAGENT_ROOT_RUN_ID_ENV]: rootRunId,
		}, async () => {
			const blackboard = await executor.execute("blackboard-list", { action: "coordination", coord: { op: "blackboard.list", scope: "findings" } }, new AbortController().signal, undefined, ctx);
			assert.match(blackboard.content[0]?.text ?? "", /Found signal/);
			await executor.execute("decision", { action: "coordination", coord: { op: "decision.record", decision: { topic: "task-1", choice: "accept", rationale: "Evidence is sufficient" } } }, new AbortController().signal, undefined, ctx);
		});

		const records = readRunEvents(rootRunId);
		assert.deepEqual(records.map((event) => event.type).filter((type) => [
			TASK_POSTED,
			TASK_CLAIMED,
			FINDING_PUBLISHED,
			DECISION_RECORDED,
		].includes(String(type))), [TASK_POSTED, TASK_CLAIMED, FINDING_PUBLISHED, DECISION_RECORDED]);
		const taskShadow = JSON.parse(fs.readFileSync(path.join(ASYNC_DIR, rootRunId, "coord", "tasks", "task-1.json"), "utf-8"));
		assert.equal(taskShadow.status, "claimed");
		assert.equal(taskShadow.claimedBy, "child-a");
		assert.match(fs.readFileSync(path.join(ASYNC_DIR, rootRunId, "coord", "findings.jsonl"), "utf-8"), /Found signal/);
		assert.match(fs.readFileSync(path.join(ASYNC_DIR, rootRunId, "coord", "decisions.jsonl"), "utf-8"), /Evidence is sufficient/);

		const replayed = replayCoordinationEvents(records);
		assert.equal(replayed.tasks["task-1"]?.status, "claimed");
		assert.equal(replayed.findings[0]?.summary, "Found signal");
		assert.equal(replayed.decisions[0]?.choice, "accept");
	});

	it("contact_supervisor calls mirror question events into async events.jsonl", async () => {
		const id = uniqueId("intercom-events");
		runIds.push(id);
		mockPi.onCall({
			jsonl: [
				events.toolStart("contact_supervisor", { reason: "need_decision", message: "Choose A or B" }),
				events.toolResult("contact_supervisor", "Use A"),
				events.assistantMessage("Continuing with A"),
			],
		});
		executeAsyncSingle(id, {
			agent: "worker",
			task: "Need a decision",
			agentConfig: makeAgent("worker"),
			ctx: { pi: { events: createRecordingEventBus() }, cwd: tempDir, currentSessionId: "session-intercom" },
			artifactConfig,
			shareEnabled: false,
			maxSubagentDepth: 2,
		});
		await waitForResult(id);
		const records = readRunEvents(id);
		const asked = records.find((event) => event.type === QUESTION_ASKED);
		const answered = records.find((event) => event.type === QUESTION_ANSWERED);
		assert.equal(asked?.rootRunId, id);
		assert.equal(asked?.agent, "worker");
		assert.equal(asked?.message, "Choose A or B");
		assert.equal(answered?.message, "Use A");
	});

	it("auction actions emit disk and in-process reputation streams for downstream consumers", async () => {
		const rootRunId = uniqueId("auction-root");
		runIds.push(rootRunId);
		const bus = createRecordingEventBus();
		const fixturePackage = JSON.parse(fs.readFileSync(path.resolve("test/fixtures/downstream-consumer/package.json"), "utf-8"));
		assert.equal(fixturePackage.peerDependencies["pi-subagents"], "*");
		const fixture = await import(pathToFileURL(path.resolve("test/fixtures/downstream-consumer/index.js")).href) as {
			createConsumer(events: typeof bus, eventName: string): { summary(): string[]; dispose(): void };
		};
		const consumer = fixture.createConsumer(bus, SUBAGENT_COORDINATION_EVENT);
		try {
			const { executor } = makeExecutor(tempDir, bus, [
				makeAgent("bidder-a", { allowedCoordinationActions: ["submit_bid", "score"] }),
				makeAgent("bidder-b", { allowedCoordinationActions: ["submit_bid"] }),
				makeAgent("bidder-c", { allowedCoordinationActions: ["submit_bid"] }),
			]);
			const ctx = makeMinimalCtx(tempDir);
			const opened = await executor.execute("auction-open", { action: "coordination", coord: { op: "auction.open", rootRunId, task: { title: "Fix bug" } } }, new AbortController().signal, undefined, ctx);
			const auctionId = String(parseToolJson(opened).id);
			for (const agent of ["bidder-a", "bidder-b", "bidder-c"]) {
				await withChildEnv({
					[SUBAGENT_CHILD_AGENT_ENV]: agent,
					[SUBAGENT_RUN_ID_ENV]: `${rootRunId}-${agent}`,
					[SUBAGENT_ROOT_RUN_ID_ENV]: rootRunId,
				}, async () => {
					await executor.execute(`bid-${agent}`, { action: "coordination", coord: { op: "auction.bid", auctionId, bid: { agent, cost: agent === "bidder-a" ? 1 : 2 } } }, new AbortController().signal, undefined, ctx);
				});
			}
			await executor.execute("auction-award", { action: "coordination", coord: { op: "auction.award", rootRunId, auctionId, winners: ["bidder-a"] } }, new AbortController().signal, undefined, ctx);
			await withChildEnv({
				[SUBAGENT_CHILD_AGENT_ENV]: "bidder-a",
				[SUBAGENT_RUN_ID_ENV]: `${rootRunId}-bidder-a`,
				[SUBAGENT_ROOT_RUN_ID_ENV]: rootRunId,
			}, async () => {
				await executor.execute("score", { action: "coordination", coord: { op: "score.record", auctionId, score: { agent: "bidder-a", success: true } } }, new AbortController().signal, undefined, ctx);
			});

			const auctionState = JSON.parse(fs.readFileSync(path.join(ASYNC_DIR, rootRunId, "coord", "auctions", `${auctionId}.json`), "utf-8"));
			assert.equal(auctionState.status, "closed");
			assert.deepEqual(auctionState.winners, ["bidder-a"]);
			assert.equal(auctionState.scores.length, 1);
			const diskEvents = readRunEvents(rootRunId);
			const counts = countTypes(diskEvents);
			assert.equal(counts[AUCTION_OPENED], 1);
			assert.equal(counts[BID_SUBMITTED], 3);
			assert.equal(counts[AUCTION_CLOSED], 1);
			assert.equal(counts[BID_WON], 1);
			assert.equal(counts[BID_FAILED], 2);
			assert.equal(counts[AGENT_RESULT_SCORED], 1);
			const emittedEvents = bus.emitted
				.filter((entry) => entry.channel === SUBAGENT_COORDINATION_EVENT)
				.map((entry) => entry.payload as Record<string, unknown>);
			assert.deepEqual(reputation(emittedEvents), reputation(diskEvents));
			assert.deepEqual(consumer.summary(), emittedEvents.map((event) => event.type as string));
		} finally {
			consumer.dispose();
		}
	});
});
