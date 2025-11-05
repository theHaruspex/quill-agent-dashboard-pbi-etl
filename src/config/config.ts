// Best-effort .env loader without hard dependency at compile time
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv").config();
} catch (_) {
  // no-op if dotenv isn't installed; environment can still be provided externally
}

export interface AppConfig {
  powerBi: {
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    datasetId?: string;
    workspaceId?: string;
  };
  dynamo: {
    tableName?: string;
    ttlDays?: number;
    region?: string;
    endpoint?: string;
  };
  hubspot: {
    privateAppToken?: string;
    clientSecretFallback?: string;
  };
  logLevel: "debug" | "info" | "warn" | "error";
  nodeEnv: "development" | "production" | "test" | string;
}

export function loadConfig(): AppConfig {
  return {
    powerBi: {
      tenantId: process.env.POWERBI_TENANT_ID,
      clientId: process.env.POWERBI_CLIENT_ID,
      clientSecret: process.env.POWERBI_CLIENT_SECRET,
      datasetId: process.env.POWERBI_DATASET_ID,
      workspaceId: process.env.POWERBI_WORKSPACE_ID,
    },
    dynamo: {
      tableName: process.env.DYNAMO_TABLE_NAME,
      ttlDays: process.env.DYNAMO_TTL_DAYS ? Number(process.env.DYNAMO_TTL_DAYS) : undefined,
      region: process.env.DYNAMO_REGION,
      endpoint: process.env.DYNAMO_ENDPOINT,
    },
    hubspot: {
      privateAppToken: process.env.HUBSPOT_PRIVATE_APP_TOKEN,
      clientSecretFallback: process.env.HUBSPOT_CLIENT_SECRET,
    },
    logLevel: (process.env.LOG_LEVEL as AppConfig["logLevel"]) || "info",
    nodeEnv: (process.env.NODE_ENV as AppConfig["nodeEnv"]) || "development",
  };
}


