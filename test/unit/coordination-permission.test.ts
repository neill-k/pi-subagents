import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { AgentConfig } from "../../src/agents/agents.ts";
import { handleCoordinationAction } from "../../src/coordination/actions.ts";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-coord-permission-"));
	tempDirs.push(dir);
	return dir;
}

function agent(name: string, allowedCoordinationActions?: string[]): AgentConfig {
	return {
		name,
		description: name,
		systemPrompt: "",
		systemPromptMode: "replace",
		inheritProjectContext: false,
		inheritSkills: false,
		source: "project",
		filePath: `/tmp/${name}.md`,
		allowedCoordinationActions,
	};
}

describe("coordination permissions", () => {
	it("rejects disallowed coordination operations without writing events", () => {
		const asyncDirRoot = tempDir();
		const result = handleCoordinationAction(
			{ action: "coordination", coord: { op: "task.post", rootRunId: "root", task: { title: "Nope" } } },
			{
				agents: [agent("worker", ["record_finding"])],
				asyncDirRoot,
				env: {
					PI_SUBAGENT_CHILD_AGENT: "worker",
					PI_SUBAGENT_RUN_ID: "run",
					PI_SUBAGENT_ROOT_RUN_ID: "root",
				},
			},
		);

		assert.equal(result.isError, true);
		assert.match(result.content[0]?.text ?? "", /lacks allowedCoordinationActions/);
		assert.equal(fs.existsSync(path.join(asyncDirRoot, "root", "events.jsonl")), false);
	});
});
