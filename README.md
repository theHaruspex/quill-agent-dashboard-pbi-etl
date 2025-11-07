# Quill Agent Dashboard ETL

TypeScript service that ingests events from Aloware/HubSpot, dedupes via DynamoDB, and pushes normalized rows into Power BI Push Datasets. See `docs/` for design docs.

## Quickstart
- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`

## NPM Scripts

All available scripts in `package.json`:

### Development & Build
- **`npm run dev`**: Start development server with hot reload (`tsx watch`). Runs `src/entrypoints/server/index.ts` on `http://localhost:3000`. Auto-loads `.env` from root.
- **`npm run build`**: Compile TypeScript (`tsc`) to `dist/`. Outputs JavaScript and type definitions.
- **`npm run start`**: Production start (runs compiled `dist/index.js`). Requires `npm run build` first.
- **`npm run typecheck`**: Type-check TypeScript without emitting files (`tsc --noEmit`). Useful for CI or pre-commit hooks.

### Testing & Harness
- **`npm run harness:aloware`**: Run Aloware webhook samples through the ETL workflow with verbose logging.
  - Options:
    - `--dir <path>`: Directory containing `.json` webhook files (default: `data/aloware-webhooks`)
    - `--limit <n>`: Process only first N files
    - `--pattern <glob>`: Filter files by pattern (e.g., `"_aloware.json"`)
  - Examples:
    - `npm run harness:aloware -- --dir data/aloware-webhooks --limit 25`
    - `npm run harness:aloware -- --pattern "_aloware.json" --limit 10`
  - Requirements: `.env` with Power BI and DynamoDB credentials. Outputs detailed logs per file and a summary.

### DynamoDB Tools
- **`npm run dynamo:local`**: Bootstrap DynamoDB Local via Docker and create the idempotency ledger table.
  - Starts Docker container if `--start-docker` flag is provided
  - Creates `QuillIdempotencyLedger` table with TTL enabled
  - Requirements: Docker installed, `DYNAMO_TABLE_NAME` and `DYNAMO_TTL_DAYS` in `.env`
  - Usage: `npm run dynamo:local` or `npm run dynamo:local -- --start-docker`
