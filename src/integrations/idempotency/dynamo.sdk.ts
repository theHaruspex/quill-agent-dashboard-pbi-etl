import { loadConfig } from "../../config/config";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient as DDB } from "@aws-sdk/client-dynamodb";

let cachedDoc: DynamoDBDocumentClient | null = null;

export function getDynamoDocClient(): DynamoDBDocumentClient {
  if (cachedDoc) return cachedDoc;
  const cfg = loadConfig();
  const clientConfig: any = {
    region: cfg.dynamo.region || process.env.AWS_REGION || "us-west-2",
  };
  if (cfg.dynamo.endpoint) {
    clientConfig.endpoint = cfg.dynamo.endpoint;
    clientConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "fakeMyKeyId",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "fakeSecretAccessKey",
    };
  }
  const ddb: DynamoDBClient = new DDB(clientConfig);
  cachedDoc = DynamoDBDocumentClient.from(ddb);
  return cachedDoc;
}


