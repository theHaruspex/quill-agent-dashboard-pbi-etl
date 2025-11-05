/*
  Clear the DynamoDB idempotency ledger by deleting and recreating the table (local-friendly).
  Usage:
    npx tsx tools/dynamo/clear-ledger.ts
*/

try { require("dotenv").config(); } catch (_) {}

import {
  DynamoDBClient,
  DeleteTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
  CreateTableCommand,
} from "@aws-sdk/client-dynamodb";

function buildClient(): DynamoDBClient {
  const endpoint = process.env.DYNAMO_ENDPOINT || "http://localhost:8000";
  const region = process.env.DYNAMO_REGION || "us-west-2";
  return new DynamoDBClient({
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "fakeMyKeyId",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "fakeSecretAccessKey",
    },
  });
}

async function recreate(): Promise<void> {
  const tableName = process.env.DYNAMO_TABLE_NAME || "QuillIdempotencyLedger";
  const client = buildClient();
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`[ledger] deleting table: ${tableName}`);
    await client.send(new DeleteTableCommand({ TableName: tableName }));
    // Wait briefly for deletion
    await new Promise((r) => setTimeout(r, 1000));
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) throw e;
  }
  console.log(`[ledger] creating table: ${tableName}`);
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    })
  );
  console.log("[ledger] ready");
}

recreate().catch((e) => {
  console.error("[ledger] error:", e.message);
  process.exitCode = 1;
});


