# Project Brief: Quill Agent Dashboard — Data Persistence & DynamoDB Integration

## Overview
The *Quill Agent Dashboard* project powers a Power BI ETL pipeline that aggregates and surfaces operational data across multiple systems (HubSpot, internal logs, and other sources). The ETL repository manages ingestion, transformation, and structured persistence of these datasets before they are visualized inside Power BI.

Our next focus is adding a **robust, DynamoDB-compatible persistence layer** to support:
- Idempotent ingestion runs  
- Deduplication of events from webhook-style inputs  
- Queryable state tracking for pipeline jobs and agents  

This layer will eventually move to a *real AWS DynamoDB* instance, but for development and CI we’ll use **DynamoDB Local** running via Docker.

---

## Architectural Direction

### Existing System (from `powerbi_etl_repo_design_v5.md`)
- The ETL process extracts data from multiple APIs (e.g. HubSpot webhooks) and normalizes it into structured entities.  
- Power BI reads from a curated dataset that is either materialized in a local staging DB or pushed directly to the Power BI API.  
- The codebase includes a modular ETL runner with clearly defined data sources, sinks, and schema definitions.  

### Dashboard Context (from `quill_dashboard_schema_design_doc.md`)
- The dashboard schema defines data models for “agents,” “interactions,” and “metrics” with consistent keys and relationships.  
- Current schema assumes a relational backend (Power BI push datasets), but future iterations will need a more event-driven model to track real-time states, retries, and progress.  

### New DynamoDB Layer
- Introduce a **data access adapter** with a DynamoDB-shaped interface: `put`, `get`, `query`, `delete`, and conditional writes.  
- For now, this adapter should talk to **DynamoDB Local** at `http://localhost:8000` inside Docker.  
- This lets local and CI environments behave as though they’re writing to DynamoDB, while avoiding cloud dependencies.

---

## DynamoDB Local Setup

We’re using **Docker** for local development. DynamoDB Local will be defined in the project’s `docker-compose.yml` like this:

```yaml
services:
  dynamodb-local:
    image: amazon/dynamodb-local:latest
    command: "-jar DynamoDBLocal.jar -sharedDb -dbPath /data"
    ports:
      - "8000:8000"
    volumes:
      - ./docker/dynamodb:/data
    working_dir: /home/dynamodblocal
```

Then, point your AWS SDK at the local endpoint:

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const ddb = new DynamoDBClient({
  region: "us-west-2",
  endpoint: "http://localhost:8000",
  credentials: { accessKeyId: "fakeMyKeyId", secretAccessKey: "fakeSecretAccessKey" },
});

export const ddbDoc = DynamoDBDocumentClient.from(ddb);
```

> **Note:** DynamoDB Local requires no real AWS credentials. TTLs, condition expressions, and item semantics work identically to the live service.

---

## Data Adapter Strategy

The goal is to **design around a consistent DynamoDB-like interface**, regardless of backend.  
During development:
- The app calls the same interface (e.g. `DataStore.put()` or `checkAndMark()`).
- The underlying implementation targets **DynamoDB Local**.
- Later, only the configuration and endpoint change for AWS.

Example interface:

```ts
export interface DataStore {
  put(key: Key, item: Record<string, any>, options?: { ifNotExists?: boolean }): Promise<boolean>;
  get(key: Key): Promise<Record<string, any> | null>;
  query(pk: string, skPrefix?: string): Promise<Record<string, any>[]>;
  delete(key: Key): Promise<void>;
}
```

---

## Why DynamoDB Local (vs SQLite or others)

We considered SQLite as a lightweight local stand-in, but **DynamoDB Local** was chosen because:
- It mirrors **DynamoDB’s actual partition/sort key behavior**.  
- It supports **ConditionExpressions**, **TTL attributes**, and **document structure**, which are key to how the ETL ensures idempotency.  
- It provides realistic testing for **query access patterns** that will exist in production.  
- It’s still lightweight and **runs easily in Docker**.  

SQLite or Postgres remain optional for analytical staging, but **operational state tracking will move to DynamoDB**.

---

## Action Items for Cursor

1. **Add the DynamoDB Local service** to `docker-compose.yml` if not already present.  
2. **Implement the `DataStore` adapter** pattern — start with DynamoDB Local and expose it under `/src/lib/datastore/dynamoAdapter.ts`.  
3. **Add a local test harness** under `/tests/local-dynamo` to verify conditional writes (`attribute_not_exists`) and TTL expiration.  
4. **Keep interfaces DynamoDB-shaped** — no SQL assumptions.  
5. **Use `.env` or `process.env.DATA_BACKEND`** to support swapping backends later.  

---

## Future Direction
When ready for production:
- Replace `endpoint` in the client with the AWS-managed DynamoDB URL.
- Add IAM credentials and environment-based authentication.
- Optionally implement **stream consumers** for real-time data propagation to Power BI or analytics pipelines.
