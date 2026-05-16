import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { COORDINATION_EVENT_TYPES } from "pi-subagents/event-types";

describe("public event types", () => {
	it("exports every documented coordination event type", () => {
		const docs = fs.readFileSync(path.resolve("docs", "events.md"), "utf-8");
		assert.ok(COORDINATION_EVENT_TYPES.length > 0);
		for (const eventType of COORDINATION_EVENT_TYPES) {
			assert.match(docs, new RegExp(`\\\`${eventType.replaceAll(".", "\\.")}\\\``), `${eventType} should be documented`);
		}
	});

	it("declares the event-types export in package metadata", () => {
		const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8")) as { exports?: Record<string, string>; files?: string[] };
		assert.equal(pkg.exports?.["./event-types"], "./src/coordination/event-types.ts");
		assert.ok(pkg.files?.includes("docs/"));
	});
});
