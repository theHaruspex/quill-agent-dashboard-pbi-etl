import assert from "node:assert/strict";
import { syncDimAgentsFromRingGroup, DimAgentRow } from "../src/services/admin/dimagent.sync.service";
import type { Logger } from "../src/config/logger";

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function setupEnv() {
  process.env.POWERBI_WORKSPACE_ID = "workspace";
  process.env.POWERBI_DATASET_ID = "dataset";
  process.env.POWERBI_TENANT_ID = "tenant";
  process.env.POWERBI_CLIENT_ID = "client";
  process.env.POWERBI_CLIENT_SECRET = "secret";
  process.env.ALOWARE_RING_GROUP_ID = "8465";
  process.env.ALOWARE_API_TOKEN = "token";
}

async function testHappyPath() {
  setupEnv();
  const calls: string[] = [];
  const rows: DimAgentRow[] = [
    { AgentID: "1", AgentName: "Agent One", Email: "one@example.com", TimezoneIANA: "", ActiveFlag: true },
    { AgentID: "2", AgentName: "Agent Two", Email: "two@example.com", TimezoneIANA: "", ActiveFlag: true },
  ];

  const result = await syncDimAgentsFromRingGroup({
    logger: noopLogger,
    dependencies: {
      fetchMembers: async () => {
        calls.push("fetch");
        return rows;
      },
      getAccessToken: async () => {
        calls.push("token");
        return "access";
      },
      clearRows: async () => {
        calls.push("clear");
      },
      pushRows: async () => {
        calls.push("push");
      },
    },
  });

  assert.deepEqual(calls, ["fetch", "token", "clear", "push"], "call order should fetch→token→clear→push");
  assert.equal(result.cleared, true);
  assert.equal(result.inserted, rows.length);
  assert.equal(result.fetched, rows.length);
  assert.equal(result.dryRun, false);
}

async function testDryRunSkipsMutations() {
  setupEnv();
  const calls: string[] = [];

  const result = await syncDimAgentsFromRingGroup({
    dryRun: true,
    logger: noopLogger,
    dependencies: {
      fetchMembers: async () => {
        calls.push("fetch");
        return [
          { AgentID: "1", AgentName: "Agent One", Email: "one@example.com", TimezoneIANA: "", ActiveFlag: true },
        ];
      },
      getAccessToken: async () => {
        calls.push("token");
        return "access";
      },
      clearRows: async () => {
        calls.push("clear");
      },
      pushRows: async () => {
        calls.push("push");
      },
    },
  });

  assert.deepEqual(calls, ["fetch"], "dry run should only fetch members");
  assert.equal(result.cleared, false);
  assert.equal(result.inserted, 0);
  assert.equal(result.fetched, 1);
  assert.equal(result.dryRun, true);
}

async function testNoRowsSkipsInsert() {
  setupEnv();
  const calls: string[] = [];

  const result = await syncDimAgentsFromRingGroup({
    logger: noopLogger,
    dependencies: {
      fetchMembers: async () => {
        calls.push("fetch");
        return [];
      },
      getAccessToken: async () => {
        calls.push("token");
        return "access";
      },
      clearRows: async () => {
        calls.push("clear");
      },
      pushRows: async () => {
        calls.push("push");
      },
    },
  });

  assert.deepEqual(calls, ["fetch", "token", "clear"], "no rows should skip push");
  assert.equal(result.cleared, true);
  assert.equal(result.inserted, 0);
  assert.equal(result.fetched, 0);
  assert.equal(result.dryRun, false);
}

async function run() {
  await testHappyPath();
  await testDryRunSkipsMutations();
  await testNoRowsSkipsInsert();
  console.log("dimagent-sync tests passed");
}

run().catch((err) => {
  console.error("dimagent-sync tests failed", err);
  process.exitCode = 1;
});