- **`npm run dynamo:clear-ledger`**: Clear all rows from the DynamoDB idempotency ledger table.
  - Deletes and recreates the table (Power BI Push Datasets don't support row-level deletes)
  - Requirements: `DYNAMO_TABLE_NAME`, `DYNAMO_REGION` (or `DYNAMO_ENDPOINT` for local), credentials in `.env`

### Power BI Tools
- **`npm run pbi:create-dataset`**: Create a new Power BI Push Dataset in the configured workspace.
  - Creates dataset with tables: `FactEvent`, `DimAgent`, `DimMetric`, `DimDate`, `DimShift`
  - Options:
    - `--name <name>`: Dataset name (default: `Quill_Agent_Realtime`)
  - Requirements: `.env` with `POWERBI_TENANT_ID`, `POWERBI_CLIENT_ID`, `POWERBI_CLIENT_SECRET`, `POWERBI_WORKSPACE_ID`
  - Outputs: Dataset ID (save to `POWERBI_DATASET_ID` in `.env`)
- **`npm run pbi:clear-table`**: Delete all rows from a Power BI table.
  - Options:
    - `--table <name>`: Table name (default: `FactEvent`)
    - `--dataset <id>`: Dataset ID (default: `POWERBI_DATASET_ID` from `.env`)
  - Requirements: `.env` with Power BI credentials and `POWERBI_WORKSPACE_ID`
  - Examples:
    - `npm run pbi:clear-table -- --table FactEvent`
    - `npm run pbi:clear-table -- --table DimAgent --dataset bc15d797-...`

### Admin Tools
- **`npm run admin:sync-dimagents`**: Sync `DimAgent` table from Aloware ring group membership.
  - Actions:
    1. DELETE all rows from `DimAgent` table
    2. Fetch current members from ring group `ALOWARE_RING_GROUP_ID` (default: 8465)
    3. INSERT members as `DimAgent` rows (AgentID, AgentName, Email, TimezoneIANA="", ActiveFlag=true)
  - Requirements: `.env` with:
    - Power BI: `POWERBI_TENANT_ID`, `POWERBI_CLIENT_ID`, `POWERBI_CLIENT_SECRET`, `POWERBI_WORKSPACE_ID`, `POWERBI_DATASET_ID`
    - Aloware: `ALOWARE_API_TOKEN`, `ALOWARE_RING_GROUP_ID` (defaults to 8465)
  - Uses Power BI SDK push sink for rate-limited inserts

## Source code structure (what we built and why)

```
src/
  config/
    config.ts
    logger.ts
  domain/
    types.ts
    mapping.ts
  adapters/
    aloware.adapter.ts
    hubspot.adapter.ts
  ingest/
    router.ts
    idempotency.ts
  services/
    ensure-dims.service.ts
    post-factevent.service.ts
  integrations/
    powerbi/
      powerbi.sdk.ts
      dataset.repo.ts
      tables.repo.ts
    idempotency/
      dynamo.sdk.ts
      ledger.repo.ts
  entrypoints/
    lambda/handler.ts
    server/index.ts
  index.ts
```

## Workflows architecture (planned)

We’re formalizing a workflows-first layout that separates the data-plane (per-event ingest) from the control-plane (explicit bulk/replace jobs). This improves clarity, deployability (one Lambda per workflow), and limits blast radius.

### Data-plane vs Control-plane
- **Data-plane (ingest)**: Per-event processing with minimal side effects. Inline “ensure” operations only for keys needed by the current event (e.g., upsert `DimDate` if missing). No destructive table ops.
- **Control-plane (sync/seed)**: Explicit, authenticated jobs that clear-and-replace or bulk mutate tables (e.g., `DimAgent` refresh from Aloware ring group 8465, monthly `DimMetric` updates). Low frequency, auditable, reversible.

### Target layout
```
src/
  workflows/
    ingest/
      orchestrator.ts        # current handleIngest moved here (no behavior change)
      ensure.ts              # inline ensures (e.g., upsert-if-missing DimDate)
      entrypoints/
        server.ts            # dev route: POST /webhook/:source
        lambda.ts            # API Gateway handler
    dim-agent-sync/          # control-plane
      orchestrator.ts        # clear + repopulate DimAgent from ring group 8465
      entrypoints/
        lambda.ts            # signed webhook/API
      schema.ts              # optional request/auth schema
    dim-metric-sync/         # control-plane
      orchestrator.ts        # validate payload, audit/version, clear + repopulate
      entrypoints/
        lambda.ts
      schema.ts              # payload + auth
    dim-date-seed/           # control-plane (rare)
      orchestrator.ts        # seed/extend calendar range
      entrypoints/
        lambda.ts
    dim-shift-sync/          # control-plane
      orchestrator.ts        # rules → rows
      entrypoints/
        lambda.ts
      schema.ts              # rules
```

Shared libraries remain where they are and are used by all workflows:
- `src/services/*` reusable units (e.g., `post-factevent`, `ensure-dims`).
- `src/integrations/*` wraps SDKs (Power BI, Dynamo) for all workflows.
- `src/config/*`, `src/domain/*` are shared types and configuration.

Migration plan (incremental, no behavior change):
1) Move `handleIngest` to `src/workflows/ingest/orchestrator.ts` and wire `entrypoints/` for server and lambda.  
2) Keep `ensure-dims.service.ts` and `post-factevent.service.ts` as-is; call from the orchestrator.  
3) Add control-plane workflows (`dim-agent-sync`, `dim-metric-sync`, etc.) as distinct Lambda entrypoints with strong auth.  

### `src/config/`
- `config.ts`: Loads runtime configuration from environment. Includes a safe, optional `.env` bootstrap (via `dotenv` if available) so root `.env` files are picked up in local/dev and lambda simulation.
- `logger.ts`: Minimal structured logger with level control (`debug|info|warn|error`). Used by other modules as needed.

### `src/domain/`
- `types.ts`: Canonical types used across the service.
  - `IngestEnvelope`: Normalized HTTP/Lambda request wrapper.
  - `FactEventRow`: Single atomic event written to Power BI.
  - `DimAgent`, `DimMetric`, `DimDate`, `DimShift`: Dimension models matching the docs’ star schema.
  - `MetricID`: `CALLS | TEXTS | EMAILS | CASES`.
  - `DimHints`: Hints emitted by adapters listing which dimension keys must exist (e.g., agent IDs, dates, metrics) before posting facts.
