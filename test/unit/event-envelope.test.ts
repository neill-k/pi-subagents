import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEventEnvelope, envelopEvent } from "../../src/runs/shared/event-envelope.ts";

describe("event envelope", () => {
	it("stamps child events with run, parent, root, agent, and index", () => {
		const envelope = buildEventEnvelope({
			runId: "child",
			parentRunId: "parent",
			rootRunId: "root",
			agent: "worker",
			index: 2,
		});

		assert.deepEqual(envelope, {
			runId: "child",
			parentRunId: "parent",
			rootRunId: "root",
			agent: "worker",
			index: 2,
		});
	});

	it("preserves event payload while applying canonical identity fields", () => {
		const event = envelopEvent(
			{ runId: "child", parentRunId: "parent", rootRunId: "root", agent: "worker", index: 1 },
			{ type: "subagent.step.started", runId: "wrong", ts: 123 },
		);

		assert.equal(event.type, "subagent.step.started");
		assert.equal(event.runId, "child");
		assert.equal(event.parentRunId, "parent");
		assert.equal(event.rootRunId, "root");
		assert.equal(event.agent, "worker");
		assert.equal(event.index, 1);
		assert.equal(event.ts, 123);
	});
});
