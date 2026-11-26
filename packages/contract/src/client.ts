import type { CapabilitiesResponse, ValidationReport, WhoamiResponse } from "./types.js";

export class SalamandaHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(operation: string, status: number, responseBody: string) {
    super(`${operation} failed (${status}): ${responseBody}`);
    this.name = "SalamandaHttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export interface SalamandaClientConfig {
  /** Base URL of the Salamanda Control Plane, e.g. `http://127.0.0.1:7474` */
  controlPlaneUrl: string;
  /** Registered client ID (e.g., `newt-prod` or `amphibian-dev`) */
  clientId: string;
  /** Registered client service credential (kept strictly server-side in Newt) */
  clientKey: string;
}

export interface DelegationAuthContext {
  /** Verified Firebase/OIDC user Bearer JWT (production) */
  userBearerToken?: string;
  /** Optional local dev UID header (`x-dev-uid`) when connected to `salamanda dev` */
  devUid?: string;
  /** Optional idempotency key for draft uploads */
  idempotencyKey?: string;
  /** Optional additional verified identity headers (e.g. signed headers `x-auth-uid`/`x-auth-sig`) */
  extraHeaders?: Record<string, string>;
}

export class SalamandaControlPlaneClient {
  private readonly baseUrl: string;

  constructor(private readonly config: SalamandaClientConfig) {
    this.baseUrl = config.controlPlaneUrl.replace(/\/+$/, "");
  }

  private delegatedHeaders(ctx: DelegationAuthContext): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Salamanda-Client-Id": this.config.clientId,
      "X-Salamanda-Client-Key": this.config.clientKey,
    };
    if (ctx.userBearerToken) {
      headers.Authorization = `Bearer ${ctx.userBearerToken}`;
    }
    if (ctx.devUid) {
      headers["x-dev-uid"] = ctx.devUid;
    }
    if (ctx.idempotencyKey) {
      headers["Idempotency-Key"] = ctx.idempotencyKey;
    }
    if (ctx.extraHeaders) {
      Object.assign(headers, ctx.extraHeaders);
    }
    return headers;
  }

  async whoami(auth: DelegationAuthContext): Promise<WhoamiResponse> {
    const headers = this.delegatedHeaders(auth);
    delete headers["Content-Type"];
    const res = await fetch(`${this.baseUrl}/v1/whoami`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new SalamandaHttpError("whoami", res.status, await res.text());
    }
    const body = (await res.json()) as { uid?: unknown; issuer?: unknown };
    if (typeof body.uid !== "string" || !body.uid.trim()) {
      throw new SalamandaHttpError("whoami", 502, "Missing uid in /v1/whoami response");
    }
    return {
      uid: body.uid.trim(),
      issuer: typeof body.issuer === "string" ? body.issuer : undefined,
    };
  }

  async getCapabilities(): Promise<CapabilitiesResponse> {
    const res = await fetch(`${this.baseUrl}/v1/capabilities`);
    if (!res.ok) {
      throw new Error(`getCapabilities failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as CapabilitiesResponse;
  }

  async validateLimb(manifestToml: string, isShared = false): Promise<ValidationReport> {
    const res = await fetch(`${this.baseUrl}/v1/limbs:validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifest_toml: manifestToml, is_shared: isShared }),
    });
    return (await res.json()) as ValidationReport;
  }

  async upsertLimb(
    auth: DelegationAuthContext,
    manifestToml: string,
    assets: Record<string, string> = {}
  ): Promise<{ limb_id: string; version: string; status: string }> {
    const res = await fetch(`${this.baseUrl}/v1/limbs`, {
      method: "POST",
      headers: this.delegatedHeaders(auth),
      body: JSON.stringify({ manifest_toml: manifestToml, assets }),
    });
    if (!res.ok) {
      throw new Error(`upsertLimb failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as { limb_id: string; version: string; status: string };
  }

  async publishLimb(
    auth: DelegationAuthContext,
    limbId: string
  ): Promise<{ limb_id: string; published_digest: string }> {
    const res = await fetch(
      `${this.baseUrl}/v1/limbs/${encodeURIComponent(limbId)}/publish`,
      {
        method: "POST",
        headers: this.delegatedHeaders(auth),
      }
    );
    if (!res.ok) {
      throw new Error(`publishLimb failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as { limb_id: string; published_digest: string };
  }

  async getLimbLogs(limbId: string): Promise<{ limb_id: string; logs: string[] }> {
    const res = await fetch(
      `${this.baseUrl}/v1/limbs/${encodeURIComponent(limbId)}/logs`
    );
    if (!res.ok) {
      throw new Error(`getLimbLogs failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as { limb_id: string; logs: string[] };
  }

  async getBindings(principalUid: string): Promise<{ principal_uid: string; limbs: string[] }> {
    const res = await fetch(
      `${this.baseUrl}/v1/principals/${encodeURIComponent(principalUid)}/bindings`
    );
    if (!res.ok) {
      throw new Error(`getBindings failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as { principal_uid: string; limbs: string[] };
  }

  async setBindings(
    auth: DelegationAuthContext,
    principalUid: string,
    limbIds: string[]
  ): Promise<{ principal_uid: string; limbs: string[] }> {
    const res = await fetch(
      `${this.baseUrl}/v1/principals/${encodeURIComponent(principalUid)}/bindings`,
      {
        method: "PUT",
        headers: this.delegatedHeaders(auth),
        body: JSON.stringify({ limbs: limbIds }),
      }
    );
    if (!res.ok) {
      throw new Error(`setBindings failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as { principal_uid: string; limbs: string[] };
  }

  async resetBindings(
    auth: DelegationAuthContext,
    principalUid: string
  ): Promise<{ principal_uid: string; limbs: string[] }> {
    const res = await fetch(
      `${this.baseUrl}/v1/principals/${encodeURIComponent(principalUid)}/bindings`,
      {
        method: "DELETE",
        headers: this.delegatedHeaders(auth),
      }
    );
    if (!res.ok) {
      throw new Error(`resetBindings failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as { principal_uid: string; limbs: string[] };
  }

  async previewBindings(
    auth: DelegationAuthContext,
    principalUid: string,
    limbIds: string[]
  ): Promise<{ principal_uid: string; limbs: string[] }> {
    const res = await fetch(
      `${this.baseUrl}/v1/principals/${encodeURIComponent(principalUid)}/preview`,
      {
        method: "POST",
        headers: this.delegatedHeaders(auth),
        body: JSON.stringify({ limbs: limbIds }),
      }
    );
    if (!res.ok) {
      throw new Error(`previewBindings failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as { principal_uid: string; limbs: string[] };
  }

  async quarantineLimb(
    auth: DelegationAuthContext,
    limbId: string,
    reason: string
  ): Promise<{ limb_id: string; status: string; unbound_principals: string[] }> {
    const res = await fetch(
      `${this.baseUrl}/v1/limbs/${encodeURIComponent(limbId)}/quarantine`,
      {
        method: "POST",
        headers: this.delegatedHeaders(auth),
        body: JSON.stringify({ reason }),
      }
    );
    if (!res.ok) {
      throw new Error(`quarantineLimb failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as {
      limb_id: string;
      status: string;
      unbound_principals: string[];
    };
  }
}
