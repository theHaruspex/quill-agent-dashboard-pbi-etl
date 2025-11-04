import { DimHints } from "../domain/types";
import { logger } from "../config/logger";

export async function ensureDims(_hints: DimHints): Promise<void> {
  logger.debug("dims:ensure", {
    agentIds: _hints.agentIds?.length ?? 0,
    dates: _hints.dates?.length ?? 0,
    metrics: _hints.metrics?.length ?? 0,
  });
  return;
}

export default ensureDims;


