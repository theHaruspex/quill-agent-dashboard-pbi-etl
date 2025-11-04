import { FactEventRow } from "../domain/types";

export async function postFactEvents(_rows: FactEventRow[]): Promise<{ posted: number }> {
  // Placeholder: would push rows to Power BI via SDK
  return { posted: _rows.length };
}

export default postFactEvents;


