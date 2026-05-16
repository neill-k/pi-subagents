import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { appendJsonl } from "../shared/artifacts.ts";
import { writeAtomicJson } from "../shared/atomic-json.ts";
import { ASYNC_DIR } from "../shared/types.ts";

export interface CoordinationMeta {
	runId?: string;
	agent?: string;
	index?: number;
	ts?: number;
}

export interface CoordinationTask {
	id?: string;
	title: string;
	requiredCapabilities?: string[];
	reward?: number;
	deadlineMs?: number;
	[key: string]: unknown;
}

export interface CoordinationRecord {
	id: string;
	ts: number;
	rootRunId: string;
	runId?: string;
	agent?: string;
	index?: number;
	[key: string]: unknown;
}

function coordDir(rootRunId: string, asyncDirRoot = ASYNC_DIR): string {
	return path.join(asyncDirRoot, rootRunId, "coord");
}

function coordFile(rootRunId: string, name: string, asyncDirRoot?: string): string {
	return path.join(coordDir(rootRunId, asyncDirRoot), name);
}

function now(meta?: CoordinationMeta): number {
	return meta?.ts ?? Date.now();
}

function makeRecord(rootRunId: string, meta: CoordinationMeta | undefined, payload: Record<string, unknown>): CoordinationRecord {
	return {
		id: typeof payload.id === "string" && payload.id ? payload.id : randomUUID(),
		ts: now(meta),
		rootRunId,
		...(meta?.runId ? { runId: meta.runId } : {}),
		...(meta?.agent ? { agent: meta.agent } : {}),
		...(meta?.index !== undefined ? { index: meta.index } : {}),
		...payload,
	} as CoordinationRecord;
}

function appendRecord(rootRunId: string, fileName: string, record: CoordinationRecord, asyncDirRoot?: string): CoordinationRecord {
	const filePath = coordFile(rootRunId, fileName, asyncDirRoot);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	appendJsonl(filePath, JSON.stringify(record));
	return record;
}

function readJsonl(filePath: string): CoordinationRecord[] {
	if (!fs.existsSync(filePath)) return [];
	const records: CoordinationRecord[] = [];
	for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
		if (!line.trim()) continue;
		try {
			records.push(JSON.parse(line) as CoordinationRecord);
		} catch {}
	}
	return records;
}

function taskShadowPath(rootRunId: string, taskId: string, asyncDirRoot?: string): string {
	return path.join(coordDir(rootRunId, asyncDirRoot), "tasks", `${taskId}.json`);
}

