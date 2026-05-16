Make a plan to modify the pi-subagents fork we have here with the following (also plan for the orchestration layer to be an additional pi package).

# Boundary

```text
pi-subagents:
  "Can I safely run, observe, coordinate, and collect from child agents?"

Grail / higher-level orchestrator:
  "What should the agents do, in what order, with what retry/merge/memory policy?"
```

# What belongs in pi-subagents

## 1. Execution coordination

Already mostly there:

- single agent run
- parallel runs
- chains
- async/background jobs
- interrupt/resume/status
- forked vs fresh context
- session/artifact capture
- recursion guard

This is clearly in-scope.

It would also make sense to add more explicit run graph concepts:

```text
root run
├─ scout #1
├─ planner #2
└─ parallel review group
   ├─ reviewer correctness
   ├─ reviewer tests
   └─ reviewer simplicity
```

Each child should have:

- runId
- parentRunId
- rootRunId
- agent
- task
- status
- sessionFile
- artifactPaths
- startedAt/endedAt
- optional budget
- optional coordinationState

This makes hierarchy inspectable instead of implicit.

## 2. Communication coordination

This also belongs in pi-subagents.

You already have pi-intercom/contact_supervisor. That is the right shape: children should not be free-floating agents; they should have a narrow way to ask the parent for decisions.

I'd formalize the communication roles:

- child → parent: "I need a decision"
- child → parent: "I found a blocker"
- child → parent: "Here is an important progress update"
- parent → child: "resume with this answer"
- parent → child: "stop / narrow scope / change task"
- child → parent: "final result"

But I would avoid normal chatty agent-to-agent free-for-all by default. That gets noisy fast. Prefer structured communication.

Example event types:

```ts
"question.asked"
"question.answered"
"decision.recorded"
"artifact.published"
"status.changed"
"child.blocked"
"child.resumed"
"result.submitted"
```

## 3. Shared run-scoped memory / blackboard

This is where memory and coordination overlap.

A run-local blackboard would make sense inside pi-subagents.

Examples:

- "current accepted plan"
- "open questions"
- "decisions made"
- "files investigated"
- "claimed tasks"
- "known risks"
- "child findings"
- "artifact references"

This is not "long-term memory." It is coordination state for one parent/subagent team.

Possible tool shape:

```ts
coordination({
  action: "append",
  scope: "run",
  key: "findings",
  value: {
    agent: "scout",
    summary: "Auth middleware lives in src/auth/middleware.ts",
    confidence: "high"
  }
})
```

Other useful actions:

```text
get
put
append
list
claim
release
publish_artifact
record_decision
ask_supervisor
```

This could be backed by JSONL/files next to the subagent run artifacts.

## 4. Safety/governance

This definitely belongs in pi-subagents, especially if hierarchical delegation is allowed.

Agent frontmatter could eventually support:

```yaml
canDelegate: true
allowedChildAgents: scout, researcher, reviewer
maxSubagentDepth: 2
maxChildren: 4
maxParallelChildren: 2
budgetTokens: 200000
budgetDollars: 2.00
allowedCoordinationActions: ask_supervisor, publish_artifact, record_finding
```

The key principle: hierarchy should be explicit.

Most agents should remain non-orchestrators. A worker should not casually spawn five other workers unless it was explicitly granted delegation rights.

# What probably should not live in core pi-subagents

## 1. Durable semantic memory

I would not put this directly in pi-subagents:

- vector DBs
- cross-session recall
- project knowledge base
- user preference memory
- embedding pipelines
- memory consolidation
- "remember this forever"

Instead, pi-subagents should emit structured events/results that a memory extension can consume.

```text
pi-subagents emits:
  child results, decisions, artifacts, summaries, questions

memory extension decides:
  what is worth remembering long-term
  how to index it
  when to retrieve it
  how to inject it into context
```

## 2. High-level planning/scheduling policy

This should belong to Grail or another orchestrator:

