
# Power BI ETL Integration — Repository Design Document (v5)

## Overview

This service ingests events from **Aloware** and **HubSpot**, normalizes them into a consistent schema, performs **idempotency checks** using **DynamoDB**, and pushes the resulting **FactEvent** and related dimension rows into **Power BI** via the **Push Dataset API**.

Aggregation (FactDailyMetric) is handled entirely within Power BI using **DAX measures** — the service only writes atomic event-level data (`FactEvent`) and supporting dimension tables.

The system must support two runtime modes:
- **AWS Lambda**: Production deployment (webhook endpoints)
- **Local Server**: Developer mode (Express/Fastify HTTP server)

---

## Repository Structure

```
/src
  /config
    config.ts
    secrets.ts
    logger.ts

  /domain
    types.ts
    mapping.ts

  /adapters
    aloware.adapter.ts
    hubspot.adapter.ts

  /ingest
    router.ts
    idempotency.ts

  /services
    ensure-dims.service.ts
    post-factevent.service.ts

  /integrations
    /powerbi
      powerbi.sdk.ts
      dataset.repo.ts
      tables.repo.ts
    /idempotency
      dynamo.sdk.ts
      ledger.repo.ts

  /entrypoints
    /lambda/handler.ts
    /server/index.ts

  index.ts
```

---

## High-Level Flow

1. **Webhook Received**
   - HTTP request is handled by either the **Lambda handler** or **Server entrypoint**.
   - The request is normalized into an **IngestEnvelope**.

2. **Adapter Normalization**
   - Depending on the source (`ALOWARE` or `HUBSPOT`), the corresponding adapter is invoked.
   - The adapter emits normalized `FactEventRow[]` objects and dimension hints.

3. **Idempotency Check (DynamoDB)**
   - For each event, a deterministic **deduplication key** is computed (e.g. `ALOWARE:<eventId>`).
   - The system performs a **check-and-mark** in DynamoDB via `ledger.repo.ts`:
     - If new → process event
     - If already seen → skip processing

4. **Ensure Dimensions**
   - For all new events, the service ensures the related **DimDate**, **DimAgent**, **DimMetric**, and **DimShift** rows exist in Power BI tables.

5. **Push to Power BI**
   - Events are batched and pushed to the Power BI Push Dataset using the REST API.

6. **Power BI Layer**
   - Power BI datasets and tables are created/maintained automatically by the system.
   - DAX handles aggregations and rollups (e.g. FactDailyMetric).

---

## Directory Deep Dive

### `/config`
Centralized runtime configuration and secret management.

- **config.ts** — Reads and validates environment variables (dataset IDs, Dynamo table, TTLs, log levels).
- **secrets.ts** — Fetches tokens from the secrets rotator (PBI service principal, HubSpot, Aloware if needed).
- **logger.ts** — Shared logger for structured logging (JSON format, supports Lambda and local environments).

---

### `/domain`
Defines the business-level vocabulary (schema, metrics, enums).

- **types.ts** — Contains interfaces for all key tables:
  - `FactEventRow`
  - `DimAgent`, `DimMetric`, `DimDate`, `DimShift`
  - `IngestEnvelope`
- **mapping.ts** — Declarative mapping between source event types and `MetricID` values (e.g. `outbound_call` → `CALLS`).

---

### `/adapters`
Convert **raw webhooks** into **normalized FactEvent rows**.

- **aloware.adapter.ts** — Parses Aloware webhook payloads, verifies signatures, maps to `CALLS` or `TEXTS`, and emits `FactEventRow[]`.
- **hubspot.adapter.ts** — Parses HubSpot webhooks for outbound emails and case creation, resolves owner identity, and emits `FactEventRow[]`.

Adapters are **pure functions** — they perform no network calls or persistence.

---

### `/ingest`
Handles request routing and idempotency key generation.

- **router.ts** — Converts an incoming HTTP/Lambda event into a typed **IngestEnvelope** (`source`, `headers`, `body`, `receivedAt`).
- **idempotency.ts** — Pure helper for computing deduplication keys and within-batch dedup (drops duplicate rows in a single webhook payload).

---

### `/services`
Implements **business operations** — the *what*, not the *how*.

- **ensure-dims.service.ts** — Verifies that required dimension rows exist in Power BI (inserts missing `DimDate`, `DimAgent`, `DimMetric`, `DimShift` entries).
- **post-factevent.service.ts** — Batches and pushes `FactEvent` rows to Power BI using `tables.repo.ts`. Handles chunking, retries, and telemetry.

---

### `/integrations`
Implements **external I/O logic** — the *how*.

#### `/integrations/powerbi`
Handles all communication with the Power BI REST API.

