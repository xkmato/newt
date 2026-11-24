import { compileLimbVfs } from "@newt/compiler";
import {
  type DelegationAuthContext,
  parseLimbManifestToml,
  type SalamandaClientConfig,
  SalamandaControlPlaneClient,
  serializeLimbManifestToml,
} from "@newt/contract";
import type {
  DeploymentEnvironment,
  DeploymentRecord,
  GalleryListingRecord,
  GalleryVisibility,
  MonetizationMode,
} from "@newt/db";
import type { StudioDaemon } from "./daemon";

export class EgressConsentRequiredError extends Error {
  readonly code = "NEWT-CONSENT-001" as const;
  readonly unapprovedEgressHosts: string[];

  constructor(unapprovedEgressHosts: string[]) {
    super(
      `Human egress consent required before deploying or binding external egress host(s): ${unapprovedEgressHosts.join(", ")}`
    );
    this.name = "EgressConsentRequiredError";
    this.unapprovedEgressHosts = unapprovedEgressHosts;
  }
}

export class DeploymentAuthorizationError extends Error {
  readonly status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "DeploymentAuthorizationError";
    this.status = status;
  }
}

export function getSalamandaClientConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): SalamandaClientConfig {
  return {
    controlPlaneUrl: env.SALAMANDA_CONTROL_PLANE_URL ?? "http://127.0.0.1:7474",
    clientId: env.SALAMANDA_CLIENT_ID ?? "amphibian-dev",
    clientKey: env.SALAMANDA_CLIENT_KEY ?? "dev-secret",
  };
}

export function createSalamandaClientFromEnv(
  env: Record<string, string | undefined> = process.env
): SalamandaControlPlaneClient {
  return new SalamandaControlPlaneClient(getSalamandaClientConfigFromEnv(env));
}

function decodeJwtSubUnsafe(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8")
    ) as { sub?: unknown };
    return typeof json.sub === "string" && json.sub.trim() ? json.sub.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Extracts delegated user identity from an inbound request to Newt Studio.
 * Server-held `X-Salamanda-Client-Id` and `X-Salamanda-Client-Key` are NEVER accepted
 * from or returned to the browser; they are attached strictly server-side by
 * `SalamandaControlPlaneClient`.
 */
export function extractDelegatedPrincipal(request: Request): {
  principalUid: string;
  auth: DelegationAuthContext;
} {
  const authHeader = request.headers.get("authorization")?.trim();
  const bearerToken =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : undefined;

  const devUidHeader =
    request.headers.get("x-dev-uid")?.trim() ||
    request.headers.get("x-newt-uid")?.trim() ||
    undefined;

  const extraHeaders: Record<string, string> = {};
  const signedUid = request.headers.get("x-auth-uid")?.trim();
  const signedSig = request.headers.get("x-auth-sig")?.trim();
  if (signedUid && signedSig) {
    extraHeaders["x-auth-uid"] = signedUid;
    extraHeaders["x-auth-sig"] = signedSig;
  }

  const principalUid =
    signedUid ??
    devUidHeader ??
    (bearerToken ? decodeJwtSubUnsafe(bearerToken) : null) ??
    "uid:studio";

  const auth: DelegationAuthContext = {
    userBearerToken: bearerToken,
    devUid: bearerToken || signedUid ? undefined : principalUid,
    idempotencyKey: request.headers.get("idempotency-key")?.trim() || undefined,
    extraHeaders: Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
  };

  return { principalUid, auth };
}

function alignAuthorForDelegatedPrincipal(
  manifestToml: string,
  principalUid: string
): string {
  const parsed = parseLimbManifestToml(manifestToml);
  const currentAuthor = parsed.limb.author;
  if (currentAuthor === principalUid) {
    return manifestToml;
  }
  if (
    currentAuthor === "uid:studio" ||
    currentAuthor === "uid:developer" ||
    currentAuthor === "uid:dev"
  ) {
    return serializeLimbManifestToml({
      ...parsed,
      limb: {
        ...parsed.limb,
        author: principalUid,
      },
    });
  }
  throw new DeploymentAuthorizationError(
    `Limb manifest author '${currentAuthor}' does not match delegated principal '${principalUid}'`,
    403
  );
}

