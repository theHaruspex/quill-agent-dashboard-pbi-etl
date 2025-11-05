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



