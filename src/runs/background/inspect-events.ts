import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { ASYNC_DIR, RESULTS_DIR, type Details } from "../../shared/types.ts";
import { resolveAsyncRunLocation } from "./async-resume.ts";
import { listAsyncRuns } from "./async-status.ts";

interface InspectEventsParams {
	action?: "events";
	id?: string;
	runId?: string;
	dir?: string;
	type?: string;
}

interface InspectEventsDeps {
	asyncDirRoot?: string;
	resultsDir?: string;
}

function matchesType(actual: unknown, pattern: string | undefined): boolean {
	if (!pattern) return true;
	if (typeof actual !== "string") return false;
	if (pattern.endsWith("*")) return actual.startsWith(pattern.slice(0, -1));
	return actual === pattern || actual.startsWith(pattern);
}

function readJsonl(filePath: string, typeFilter: string | undefined): string[] {
	if (!fs.existsSync(filePath)) return [];
	const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter((line) => line.trim());
	const out: string[] = [];
	for (const line of lines) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (!matchesType((parsed as { type?: unknown })?.type, typeFilter)) continue;
		out.push(JSON.stringify(parsed));
	}
	return out;
}

export function inspectSubagentEvents(params: InspectEventsParams, deps: InspectEventsDeps = {}): AgentToolResult<Details> {
	const asyncDirRoot = deps.asyncDirRoot ?? ASYNC_DIR;
	const resultsDir = deps.resultsDir ?? RESULTS_DIR;
	try {
		const location = resolveAsyncRunLocation(params, asyncDirRoot, resultsDir);
		const targetId = location.resolvedId ?? params.id ?? params.runId;
		const runs = listAsyncRuns(asyncDirRoot, { reconcile: false });
		const rootRunId = targetId
			? runs.find((run) => run.id === targetId || run.id.startsWith(targetId))?.rootRunId ?? targetId
			: undefined;
		const dirs = new Set<string>();
		if (location.asyncDir) dirs.add(location.asyncDir);
		if (rootRunId) {
			for (const run of runs) {
				if (run.rootRunId === rootRunId || run.id === rootRunId) dirs.add(run.asyncDir);
			}
		}
		if (dirs.size === 0) {
			return {
				content: [{ type: "text", text: "Async run not found. Provide id or dir." }],
				isError: true,
				details: { mode: "management", results: [] },
			};
		}
		const records = [...dirs]
			.sort()
			.flatMap((dir) => readJsonl(path.join(dir, "events.jsonl"), params.type));
		return {
			content: [{ type: "text", text: records.length ? records.join("\n") : "(no events)" }],
			details: { mode: "management", results: [] },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: message }],
			isError: true,
			details: { mode: "management", results: [] },
		};
	}
}
