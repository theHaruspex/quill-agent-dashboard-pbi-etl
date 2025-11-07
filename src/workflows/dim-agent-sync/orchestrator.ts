import { syncDimAgentsFromRingGroup, DimAgentSyncResult } from "../../services/admin/dimagent.sync.service";

export async function runDimAgentSync(): Promise<DimAgentSyncResult> {
  return await syncDimAgentsFromRingGroup();
}

export default runDimAgentSync;