export async function deployProjectToSalamanda(
  daemon: StudioDaemon,
  params: {
    projectId: string;
    principalUid: string;
    auth: DelegationAuthContext;
    approvedEgressHosts?: string[];
    bindToSelf?: boolean;
    environment?: DeploymentEnvironment;
    client?: SalamandaControlPlaneClient;
  }
): Promise<{
  deployed: true;
  limbId: string;
  version: string;
  status: string;
  bindings: string[];
  deployment: DeploymentRecord;
}> {
  const project = daemon.db.getProject(params.projectId);
  if (!project) {
    throw new DeploymentAuthorizationError(`Project '${params.projectId}' not found`, 404);
  }
  const snapshot = daemon.db.getCurrentSnapshot(project.id);
  if (!snapshot) {
    throw new DeploymentAuthorizationError(`Project '${project.id}' has no VFS snapshot`, 400);
  }
  const basePack = daemon.bases.get(project.baseTarget);
  if (!basePack) {
    throw new DeploymentAuthorizationError(
      `Base target '${project.baseTarget}' is not registered`,
      400
    );
  }

  const alignedToml = alignAuthorForDelegatedPrincipal(
    snapshot.files["limb.toml"] ?? "",
    params.principalUid
  );
  const vfsForDeploy = {
    ...snapshot.files,
    "limb.toml": alignedToml,
  };

  const compiled = await compileLimbVfs(vfsForDeploy, {
    platformManifest: basePack.manifest,
    baseSpec: basePack.baseSpec,
    isSharedPublication: false,
    approvedEgressHosts: params.approvedEgressHosts ?? [],
    runSmokeTest: true,
  });

  if (!compiled.valid || !compiled.manifest) {
    const firstErr = compiled.diagnostics.find((d) => d.severity === "error");
    throw new DeploymentAuthorizationError(
      `Cannot deploy invalid Limb: ${firstErr ? `[${firstErr.code}] ${firstErr.message}` : "compilation failed"}`,
      422
    );
  }

  // Deterministic Human Egress Consent Gate (NEWT-CONSENT-001)
  if (compiled.requiresEgressConsent) {
    throw new EgressConsentRequiredError(compiled.unapprovedEgressHosts);
  }

  const client = params.client ?? createSalamandaClientFromEnv();
  const upserted = await client.upsertLimb(params.auth, compiled.manifestToml, compiled.assets);

  let bindings: string[] = [];
  if (params.bindToSelf !== false) {
    const existing = await client.getBindings(params.principalUid);
    const merged = Array.from(new Set([...existing.limbs, upserted.limb_id]));
    const updated = await client.setBindings(params.auth, params.principalUid, merged);
    bindings = updated.limbs;
  } else {
    bindings = (await client.getBindings(params.principalUid)).limbs;
  }

  const deployment = daemon.db.recordDeployment({
    projectId: project.id,
    snapshotId: snapshot.id,
    principalUid: params.principalUid,
    environment: params.environment ?? "local-dev",
    status: "active",
  });

  return {
    deployed: true,
    limbId: upserted.limb_id,
    version: upserted.version,
    status: upserted.status,
    bindings,
    deployment,
  };
}

