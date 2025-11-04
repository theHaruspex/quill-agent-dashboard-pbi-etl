export interface AddRowsRequest<T extends Record<string, unknown>> {
  workspaceId: string;
  datasetId: string;
  table: string;
  rows: T[];
}

export async function addRows<T extends Record<string, unknown>>(_req: AddRowsRequest<T>): Promise<{ count: number }> {
  // Placeholder
  return { count: _req.rows.length };
}