function readTaskShadow(rootRunId: string, taskId: string, asyncDirRoot?: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(fs.readFileSync(taskShadowPath(rootRunId, taskId, asyncDirRoot), "utf-8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

export function appendBlackboard(rootRunId: string, scope: string, key: string, value: unknown, meta?: CoordinationMeta, asyncDirRoot?: string): CoordinationRecord {
	return appendRecord(rootRunId, "blackboard.jsonl", makeRecord(rootRunId, meta, { scope, key, value, op: "append" }), asyncDirRoot);
}

export function getBlackboard(rootRunId: string, scope: string, key: string, asyncDirRoot?: string): CoordinationRecord | undefined {
	return listBlackboard(rootRunId, scope, key, asyncDirRoot).at(-1);
}

export function listBlackboard(rootRunId: string, scope?: string, keyPrefix?: string, asyncDirRoot?: string): CoordinationRecord[] {
	return readJsonl(coordFile(rootRunId, "blackboard.jsonl", asyncDirRoot)).filter((record) => {
		if (scope && record.scope !== scope) return false;
		if (keyPrefix && typeof record.key === "string" && !record.key.startsWith(keyPrefix)) return false;
		return true;
	});
}

export function postTask(rootRunId: string, task: CoordinationTask, meta?: CoordinationMeta, asyncDirRoot?: string): CoordinationRecord {
	const taskId = task.id ?? randomUUID();
	const record = makeRecord(rootRunId, meta, { ...task, id: taskId, status: "open" });
	writeAtomicJson(taskShadowPath(rootRunId, taskId, asyncDirRoot), record);
	return appendRecord(rootRunId, "tasks.jsonl", record, asyncDirRoot);
}

export function claimTask(rootRunId: string, taskId: string, agent: string, runId: string, meta?: CoordinationMeta, asyncDirRoot?: string): CoordinationRecord {
	const claimPath = path.join(coordDir(rootRunId, asyncDirRoot), "tasks", `${taskId}.claim`);
	fs.mkdirSync(path.dirname(claimPath), { recursive: true });
	let fd: number | undefined;
	try {
		fd = fs.openSync(claimPath, "wx");
		fs.writeFileSync(fd, JSON.stringify({ agent, runId, ts: now(meta) }));
	} catch {
		throw new Error(`Task '${taskId}' is already claimed.`);
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
	}
	const previous = readTaskShadow(rootRunId, taskId, asyncDirRoot) ?? { id: taskId };
	const next = { ...previous, id: taskId, status: "claimed", claimedBy: agent, claimedRunId: runId, claimedAt: now(meta) };
	writeAtomicJson(taskShadowPath(rootRunId, taskId, asyncDirRoot), next);
	return appendRecord(rootRunId, "tasks.jsonl", makeRecord(rootRunId, meta, { taskId, status: "claimed", agent, runId }), asyncDirRoot);
}

export function releaseTask(rootRunId: string, taskId: string, agent: string, runId: string, reason?: string, meta?: CoordinationMeta, asyncDirRoot?: string): CoordinationRecord {
	const claimPath = path.join(coordDir(rootRunId, asyncDirRoot), "tasks", `${taskId}.claim`);
	fs.rmSync(claimPath, { force: true });
	const previous = readTaskShadow(rootRunId, taskId, asyncDirRoot) ?? { id: taskId };
	writeAtomicJson(taskShadowPath(rootRunId, taskId, asyncDirRoot), { ...previous, status: "open", releasedBy: agent, releasedRunId: runId, releaseReason: reason });
	return appendRecord(rootRunId, "tasks.jsonl", makeRecord(rootRunId, meta, { taskId, status: "released", agent, runId, reason }), asyncDirRoot);
}

export function completeTask(rootRunId: string, taskId: string, agent: string, runId: string, meta?: CoordinationMeta, asyncDirRoot?: string): CoordinationRecord {
	const previous = readTaskShadow(rootRunId, taskId, asyncDirRoot) ?? { id: taskId };
	writeAtomicJson(taskShadowPath(rootRunId, taskId, asyncDirRoot), { ...previous, status: "completed", completedBy: agent, completedRunId: runId, completedAt: now(meta) });
	return appendRecord(rootRunId, "tasks.jsonl", makeRecord(rootRunId, meta, { taskId, status: "completed", agent, runId }), asyncDirRoot);
}

export function listTasks(rootRunId: string, asyncDirRoot?: string): CoordinationRecord[] {
	return readJsonl(coordFile(rootRunId, "tasks.jsonl", asyncDirRoot));
}

export function recordFinding(rootRunId: string, finding: Record<string, unknown>, meta?: CoordinationMeta, asyncDirRoot?: string): CoordinationRecord {
	return appendRecord(rootRunId, "findings.jsonl", makeRecord(rootRunId, meta, finding), asyncDirRoot);
}

export function listFindings(rootRunId: string, asyncDirRoot?: string): CoordinationRecord[] {
	return readJsonl(coordFile(rootRunId, "findings.jsonl", asyncDirRoot));
}

export function recordDecision(rootRunId: string, decision: Record<string, unknown>, meta?: CoordinationMeta, asyncDirRoot?: string): CoordinationRecord {
	return appendRecord(rootRunId, "decisions.jsonl", makeRecord(rootRunId, meta, decision), asyncDirRoot);
}

export function listDecisions(rootRunId: string, asyncDirRoot?: string): CoordinationRecord[] {
	return readJsonl(coordFile(rootRunId, "decisions.jsonl", asyncDirRoot));
}

export function publishArtifact(rootRunId: string, artifact: Record<string, unknown>, meta?: CoordinationMeta, asyncDirRoot?: string): CoordinationRecord {
	return appendRecord(rootRunId, "artifacts.jsonl", makeRecord(rootRunId, meta, artifact), asyncDirRoot);
}

export function listArtifacts(rootRunId: string, asyncDirRoot?: string): CoordinationRecord[] {
	return readJsonl(coordFile(rootRunId, "artifacts.jsonl", asyncDirRoot));
}

export function coordinationEventsPath(rootRunId: string, asyncDirRoot?: string): string {
	return path.join(asyncDirRoot ?? ASYNC_DIR, rootRunId, "events.jsonl");
}
