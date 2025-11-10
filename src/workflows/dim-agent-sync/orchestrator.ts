import { syncDimAgentsFromRingGroup, DimAgentSyncResult, DimAgentSyncOptions } from "../../services/admin/dimagent.sync.service";

export async function runDimAgentSync(options?: DimAgentSyncOptions): Promise<DimAgentSyncResult> {
  return await syncDimAgentsFromRingGroup(options);
}

export default runDimAgentSync;