- **powerbi.sdk.ts** — Low-level wrapper around Power BI REST endpoints. Handles token management, `addRows`, `createDataset`, and table operations.
- **dataset.repo.ts** — Business-facing operations for Power BI datasets (get or create, verify schema, clear dataset).
- **tables.repo.ts** — Handles table-level actions: ensure existence, `addRows`, and `clearRows`.

#### `/integrations/idempotency`
Handles idempotency tracking using DynamoDB.

- **dynamo.sdk.ts** — Minimal DynamoDB client wrapper (configures AWS SDK, retries, error mapping).
- **ledger.repo.ts** — Atomic check-and-mark logic:
  - `checkAndMark(dedupKey): boolean`
  - Uses `PutItem` with `ConditionExpression: attribute_not_exists(pk)`
  - Adds a TTL attribute for automatic expiration
  - Returns `true` if new event, `false` if duplicate

**DynamoDB Table Schema:**

| Attribute | Type | Purpose |
|------------|------|----------|
| `pk` | String | Primary key: `${source}:${eventId}` |
| `seenAt` | String | Timestamp (ISO 8601) |
| `expiresAt` | Number | Epoch seconds for DynamoDB TTL |

---

### `/entrypoints`
Provide runtime bindings for Lambda and local development.

- **/lambda/handler.ts** — AWS Lambda entrypoint. Converts event to `IngestEnvelope`, calls `handleIngest`, maps result to HTTP response.
- **/server/index.ts** — Express/Fastify server for local testing. Routes webhooks to the same orchestrator.

---

### `/index.ts`
The single orchestrator function that ties everything together.

**Responsibilities:**
1. Accepts an `IngestEnvelope`
2. Determines the adapter to use (Aloware or HubSpot)
3. Runs the idempotency check (Dynamo)
4. Ensures dimension rows exist
5. Pushes FactEvent rows to Power BI
6. Logs structured output and exits

**Pseudocode Example:**
```ts
async function handleIngest(envelope: IngestEnvelope) {
  const adapter = envelope.source === 'ALOWARE' ? alowareAdapter : hubspotAdapter;
  const { events, dimHints } = adapter(envelope);

  for (const e of events) {
    const isNew = await ledger.checkAndMark(e.eventId);
    if (!isNew) continue;

    await ensureDims(dimHints);
    await postFactEvent(e);
  }
}
```

---

## Runtime Environment

| Variable | Description |
|-----------|-------------|
| `POWERBI_TENANT_ID` | Azure tenant ID for Power BI authentication |
| `POWERBI_CLIENT_ID` | Azure app/client ID |
| `POWERBI_CLIENT_SECRET` | Service principal secret (fetched via rotator) |
| `POWERBI_DATASET_ID` | Target Power BI dataset |
| `POWERBI_WORKSPACE_ID` | Workspace containing the dataset |
| `DYNAMO_TABLE_NAME` | DynamoDB table for idempotency ledger |
| `DYNAMO_TTL_DAYS` | TTL for dedup keys (e.g., 14 days) |
| `LOG_LEVEL` | Application log verbosity |
| `NODE_ENV` | Runtime mode (local / lambda) |

---

## Benefits of This Design

✅ **Idempotent ingestion:** DynamoDB ensures webhook retries or replays don’t duplicate data.  
✅ **Separation of concerns:** Each layer (adapters, services, integrations) has one clear responsibility.  
✅ **Testability:** Adapters and services are pure and easily unit tested; integrations are mockable.  
✅ **Reusability:** Power BI integration layer is isolated and can be reused for other pipelines.  
✅ **Scalability:** AWS Lambda-friendly, supports parallel webhook ingestion safely.  
✅ **Simplicity:** Lean folder structure—no unnecessary abstractions or files.

---

## DynamoDB vs Power BI Dedup (Design Justification)

- **Atomicity:** Power BI Push Datasets don’t support atomic “check-and-set”; DynamoDB does.  
- **Latency:** Dynamo provides immediate consistency; Power BI tables refresh asynchronously.  
- **Recovery:** Duplicates can be prevented pre-ingest rather than repaired post-fact via DAX.  
- **Cost:** The Dynamo table is minimal and low-cost (a few writes per webhook).

---

## Next Steps

1. Implement DynamoDB table provisioning (TTL enabled on `expiresAt`).  
2. Implement Power BI Push Dataset creation logic.  
3. Integrate webhook authentication (HubSpot + Aloware).  
4. Build initial adapters for HubSpot emails and Aloware calls/texts.  
5. Deploy to AWS Lambda behind API Gateway.

---

*Prepared for:* **eCustom Solutions – CTO & Engineering Leadership**  
*Author:* Derious Vaughn  
*Revision:* v5 — October 2025
