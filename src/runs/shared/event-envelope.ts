import {
	SUBAGENT_CHILD_AGENT_ENV,
	SUBAGENT_CHILD_INDEX_ENV,
	SUBAGENT_PARENT_RUN_ID_ENV,
	SUBAGENT_ROOT_RUN_ID_ENV,
	SUBAGENT_RUN_ID_ENV,
} from "./pi-args.ts";

export interface EventEnvelopeContext {
	runId: string;
	parentRunId?: string;
	rootRunId?: string;
	agent?: string;
	index?: number;
}

export interface EventEnvelope {
	runId: string;
	parentRunId?: string;
	rootRunId?: string;
	agent?: string;
	index?: number;
}

function parseIndex(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function resolveEventEnvelopeContext(input: Partial<EventEnvelopeContext> & { runId?: string } = {}): EventEnvelopeContext {
	const runId = input.runId ?? process.env[SUBAGENT_RUN_ID_ENV];
	if (!runId) {
		throw new Error("runId is required to build a subagent event envelope.");
	}
	return {
		runId,
		parentRunId: input.parentRunId ?? process.env[SUBAGENT_PARENT_RUN_ID_ENV],
		rootRunId: input.rootRunId ?? process.env[SUBAGENT_ROOT_RUN_ID_ENV] ?? runId,
		agent: input.agent ?? process.env[SUBAGENT_CHILD_AGENT_ENV],
		index: input.index ?? parseIndex(process.env[SUBAGENT_CHILD_INDEX_ENV]),
	};
}

export function buildEventEnvelope(ctx: EventEnvelopeContext): EventEnvelope {
	return {
		runId: ctx.runId,
		...(ctx.parentRunId ? { parentRunId: ctx.parentRunId } : {}),
		rootRunId: ctx.rootRunId ?? ctx.runId,
		...(ctx.agent ? { agent: ctx.agent } : {}),
		...(ctx.index !== undefined ? { index: ctx.index } : {}),
	};
}

export function envelopEvent<T extends Record<string, unknown>>(ctx: EventEnvelopeContext, event: T): T & EventEnvelope {
	const envelope = buildEventEnvelope(ctx);
	return {
		...event,
		...envelope,
	} as T & EventEnvelope;
}
