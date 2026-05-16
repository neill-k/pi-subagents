import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	appendBlackboard,
	claimTask,
	getBlackboard,
	listTasks,
	postTask,
	recordDecision,
	recordFinding,
} from "../../src/coordination/store.ts";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-coord-store-"));
	tempDirs.push(dir);
	return dir;
}

describe("coordination store", () => {
	it("round-trips blackboard, tasks, findings, and decisions", () => {
		const asyncDirRoot = tempDir();
		appendBlackboard("root", "findings", "auth.flow", { ok: true }, { runId: "run", agent: "scout" }, asyncDirRoot);
		assert.deepEqual(getBlackboard("root", "findings", "auth.flow", asyncDirRoot)?.value, { ok: true });

		const task = postTask("root", { id: "task-1", title: "Inspect auth" }, { runId: "run" }, asyncDirRoot);
		assert.equal(task.id, "task-1");
		const claim = claimTask("root", "task-1", "scout", "run", { runId: "run", agent: "scout" }, asyncDirRoot);
		assert.equal(claim.status, "claimed");

		recordFinding("root", { summary: "Found auth middleware", taskId: "task-1" }, { runId: "run", agent: "scout" }, asyncDirRoot);
		recordDecision("root", { topic: "auth", choice: "reuse middleware" }, { runId: "run" }, asyncDirRoot);
		assert.equal(listTasks("root", asyncDirRoot).length, 2);
	});

	it("allows exactly one winner for concurrent task claims", async () => {
		const asyncDirRoot = tempDir();
		postTask("root", { id: "task-1", title: "Race" }, { runId: "run" }, asyncDirRoot);

		const attempts = await Promise.all(
			Array.from({ length: 10 }, async (_, index) => {
				try {
					return claimTask("root", "task-1", `agent-${index}`, `run-${index}`, { runId: `run-${index}` }, asyncDirRoot);
				} catch (error) {
					return error;
				}
			}),
		);

		const winners = attempts.filter((entry) => !(entry instanceof Error));
		const failures = attempts.filter((entry) => entry instanceof Error);
		assert.equal(winners.length, 1);
		assert.equal(failures.length, 9);
	});
});