- DAG planning
- task decomposition strategy
- retries
- assignment policy
- "which agent should handle this?"
- merge policy
- conflict resolution
- review gates
- acceptance criteria
- long-running project workflows

pi-subagents can expose the primitives. Grail decides how to use them.

# Suggested layering

```text
Layer 1: pi core
  session, tools, extension hooks, UI, model calls

Layer 2: pi-subagents
  child Pi process/session runtime
  run graph
  chain/parallel/async
  intercom bridge
  status/control
  artifacts
  run-local blackboard
  delegation safety limits

Layer 3: orchestrator package / Grail
  DAGs
  planner-worker-reviewer loops
  retries
  merge/integration policy
  durable orchestration state
  project memory policy
  workflow UI

Layer 4: memory package
  semantic/project/user memory
  indexing
  retrieval
  summarization/consolidation
```

# Concrete feature split

## Good pi-subagents additions

- subagent({ action: "tree" })
- subagent({ action: "events", id })
- subagent({ action: "blackboard", ... })
- subagent({ action: "decision", ... })
- subagent({ action: "claim", ... })
- richer status with child hierarchy
- parent/child/root run IDs everywhere
- explicit delegation permissions in agent frontmatter
- budget/depth enforcement
- structured result schemas

## Better as Grail/orchestrator

- "Given this goal, produce a task DAG"
- "retry failed agents with modified prompts"
- "merge outputs into implementation"
- "run review loop until clean"
- "maintain project plan over days"
- "use memory to choose next actions"
- "decide when to compact/summarize/persist"

# Recommendation

Evolve pi-subagents into a coordination kernel:

> reliable child-agent execution, communication, status, artifacts, run-local shared state, and delegation safety.

Then build Grail or another package on top as the orchestration brain:

> planning, policies, memory strategy, retries, merge decisions, hierarchy strategy.

That way pi-subagents stays broadly useful, while Grail can be opinionated and ambitious.

---

# Also support novel approaches: swarms and market-based coordination

pi-subagents should not hardcode one orchestration style like:

```text
planner → worker → reviewer
```

It should expose a coordination substrate that can support many protocols:

```text
parent-controlled delegation
hierarchical supervisor trees
swarms
debate/tournament patterns
contract-net / auction / market-based task allocation
blackboard systems
critic/voter ensembles
```

The key is to make coordination protocol-pluggable.

## Revised framing

```text
pi-subagents:
  multi-agent runtime + coordination primitives

coordination protocols:
  planner-worker-reviewer
  swarm
  auction
  debate
  tournament
  committee vote
  recursive decomposition
  market allocation

Grail / higher orchestrator:
  chooses/combines protocols for real workflows
```

pi-subagents becomes the "agent operating system" layer, not one particular workflow.

## Primitives needed

### 1. Agent identity + capabilities

```yaml
name: reviewer
capabilities:
  - code_review
  - test_analysis
  - risk_detection
costClass: medium
latencyClass: medium
canEdit: false
canDelegate: false
```

Useful fields:

- capabilities
- tools allowed
- model/cost profile
- max runtime
- can edit?
- can delegate?
- domain tags
- prior reputation/score, optionally external

### 2. Task board / blackboard

Generic coordination store:

```text
tasks
claims
bids
findings
decisions
artifacts
scores
votes
open questions
```

Run-scoped by default.

```ts
coordination({
  action: "post_task",
  task: {
    title: "Find likely auth bugs",
    requiredCapabilities: ["code_review", "auth"],
    reward: 10,
    deadlineMs: 300000
  }
})
```

```ts
coordination({
  action: "append_finding",
  taskId: "t1",
  finding: {
    summary: "Token refresh path may ignore revoked sessions",
    evidence: ["src/auth/refresh.ts:88"],
    confidence: 0.78
  }
})
```

### 3. Event log

Structured events:

```text
task.posted
task.claimed
task.released
bid.submitted
auction.closed
agent.started
agent.completed
finding.published
artifact.published
vote.cast
decision.recorded
budget.exhausted
```

Append-only JSONL next to run artifacts.

