/*
  Create Power BI Push Dataset in a workspace using client credentials.
  Requirements (.env):
    POWERBI_TENANT_ID, POWERBI_CLIENT_ID, POWERBI_CLIENT_SECRET, POWERBI_WORKSPACE_ID
  Usage:
    npx tsx tools/pbi/create-dataset.ts --name quill_agent_realtime
*/

// Best-effort .env load
try { require("dotenv").config(); } catch (_) {}

type Column = { name: string; dataType: "Int64" | "Double" | "Bool" | "Datetime" | "String" };
type TableSchema = { name: string; columns: Column[] };

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function getAccessToken(): Promise<string> {
  const tenant = process.env.POWERBI_TENANT_ID;
  const clientId = process.env.POWERBI_CLIENT_ID;
  const clientSecret = process.env.POWERBI_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) throw new Error("Missing POWERBI_* credentials in .env");

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("scope", "https://analysis.windows.net/powerbi/api/.default");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "<no body>");
    throw new Error(`Token request failed: ${res.status} ${res.statusText} ${txt}`);
  }
  const json: any = await res.json();
  const token = json.access_token as string | undefined;
  if (!token) throw new Error("No access_token in AAD response");
  return token;
}

function buildSchema(): TableSchema[] {
  const FactEvent: TableSchema = {
    name: "FactEvent",
    columns: [
      { name: "EventID", dataType: "String" },
      { name: "AgentID", dataType: "String" },
      { name: "FactDateKey", dataType: "String" },
      { name: "MetricID", dataType: "String" },
      { name: "Notes", dataType: "String" },
    ],
  };

  const DimAgent: TableSchema = {
    name: "DimAgent",
    columns: [
      { name: "AgentID", dataType: "String" },
      { name: "AgentName", dataType: "String" },
      { name: "Email", dataType: "String" },
      { name: "TimezoneIANA", dataType: "String" },
      { name: "ActiveFlag", dataType: "Bool" },
    ],
  };

  const DimMetric: TableSchema = {
    name: "DimMetric",
    columns: [
      { name: "MetricID", dataType: "String" },
      { name: "MetricName", dataType: "String" },
      { name: "DefaultGoal", dataType: "Int64" },
      { name: "DefaultYellowFloorPct", dataType: "Double" },
    ],
  };

  const DimDate: TableSchema = {
    name: "DimDate",
    columns: [
      { name: "Date", dataType: "Datetime" },
      { name: "Year", dataType: "Int64" },
      { name: "Month", dataType: "Int64" },
      { name: "Day", dataType: "Int64" },
      { name: "MonthName", dataType: "String" },
      { name: "Quarter", dataType: "Int64" },
      { name: "DayOfWeek", dataType: "Int64" },
      { name: "DayName", dataType: "String" },
      { name: "IsWeekend", dataType: "Bool" },
    ],
  };

  const DimShift: TableSchema = {
    name: "DimShift",
    columns: [
      { name: "AgentID", dataType: "String" },
      { name: "LocalDate", dataType: "Datetime" },
      { name: "ShiftStartLocal", dataType: "Datetime" },
      { name: "ShiftEndLocal", dataType: "Datetime" },
      { name: "ShiftHours", dataType: "Int64" },
    ],
  };

  return [FactEvent, DimAgent, DimMetric, DimDate, DimShift];
}

async function main() {
  const groupId = process.env.POWERBI_WORKSPACE_ID;
  if (!groupId) throw new Error("POWERBI_WORKSPACE_ID is required");
  const datasetName = getArg("--name") || process.env.POWERBI_DATASET_NAME || "Quill_Agent_Realtime";
  const schema = buildSchema();

  const token = await getAccessToken();
  const baseUrl = process.env.PBI_BASE_URL || "https://api.powerbi.com/v1.0/myorg";
  const res = await fetch(`${baseUrl}/groups/${groupId}/datasets?defaultRetentionPolicy=None`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: datasetName, defaultMode: "Push", tables: schema }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "<no body>");
    throw new Error(`Create dataset failed: ${res.status} ${res.statusText} ${txt}`);
  }
  const json: any = await res.json();
  console.log("Dataset created:");
  console.log(`  Name: ${json.name}`);
  console.log(`  ID:   ${json.id}`);
}

main().catch((err) => {
  console.error("[create-dataset] error:", err.message);
  process.exitCode = 1;
});


