export const TASK_POSTED = "task.posted";
export const TASK_CLAIMED = "task.claimed";
export const TASK_RELEASED = "task.released";
export const TASK_COMPLETED = "task.completed";
export const FINDING_PUBLISHED = "finding.published";
export const DECISION_RECORDED = "decision.recorded";
export const ARTIFACT_PUBLISHED = "artifact.published";
export const QUESTION_ASKED = "question.asked";
export const QUESTION_ANSWERED = "question.answered";
export const CHILD_BLOCKED = "child.blocked";
export const CHILD_RESUMED = "child.resumed";
export const RESULT_SUBMITTED = "result.submitted";
export const STATUS_CHANGED = "status.changed";
export const AUCTION_OPENED = "auction.opened";
export const BID_SUBMITTED = "bid.submitted";
export const AUCTION_CLOSED = "auction.closed";
export const BID_WON = "bid.won";
export const BID_FAILED = "bid.failed";
export const AGENT_RESULT_SCORED = "agent.result.scored";

export const COORDINATION_EVENT_TYPES = [
	TASK_POSTED,
	TASK_CLAIMED,
	TASK_RELEASED,
	TASK_COMPLETED,
	FINDING_PUBLISHED,
	DECISION_RECORDED,
	ARTIFACT_PUBLISHED,
	QUESTION_ASKED,
	QUESTION_ANSWERED,
	CHILD_BLOCKED,
	CHILD_RESUMED,
	RESULT_SUBMITTED,
	STATUS_CHANGED,
	AUCTION_OPENED,
	BID_SUBMITTED,
	AUCTION_CLOSED,
	BID_WON,
	BID_FAILED,
	AGENT_RESULT_SCORED,
] as const;
