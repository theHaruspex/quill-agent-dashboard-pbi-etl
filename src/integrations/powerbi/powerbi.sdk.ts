export interface PowerBiAuthConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface PowerBiClientOptions {
  baseUrl?: string;
}

export class PowerBiClient {
  // Placeholder client to enable future integration without pulling dependencies yet
  constructor(_auth: PowerBiAuthConfig, _opts?: PowerBiClientOptions) {}
}


