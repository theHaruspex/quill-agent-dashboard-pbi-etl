/*
  Aloware webhook harness
  - Runs a variable number of sample webhook files through the orchestrator
  - Very verbose console logging for inspection
  Usage:
    npx tsx tools/harness/run-aloware.ts --dir docs/aloware-webhooks --limit 25
    npx tsx tools/harness/run-aloware.ts --dir "docs/aloware data" --pattern "*_aloware.json"
*/

// Best-effort .env load
try { require("dotenv").config(); } catch (_) {}

import { promises as fs } from "fs";
import path from "path";
import type { IngestEnvelope } from "../../src/domain/types";

interface Args {
  dir?: string;
  limit?: number;
  pattern?: string; // substring match
}

function parseArgs(): Args {
  const out: Args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") out.dir = argv[++i];
    else if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--pattern") out.pattern = argv[++i];
  }
  return out;
}

async function listFilesRecursive(targetDir: string): Promise<string[]> {
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const p = path.join(targetDir, e.name);
    if (e.isDirectory()) {
      const nested = await listFilesRecursive(p);
      files.push(...nested);
    } else {
      files.push(p);
    }
  }
  return files;
}

async function run() {
  const args = parseArgs();
  // Default to very verbose logging for harness runs unless user overrides
  if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = "debug";
  const defaultDirs = [
    path.resolve("data/aloware-webhooks"),
    path.resolve("data/aloware-data"),
  ];
  const selectedDir = args.dir ? path.resolve(args.dir) : defaultDirs.find(Boolean)!;
  console.log(`[harness] scanning dir: ${selectedDir}`);

  let files = await listFilesRecursive(selectedDir);
  if (args.pattern) {
    files = files.filter((f) => f.includes(args.pattern!));
  }
  // Only process JSON files; ignore any .raw capture files
  files = files.filter((f) => f.toLowerCase().endsWith(".json"));
  files.sort();
  const limit = args.limit && args.limit > 0 ? args.limit : files.length;
  const chosen = files.slice(0, limit);

  console.log(`[harness] found ${files.length} files; running ${chosen.length}`);

  let totalProcessed = 0;
  let totalPosted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const file of chosen) {
    try {
      const data = await fs.readFile(file, "utf8");
      let payload: any;
      try {
        payload = JSON.parse(data);
      } catch {
        // Some files might be raw lines; skip if not valid JSON
        console.log(`[harness] skipping non-JSON file: ${file}`);
        totalSkipped++;
        continue;
      }

      // Normalize known wrapper shapes
      const body = payload?.parsedBody ? payload : { parsedBody: payload?.parsedBody ?? payload };
      console.log(`[harness] file: ${path.basename(file)}`);

      const envelope: IngestEnvelope = {
        source: "ALOWARE",
        headers: {},
        body,
        receivedAt: new Date().toISOString(),
      };

      const { handleIngest } = await import("../../src/index");
      const result = await handleIngest(envelope);
      totalProcessed += result.processed;
      totalPosted += result.posted;
    } catch (err) {
      totalErrors++;
      console.error(`[harness] error on ${file}:`, (err as Error).message);
    }
  }

  console.log(`[harness] done. processed=${totalProcessed} posted=${totalPosted} skipped=${totalSkipped} errors=${totalErrors}`);
}

run().catch((e) => {
  console.error("[harness] fatal:", e);
  process.exitCode = 1;
});