export async function publishProjectToSalamanda(
  daemon: StudioDaemon,
  params: {
    projectId: string;
    principalUid: string;
    auth: DelegationAuthContext;
    approvedEgressHosts?: string[];
    title?: string;
    description?: string;
    visibility?: GalleryVisibility;
    monetizationMode?: MonetizationMode;
    priceLabel?: string | null;
    client?: SalamandaControlPlaneClient;
  }
): Promise<{
  published: true;
  limbId: string;
  publishedDigest: string;
  listing: GalleryListingRecord;
  deployment: DeploymentRecord;
}> {
  const project = daemon.db.getProject(params.projectId);
  if (!project) {
    throw new DeploymentAuthorizationError(`Project '${params.projectId}' not found`, 404);
  }
  const snapshot = daemon.db.getCurrentSnapshot(project.id);
  if (!snapshot) {
    throw new DeploymentAuthorizationError(`Project '${project.id}' has no VFS snapshot`, 400);
  }
  const basePack = daemon.bases.get(project.baseTarget);
  if (!basePack) {
    throw new DeploymentAuthorizationError(
      `Base target '${project.baseTarget}' is not registered`,
      400
    );
  }

  const alignedToml = alignAuthorForDelegatedPrincipal(
    snapshot.files["limb.toml"] ?? "",
    params.principalUid
  );
  const vfsForPublish = {
    ...snapshot.files,
    "limb.toml": alignedToml,
  };

  // Validate with isSharedPublication = true (enforces iframe isolation, etc.)
  const compiled = await compileLimbVfs(vfsForPublish, {
    platformManifest: basePack.manifest,
    baseSpec: basePack.baseSpec,
    isSharedPublication: true,
    approvedEgressHosts: params.approvedEgressHosts ?? [],
    runSmokeTest: true,
  });

  if (!compiled.valid || !compiled.manifest) {
    const firstErr = compiled.diagnostics.find((d) => d.severity === "error");
    throw new DeploymentAuthorizationError(
      `Cannot publish invalid shared Limb: ${firstErr ? `[${firstErr.code}] ${firstErr.message}` : "compilation failed"}`,
      422
    );
  }

  if (compiled.requiresEgressConsent) {
    throw new EgressConsentRequiredError(compiled.unapprovedEgressHosts);
  }

  const client = params.client ?? createSalamandaClientFromEnv();
  const upserted = await client.upsertLimb(params.auth, compiled.manifestToml, compiled.assets);
  const published = await client.publishLimb(params.auth, upserted.limb_id);

  const manifest = compiled.manifest;
  const listing = daemon.db.upsertGalleryListing({
    limbId: published.limb_id,
    projectId: project.id,
    authorUid: params.principalUid,
    title: params.title ?? manifest.limb.name,
    description: params.description ?? manifest.limb.description ?? "",
    baseTarget: project.baseTarget,
    publishedDigest: published.published_digest,
    visibility: params.visibility ?? "public",
    monetizationMode: params.monetizationMode ?? "free",
    priceLabel: params.priceLabel ?? null,
    permissionsSummary: {
      level: manifest.limb.level,
      slots: (manifest.ui ?? []).map((u) => u.slot),
      dataRead: manifest.permissions.data_read,
      egress: manifest.permissions.egress,
      sidecar: manifest.permissions.sidecar,
    },
  });

  const deployment = daemon.db.recordDeployment({
    projectId: project.id,
    snapshotId: snapshot.id,
    principalUid: params.principalUid,
    environment: "xkmato-published",
    publishedDigest: published.published_digest,
    status: "active",
  });

  return {
    published: true,
    limbId: published.limb_id,
    publishedDigest: published.published_digest,
    listing,
    deployment,
  };
}

export async function updateMySalamandaBindings(
  daemon: StudioDaemon,
  params: {
    principalUid: string;
    auth: DelegationAuthContext;
    limbs: string[];
    approvedEgressHosts?: string[];
    client?: SalamandaControlPlaneClient;
  }
): Promise<{ principalUid: string; limbs: string[] }> {
  const approvedSet = new Set(
    (params.approvedEgressHosts ?? []).map((h) => h.toLowerCase())
  );
  const unapproved: string[] = [];

  // Enforce NEWT-CONSENT-001 for any known project/gallery Limb with external egress
  for (const limbId of params.limbs) {
    const listing = daemon.db.getGalleryListing(limbId);
    if (listing) {
      for (const host of listing.permissionsSummary.egress) {
        if (!approvedSet.has(host.toLowerCase())) unapproved.push(host);
      }
      continue;
    }
    const proj = daemon.db.getProjectByLimbId(limbId);
    const snap = proj ? daemon.db.getCurrentSnapshot(proj.id) : null;
    const egress = snap?.compiledBundle?.manifest?.permissions.egress ?? [];
    for (const host of egress) {
      if (!approvedSet.has(host.toLowerCase())) unapproved.push(host);
    }
  }

  if (unapproved.length > 0) {
    throw new EgressConsentRequiredError(Array.from(new Set(unapproved)));
  }

  const client = params.client ?? createSalamandaClientFromEnv();
  const res = await client.setBindings(params.auth, params.principalUid, params.limbs);
  return {
    principalUid: res.principal_uid,
    limbs: res.limbs,
  };
}
