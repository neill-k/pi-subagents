import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "node:test";
import { awardAuction, openAuction, submitBid } from "../../src/coordination/auctions.ts";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-auction-"));
	tempDirs.push(dir);
	return dir;
}

describe("auction store", () => {
	it("records concurrent bids and allows only one award", async () => {
		const asyncDirRoot = tempDir();
		const auction = openAuction("root", { title: "Pick agent" }, undefined, asyncDirRoot);

		await Promise.all(
			["scout", "worker", "reviewer"].map(async (name) => {
				submitBid("root", auction.id, { agent: name, amount: 1 }, asyncDirRoot);
			}),
		);

		const awarded = awardAuction("root", auction.id, ["worker"], asyncDirRoot);
		assert.equal(awarded.status, "closed");
		assert.deepEqual(awarded.winners, ["worker"]);
		assert.equal(awarded.bids.length, 3);
		assert.throws(() => awardAuction("root", auction.id, ["scout"], asyncDirRoot), /closed/);
	});

	it("closes expired auctions before accepting bids", () => {
		const asyncDirRoot = tempDir();
		const auction = openAuction("root", { title: "Expired" }, 0, asyncDirRoot);
		assert.throws(() => submitBid("root", auction.id, { agent: "worker" }, asyncDirRoot), /closed/);
	});
});
