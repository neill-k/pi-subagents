import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { AgentConfig } from "../../src/agents/agents.ts";
import { reserveDelegation } from "../../src/runs/shared/delegation-guard.ts";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
	}
});

function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-delegation-guard-"));
	tempDirs.push(dir);
	return dir;
}

function agent(name: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name,
		description: name,
		systemPrompt: "",
		systemPromptMode: "replace",
		inheritProjectContext: false,
		inheritSkills: false,
		source: "project",
		filePath: `/tmp/${name}.md`,
		...overrides,
	};
}

describe("delegation guard", () => {
	it("rejects non-delegating parent agents", () => {
		const result = reserveDelegation({
			agents: [agent("planner", { canDelegate: false }), agent("worker")],
			childAgents: ["worker"],
			runId: "run",
			rootRunId: "root",
			asyncDirRoot: tempDir(),
			env: { PI_SUBAGENT_CHILD_AGENT: "planner" },
		});

		assert.equal(result.ok, false);
		assert.match(result.error ?? "", /canDelegate=false/);
	});

	it("rejects child agents outside allowedChildAgents", () => {
		const result = reserveDelegation({
			agents: [agent("planner", { canDelegate: true, allowedChildAgents: ["scout"] }), agent("worker")],
			childAgents: ["worker"],
			runId: "run",
			rootRunId: "root",
			asyncDirRoot: tempDir(),
			env: { PI_SUBAGENT_CHILD_AGENT: "planner" },
		});

		assert.equal(result.ok, false);
		assert.match(result.error ?? "", /can only spawn scout/);
	});

	it("tracks maxChildren across reservations and releases parallel count only", () => {
		const asyncDirRoot = tempDir();
		const agents = [agent("delegate", { canDelegate: true, maxChildren: 2 }), agent("worker")];
		const first = reserveDelegation({
			agents,
			childAgents: ["worker", "worker"],
			runId: "run",
			rootRunId: "root",
			asyncDirRoot,
			env: { PI_SUBAGENT_CHILD_AGENT: "delegate" },
		});
		assert.equal(first.ok, true);
		first.reservation?.release();

		const second = reserveDelegation({
			agents,
			childAgents: ["worker"],
			runId: "run",
			rootRunId: "root",
			asyncDirRoot,
			env: { PI_SUBAGENT_CHILD_AGENT: "delegate" },
		});
		assert.equal(second.ok, false);
		assert.match(second.error ?? "", /maxChildren=2/);
	});
});