- `mapping.ts`: Declarative mapping helpers (e.g., map Aloware/HubSpot event types to `MetricID`).

### `src/adapters/`
- `aloware.adapter.ts`: Parses Aloware webhooks into `FactEventRow[]` (outbound-only as required).
  - Filters to outbound events (via event name or `direction === 2`).
  - Determines metric (`CALLS` vs `TEXTS`).
  - Computes `eventId` deterministically from source `body.id`.
  - Computes timezone-aware `factDateKey` (YYYY-MM-DD) using `contact.timezone` when present; falls back to UTC.
  - Emits `DimHints` for efficient dimension upserts.
- `hubspot.adapter.ts`: Present as a stub. We’ll implement later (HubSpot webhooks often require enrichment fetches before producing facts).

### `src/ingest/`
- `router.ts`: Small helper to convert a simple HTTP-like request into an `IngestEnvelope` (used by entrypoints or tests).
- `idempotency.ts`: Pure helpers for deduplication at process scope.
  - `computeDedupKey(source, event)`: Builds a ledger key.
  - `withinBatchDedup(rows)`: Drops duplicate `eventId`s inside a single request payload.

### `src/services/`
- `ensure-dims.service.ts`: Ensures required dimension rows exist in Power BI before posting facts. Currently stubbed; will use the Power BI SDK repos when wiring schemas.
- `post-factevent.service.ts`: Batches and posts `FactEventRow[]` into Power BI (stub today). We’ll map fact rows to the configured dataset/table names and call the SDK’s `postRows()` with idempotency keys.

### `src/integrations/powerbi/`
- `powerbi.sdk.ts`: Placeholder shim to isolate SDK usage. We’ll swap in calls to the vendored Power BI SDK (`sdks/power-bi-sdk`) for auth, dataset/table ops, and posting rows.
- `dataset.repo.ts`: Business-facing operations for dataset existence/creation (stub).
- `tables.repo.ts`: Table-level operations (add rows, clear rows; stub).

### `src/integrations/idempotency/`
- `dynamo.sdk.ts`: Placeholder client wrapper (configuration surface for AWS DynamoDB).
- `ledger.repo.ts`: `checkAndMark(dedupKey)` scaffold (returns `true` for now). This will perform atomic conditional writes in DynamoDB to prevent duplicates.

### `src/entrypoints/`
- `server/index.ts`: Minimal Node `http` dev server.
  - `GET /health` — health probe.
  - `POST /webhook/aloware` or `/webhook/hubspot` — routes to orchestrator with `IngestEnvelope`.
  - Loads `.env` automatically in dev.
- `lambda/handler.ts`: Lambda-style handler that parses the incoming event into an `IngestEnvelope` and calls the orchestrator. Also attempts `.env` loading when run locally.

### `src/index.ts` (orchestrator)
- `handleIngest(envelope)`: Main flow used by both entrypoints.
  1. Choose adapter (`ALOWARE` vs `HUBSPOT`).
  2. Run adapter → `events`, `dimHints`.
  3. `withinBatchDedup(events)` for process-local dedup.
  4. `ensureDims(dimHints)` to guarantee dimension rows exist in Power BI.
  5. `postFactEvents(uniqueEvents)` to write facts.
  6. Returns `{ processed, posted }` for observability.

## Running locally
- Dev server: `npm run dev`
  - Health: `GET http://localhost:3000/health`
  - Webhooks: `POST http://localhost:3000/webhook/aloware` (body can be raw Aloware payload or `{ parsedBody: { body, event } }`).

### Aloware webhook harness (verbose)
- Run samples through the current workflow with detailed logs:
  - `npm run harness:aloware -- --dir data/aloware-webhooks --limit 25`
  - `npm run harness:aloware -- --dir data/aloware-data --pattern "_aloware.json" --limit 10`
- Output includes event name, direction/type, timestamps, agent, timezone, and `{ processed, posted }` per file, plus a summary.

