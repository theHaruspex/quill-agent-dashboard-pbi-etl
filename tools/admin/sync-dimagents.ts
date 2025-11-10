/*
  Sync DimAgent from Aloware ring group membership.
  Actions:
    1) DELETE all rows from DimAgent table
    2) INSERT current members from ring group {ALOWARE_RING_GROUP_ID}

  Requirements (.env):
    - POWERBI_TENANT_ID, POWERBI_CLIENT_ID, POWERBI_CLIENT_SECRET
    - POWERBI_WORKSPACE_ID, POWERBI_DATASET_ID
    - ALOWARE_API_TOKEN, ALOWARE_RING_GROUP_ID

  Usage:
    npm run admin:sync-dimagents [-- --dry-run]
*/

try { require("dotenv").config(); } catch (_) {}

import { syncDimAgentsFromRingGroup } from "../../src/services/admin/dimagent.sync.service";
import { logger } from "../../src/config/logger";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  logger.info("[dimagent:cli] starting", { dryRun });

  const result = await syncDimAgentsFromRingGroup({ dryRun, logger });

  logger.info("[dimagent:cli] completed", result);
  if (dryRun) {
    console.log(`Dry run completed. Would insert ${result.fetched} rows.`);
  } else {
    console.log(`DimAgent sync completed. Cleared=${result.cleared} inserted=${result.inserted}`);
  }
}

main().catch((err) => {
  console.error("[dimagent:cli] error:", err?.message || err);
  process.exitCode = 1;
});


