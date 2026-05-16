# pi-subagents Event Protocol

Every coordination event is JSON and includes the common envelope:

```ts
{
  type: string;
  ts: number;
  runId: string;
  rootRunId: string;
  parentRunId?: string;
  agent?: string;
  index?: number;
}
```

Async run lifecycle events also use the same `runId`, `parentRunId`, and `rootRunId` envelope when written to `events.jsonl`.

## Coordination Events

- `task.posted` - a task was added to the run task board.
- `task.claimed` - an agent claimed a task.
- `task.released` - an agent released a task.
- `task.completed` - an agent marked a task complete.
- `finding.published` - an agent published a finding.
- `decision.recorded` - an agent recorded a decision.
- `artifact.published` - an agent published an artifact reference.
- `question.asked` - a child requested a supervisor decision.
- `question.answered` - the supervisor response returned to the child.
- `child.blocked` - a child reported blocked state.
- `child.resumed` - a blocked child resumed.
- `result.submitted` - a child submitted a result.
- `status.changed` - progress or status changed.
- `auction.opened` - an auction was opened.
- `bid.submitted` - an agent submitted a bid.
- `auction.closed` - an auction was closed or awarded.
- `bid.won` - a bid won an awarded auction.
- `bid.failed` - a bid lost an awarded auction.
- `agent.result.scored` - a result score was recorded.

In-process consumers can subscribe to `SUBAGENT_COORDINATION_EVENT`. Downstream packages can also replay `events.jsonl` from the root run directory.