## Environment
- Copy `env.example` to `.env` at the repo root and fill in values. The app auto-loads `.env` in local/server and lambda entrypoints.
  - Power BI: `POWERBI_TENANT_ID`, `POWERBI_CLIENT_ID`, `POWERBI_CLIENT_SECRET`, `POWERBI_WORKSPACE_ID`, `POWERBI_DATASET_ID`
  - DynamoDB: `DYNAMO_TABLE_NAME`, `DYNAMO_TTL_DAYS`
  - HubSpot (future adapter/enrichment): `HUBSPOT_PRIVATE_APP_TOKEN` (preferred) or `HUBSPOT_CLIENT_SECRET`

## Notes
- Aloware: We currently emit facts only for outbound events (requirement). Inbound events are ignored by the adapter.
- HubSpot: Adapter is deferred until requirements are finalized; reference enrichment patterns are captured in the vendored SDKs and the separate reference repo.

## ETL workflow: function chain and responsibilities

High-level chain for a single webhook request:

1) Entry (runtime-specific)
- Local dev: `src/entrypoints/server/index.ts` receives `POST /webhook/:source`
- Lambda: `src/entrypoints/lambda/handler.ts` receives API Gateway event

2) Normalize request
- Both entrypoints build an `IngestEnvelope` (source, headers, body, receivedAt). This step is trivial; the `src/ingest/router.ts` helper exists to avoid duplicating envelope-building in tests or other callers.

3) Orchestrate
- `src/index.ts` → `handleIngest(envelope)` is the orchestrator.
  - Chooses adapter: `ALOWARE` → `alowareAdapter`, `HUBSPOT` → `hubspotAdapter` (stub for now)
  - Runs adapter to produce:
    - `events: FactEventRow[]` (atomic facts to be written)
    - `dimHints: { agentIds, dates, metrics }` (keys of dimension rows that must exist)
  - Runs `withinBatchDedup(events)` to drop duplicate `eventId`s within a single webhook handling (no-op if only one event)
  - Calls `ensureDims(dimHints)` to upsert required dimension rows in Power BI (stub now; will call SDK)
  - Calls `postFactEvents(events)` to write fact rows into Power BI (stub now; will call SDK)
  - Returns `{ processed, posted }`

4) Cross-request idempotency (to be wired next)
- `src/integrations/idempotency/ledger.repo.ts` will implement `checkAndMark(dedupKey)` using DynamoDB conditional writes
- Purpose: guard against provider retries/concurrent deliveries producing duplicate facts across separate requests

Why both within-batch and cross-request dedup?
- Within-batch protects against accidental duplicates an adapter might emit inside one request
- Cross-request protects against duplicate deliveries from the source (retries, race conditions)

## Why `src/integrations/*` instead of directly using `sdks/*` everywhere?

Think of `sdks/*` as general-purpose libraries and `src/integrations/*` as this app’s boundary layer that adapts those libraries to project-specific needs.

- `sdks/power-bi-sdk`: a reusable client (auth, retries, rate limits, batching). It knows nothing about our dataset/table names or our dimension semantics.
- `src/integrations/powerbi/*`: thin, app-specific wrappers:
  - `powerbi.sdk.ts`: a shim surface to construct/configure the client and centralize options (base URL, logging, rate limits). This keeps the rest of the app decoupled from a specific SDK constructor shape and makes mocking/testing easy.
  - `dataset.repo.ts`: business-facing helpers (e.g., ensure dataset exists with our exact schema, clear dataset for re-seeding).
  - `tables.repo.ts`: table-level helpers (e.g., add rows to `FactEvent`, upsert dims) with our naming conventions.

This layering gives us:
- Isolation: if we swap SDK versions or migrate to Fabric RTI later, we change a small surface.
- Testability: repositories are easy to stub without pulling in the whole SDK.
- Cohesion: the rest of the app calls a small set of app-centric methods.

Similar rationale for idempotency (DynamoDB):
- We don’t vendor an AWS SDK in `sdks/`. Instead, `src/integrations/idempotency/*` provides a small wrapper (`dynamo.sdk.ts`) and a repository (`ledger.repo.ts`) that encapsulate our table schema and conditional-write logic. The rest of the app calls `checkAndMark(dedupKey)` without knowing AWS details.

Rule of thumb:
- `sdks/*` = reusable, external-style libraries
- `src/integrations/*` = this app’s adapter layer for those libraries (project-specific behaviors, schemas, naming)
