import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoDocClient } from "./dynamo.sdk";
import { loadConfig } from "../../config/config";

export async function checkAndMark(dedupKey: string): Promise<boolean> {
  const cfg = loadConfig();
  const tableName = cfg.dynamo.tableName;
  if (!tableName) throw new Error("DYNAMO_TABLE_NAME is required for idempotency");

  const ttlDays = cfg.dynamo.ttlDays ?? 14;
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + ttlDays * 86400;

  const doc = getDynamoDocClient();
  try {
    await doc.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: dedupKey,
          seenAt: new Date().toISOString(),
          expiresAt,
        },
        ConditionExpression: "attribute_not_exists(pk)",
      })
    );
    return true; // first time seen
  } catch (err: any) {
    const name = err?.name || "";
    if (name === "ConditionalCheckFailedException") {
      return false; // duplicate
    }
    throw err;
  }
}


