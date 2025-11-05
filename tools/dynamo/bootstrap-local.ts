/*
  DynamoDB Local bootstrap
  - Optionally starts a local Docker container (if --start-docker)
  - Creates the idempotency ledger table if missing
  Usage:
    npx tsx tools/dynamo/bootstrap-local.ts
    npx tsx tools/dynamo/bootstrap-local.ts --start-docker
*/

// Best-effort .env load
try { require("dotenv").config(); } catch (_) {}

import { exec as _exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";
import { ListTablesCommand } from "@aws-sdk/client-dynamodb";

const exec = promisify(_exec);

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getLocalDockerVolume(): string {
  const vol = path.resolve(process.cwd(), "docker/dynamodb");
  try { fs.mkdirSync(vol, { recursive: true }); } catch {}
  return vol;
}

async function startDockerIfRequested(): Promise<void> {
  if (!hasFlag("--start-docker")) return;
  const volume = getLocalDockerVolume();
  const cmd = `docker run -d --rm --name dynamodb-local -p 8000:8000 -v "${volume}:/data" amazon/dynamodb-local -jar DynamoDBLocal.jar -sharedDb -dbPath /data`;
  console.log("[dynamo] starting Docker container:", cmd);
  try {
    const { stdout, stderr } = await exec(cmd);
    if (stdout) console.log(stdout.trim());
    if (stderr) console.log(stderr.trim());
  } catch (e: any) {
    console.log("[dynamo] docker run failed (is Docker installed/running?)", e.message);
  }
}

function buildClient(): DynamoDBClient {
  const endpoint = process.env.DYNAMO_ENDPOINT || "http://localhost:8000";
  const region = process.env.DYNAMO_REGION || "us-west-2";
  const client = new DynamoDBClient({
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "fakeMyKeyId",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "fakeSecretAccessKey",
    },
  });
  return client;
}

async function ensureTableExists(): Promise<void> {
  const tableName = process.env.DYNAMO_TABLE_NAME || "QuillIdempotencyLedger";
  const client = buildClient();
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`[dynamo] table exists: ${tableName}`);
    return;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }

  console.log(`[dynamo] creating table: ${tableName}`);
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    })
  );
  console.log("[dynamo] table created");
}

async function waitForReady(timeoutMs = 15000): Promise<void> {
  const client = buildClient();
  const started = Date.now();
  let attempt = 0;
  while (Date.now() - started < timeoutMs) {
    attempt++;
    try {
      await client.send(new ListTablesCommand({ Limit: 1 }));
      console.log(`[dynamo] ready after ${attempt} attempt(s)`);
      return;
    } catch (e: any) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("DynamoDB Local did not become ready in time");
}

async function main() {
  console.log("[dynamo] endpoint:", process.env.DYNAMO_ENDPOINT || "http://localhost:8000");
  await startDockerIfRequested();
  try {
    await waitForReady();
  } catch (e: any) {
    console.log("[dynamo] wait for ready failed:", e.message);
  }
  await ensureTableExists();
  console.log("[dynamo] done");
}

main().catch((e) => {
  console.error("[dynamo] error:", e.message);
  process.exitCode = 1;
});


