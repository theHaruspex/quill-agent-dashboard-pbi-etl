import { FactEventRow } from "../domain/types";
import { logger } from "../config/logger";

export async function postFactEvents(_rows: FactEventRow[]): Promise<{ posted: number }> {
  logger.debug("facts:post", { count: _rows.length });
  return { posted: _rows.length };
}

export default postFactEvents;