### 4. Budget/resource accounting

```json
{
  "budget": {
    "maxDollars": 2.00,
    "maxTokens": 300000,
    "maxChildren": 12,
    "maxParallel": 4
  }
}
```

## Supporting swarms

### Blackboard swarm

```text
parent posts objective
↓
many agents read blackboard
↓
agents publish partial findings
↓
other agents build on findings
↓
aggregator summarizes/chooses
```

### Stigmergy-style swarm

Agents leave "signals":

```text
"this file looks risky"
"investigate this API boundary"
"possible race condition here"
"duplicate of finding f12"
```

### Debate / committee / voting swarm

```text
3 reviewers → 1 judge
5 design proposals → ranker
N bug hypotheses → evaluator
```

## Supporting market-based coordination

### Contract-net / auction flow

```text
1. Orchestrator posts task.
2. Agents submit bids.
3. Auctioneer selects winner(s).
4. Winners execute.
5. Evaluator scores result.
6. Reputation/budget updated.
```

```ts
coordination({
  action: "open_auction",
  task: "Investigate flaky auth tests",
  requiredCapabilities: ["testing", "debugging"],
  reward: 20,
  maxWinners: 2
})
```

```ts
coordination({
  action: "submit_bid",
  auctionId: "a1",
  bid: {
    agent: "debugger",
    estimatedCost: 8,
    estimatedTimeMs: 180000,
    confidence: 0.72,
    plan: "Inspect recent test failures, reproduce locally, identify likely race"
  }
})
```

```ts
coordination({
  action: "award",
  auctionId: "a1",
  winners: ["debugger", "scout"]
})
```

Bid dimensions: estimated token cost, wall time, confidence, required tools, expected artifacts, proposed approach, risk, prior reputation, opportunity cost.

Long-term reputation stays outside core or behind an adapter. Core emits:

```text
agent_result_scored
bid_won
bid_failed
task_accepted
task_rejected
```

## Protocols as plugins

Do not bake swarm/market deeply into the subagent tool as monoliths.

```text
pi-subagents provides:
  run agents, status, events, blackboard, task board, claims, bids,
  artifacts, budget enforcement

protocol packages provide:
  /swarm-review
  /auction-debug
  /committee-plan
  /market-research
```

## Tool surface

```ts
subagent({ action: "tree" })
subagent({ action: "events", id: "run..." })
subagent({ action: "blackboard", op: "append", ... })
subagent({ action: "task", op: "post", ... })
subagent({ action: "claim", taskId: "..." })
subagent({ action: "bid", auctionId: "..." })
subagent({ action: "score", resultId: "..." })
```

Preference:

```text
subagent = execution
coordination = shared state/protocol primitives
```

## Safety constraints

```yaml
canDelegate: true
coordinationModes:
  - blackboard
  - auction
maxChildren: 8
maxParallelChildren: 3
maxAuctions: 2
maxBidsPerAuction: 5
maxRuntimeMs: 600000
budgetTokens: 400000
budgetDollars: 3.00
```

- default children cannot spawn more children
- delegation must be explicitly enabled
- market/swarms run under a root budget
- parent/session UI shows live cost, children, open tasks
- require human approval for edit-capable swarms unless explicitly allowed

## Memory split

1. **Run-local coordination memory** — in/near pi-subagents (blackboards, task boards, bids, findings, decisions, artifacts).
2. **Protocol memory** — in protocol packages (swarm state, auction state, scoring rules, round history, tournament brackets).
3. **Long-term memory/reputation** — separate package. pi-subagents emits enough structured events for it to be built, but does not own it.

# Bottom line

pi-subagents should evolve toward a general coordination kernel:

- agent execution
- run graph
- event log
- shared blackboard
- task board
- claims
- bids/auction primitives
- artifacts
- budgets
- status/control
- parent-child communication
- delegation safety

Strategies like swarm review, market-based task allocation, recursive research marketplace, debate tournament, DAG planner with bidding workers — built as protocol layers on top.
