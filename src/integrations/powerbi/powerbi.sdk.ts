export interface PowerBiAuthConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface PowerBiClientOptions {
  baseUrl?: string;
}

export async function getAccessToken(auth: PowerBiAuthConfig): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${auth.tenantId}/oauth2/v2.0/token`;
  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", auth.clientId);
  form.set("client_secret", auth.clientSecret);
  form.set("scope", "https://analysis.windows.net/powerbi/api/.default");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  } as any);
  if (!res.ok) {
    const txt = await (res as any).text().catch(() => "<no body>");
    throw new Error(`Power BI token request failed: ${res.status} ${res.statusText} ${txt}`);
  }
  const json: any = await (res as any).json();
  const token = json?.access_token as string | undefined;
  if (!token) throw new Error("Power BI token missing in response");
  return token;
}

// Thin constructor around vendored SDK client to standardize creation
export async function createSdkClient(logger?: (msg: string, ctx?: Record<string, unknown>) => void) {
  // Import lazily to avoid ESM/CJS and TS rootDir issues
  const moduleBase = "../../../sdks/power-bi-sdk/src/lib/";
  const sdk: any = await import(moduleBase + "client");
  const { loadConfig } = await import("../../config/config");
  const cfg = loadConfig();
  const client = new sdk.PowerBiClient(
    {
      tenantId: cfg.powerBi.tenantId!,
      clientId: cfg.powerBi.clientId!,
      clientSecret: cfg.powerBi.clientSecret!,
    },
    {
      userAgent: "quill-agent-dashboard-etl/0.1.0",
      logger,
    }
  );
  return client;
}



