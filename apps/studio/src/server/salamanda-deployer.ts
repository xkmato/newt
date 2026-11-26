import crypto from "node:crypto";
import { compileLimbVfs } from "@newt/compiler";
import {
  type DelegationAuthContext,
  namespaceLimbId,
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
import {
  type AuthenticatedPrincipal,
  assertProjectOwnership,
  authenticateRequest,
  getSalamandaConfigFromEnv,
  StudioAuthError,
} from "./auth";
import { isLocalEnv } from "./config";
import type { StudioDaemon } from "./daemon";

export { authenticateRequest, assertProjectOwnership, StudioAuthError };
export type { AuthenticatedPrincipal };

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
  return getSalamandaConfigFromEnv(env);
}

export function createSalamandaClientFromEnv(
  env: Record<string, string | undefined> = process.env
): SalamandaControlPlaneClient {
  return new SalamandaControlPlaneClient(getSalamandaClientConfigFromEnv(env));
}

export function computeDeployIdempotencyKey(params: {
  projectId: string;
  snapshotId: number;
  principalUid: string;
  operation?: "deploy" | "preview" | "publish";
}): string {
  const op = params.operation ?? "deploy";
  const digest = crypto
    .createHash("sha256")
    .update(`${op}\0${params.projectId}\0${params.snapshotId}\0${params.principalUid}`)
    .digest("hex")
    .slice(0, 24);
  return `newt-${op}-${digest}`;
}

function alignManifestForPrincipal(
  manifestToml: string,
  params: {
    principalUid: string;
    enforceOwnerNamespace: boolean;
  }
): string {
  const parsed = parseLimbManifestToml(manifestToml);
  const currentAuthor = parsed.limb.author;

  const isPlaceholderAuthor =
    currentAuthor === "uid:studio" ||
    currentAuthor === "uid:developer" ||
    currentAuthor === "uid:dev";

  if (currentAuthor !== params.principalUid && !isPlaceholderAuthor) {
    throw new DeploymentAuthorizationError(
      `Limb manifest author '${currentAuthor}' does not match delegated principal '${params.principalUid}'`,
      403
    );
  }

  const targetLimbId = params.enforceOwnerNamespace
    ? namespaceLimbId(params.principalUid, parsed.limb.id)
    : parsed.limb.id;

  const oldPrefix = `/_limb/${parsed.limb.id}/`;
  const newPrefix = `/_limb/${targetLimbId}/`;

  if (currentAuthor === params.principalUid && targetLimbId === parsed.limb.id) {
    return manifestToml;
  }

  return serializeLimbManifestToml({
    ...parsed,
    limb: {
      ...parsed.limb,
      id: targetLimbId,
      author: params.principalUid,
    },
    ...(parsed.functions && parsed.functions.length > 0
      ? {
          functions: parsed.functions.map((f) => ({
            ...f,
            route: f.route.startsWith(oldPrefix)
              ? `${newPrefix}${f.route.slice(oldPrefix.length)}`
              : f.route,
          })),
        }
      : {}),
  });
}

function shouldEnforceOwnerNamespace(
  baseTarget: string,
  explicitOverride?: boolean
): boolean {
  if (explicitOverride !== undefined) return explicitOverride;
  if (!isLocalEnv()) return true;
  if (baseTarget === "blog") return true;
  return false;
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
    enforceOwnerNamespace?: boolean;
    client?: SalamandaControlPlaneClient;
  }
): Promise<{
  deployed: true;
  limbId: string;
  version: string;
  status: string;
  bindings: string[];
  idempotencyKey: string;
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
  await daemon.bases.ensureBaseSynced();
  const basePack = daemon.bases.get(project.baseTarget);
  if (!basePack) {
    throw new DeploymentAuthorizationError(
      `Base target '${project.baseTarget}' is not registered`,
      400
    );
  }

  const alignedToml = alignManifestForPrincipal(snapshot.files["limb.toml"] ?? "", {
    principalUid: params.principalUid,
    enforceOwnerNamespace: shouldEnforceOwnerNamespace(
      project.baseTarget,
      params.enforceOwnerNamespace
    ),
  });
  const vfsForDeploy = {
    ...snapshot.files,
    "limb.toml": alignedToml,
  };

  const l2JsRuntime = await daemon.resolveL2JsRuntimeCapability();
  const compiled = await compileLimbVfs(vfsForDeploy, {
    platformManifest: basePack.manifest,
    baseSpec: basePack.baseSpec,
    isSharedPublication: false,
    approvedEgressHosts: params.approvedEgressHosts ?? [],
    l2JsRuntime,
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

  const idempotencyKey =
    params.auth.idempotencyKey ??
    computeDeployIdempotencyKey({
      projectId: project.id,
      snapshotId: snapshot.id,
      principalUid: params.principalUid,
      operation: "deploy",
    });

  const authWithKey: DelegationAuthContext = {
    ...params.auth,
    idempotencyKey,
  };

  const client = params.client ?? createSalamandaClientFromEnv();
  const environment: DeploymentEnvironment =
    params.environment ?? (project.baseTarget === "blog" ? "blog-live" : "local-dev");

  let upserted: { limb_id: string; version: string; status: string };
  try {
    upserted = await client.upsertLimb(authWithKey, compiled.manifestToml, compiled.assets);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    daemon.db.recordDeployment({
      projectId: project.id,
      snapshotId: snapshot.id,
      principalUid: params.principalUid,
      environment,
      status: "failed",
      idempotencyKey,
      errorMessage: `Upsert failed: ${msg}`,
    });
    throw err;
  }

  let bindings: string[] = [];
  try {
    if (params.bindToSelf !== false) {
      const existing = await client.getBindings(params.principalUid);
      const merged = Array.from(new Set([...existing.limbs, upserted.limb_id]));
      const updated = await client.setBindings(authWithKey, params.principalUid, merged);
      bindings = updated.limbs;
    } else {
      bindings = (await client.getBindings(params.principalUid)).limbs;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    daemon.db.recordDeployment({
      projectId: project.id,
      snapshotId: snapshot.id,
      principalUid: params.principalUid,
      environment,
      status: "failed",
      idempotencyKey,
      errorMessage: `Upsert succeeded (${upserted.limb_id}) but bind failed: ${msg}`,
    });
    throw err;
  }

  const deployment = daemon.db.recordDeployment({
    projectId: project.id,
    snapshotId: snapshot.id,
    principalUid: params.principalUid,
    environment,
    status: "active",
    idempotencyKey,
  });

  return {
    deployed: true,
    limbId: upserted.limb_id,
    version: upserted.version,
    status: upserted.status,
    bindings,
    idempotencyKey,
    deployment,
  };
}

/**
 * Uploads the compiled Limb and registers a session-scoped live preview binding
 * via Salamanda `POST /v1/principals/{uid}/preview` so the author sees their Limb
 * rendered on the real host page without publishing or affecting any other user.
 */
export async function previewProjectOnSalamanda(
  daemon: StudioDaemon,
  params: {
    projectId: string;
    principalUid: string;
    auth: DelegationAuthContext;
    approvedEgressHosts?: string[];
    enforceOwnerNamespace?: boolean;
    client?: SalamandaControlPlaneClient;
  }
): Promise<{
  previewed: true;
  limbId: string;
  version: string;
  bindings: string[];
  idempotencyKey: string;
}> {
  const project = daemon.db.getProject(params.projectId);
  if (!project) {
    throw new DeploymentAuthorizationError(`Project '${params.projectId}' not found`, 404);
  }
  const snapshot = daemon.db.getCurrentSnapshot(project.id);
  if (!snapshot) {
    throw new DeploymentAuthorizationError(`Project '${project.id}' has no VFS snapshot`, 400);
  }
  await daemon.bases.ensureBaseSynced();
  const basePack = daemon.bases.get(project.baseTarget);
  if (!basePack) {
    throw new DeploymentAuthorizationError(
      `Base target '${project.baseTarget}' is not registered`,
      400
    );
  }

  const alignedToml = alignManifestForPrincipal(snapshot.files["limb.toml"] ?? "", {
    principalUid: params.principalUid,
    enforceOwnerNamespace: shouldEnforceOwnerNamespace(
      project.baseTarget,
      params.enforceOwnerNamespace
    ),
  });
  const vfsForPreview = {
    ...snapshot.files,
    "limb.toml": alignedToml,
  };

  const l2JsRuntime = await daemon.resolveL2JsRuntimeCapability();
  const compiled = await compileLimbVfs(vfsForPreview, {
    platformManifest: basePack.manifest,
    baseSpec: basePack.baseSpec,
    isSharedPublication: false,
    approvedEgressHosts: params.approvedEgressHosts ?? [],
    l2JsRuntime,
    runSmokeTest: true,
  });

  if (!compiled.valid || !compiled.manifest) {
    const firstErr = compiled.diagnostics.find((d) => d.severity === "error");
    throw new DeploymentAuthorizationError(
      `Cannot preview invalid Limb: ${firstErr ? `[${firstErr.code}] ${firstErr.message}` : "compilation failed"}`,
      422
    );
  }

  if (compiled.requiresEgressConsent) {
    throw new EgressConsentRequiredError(compiled.unapprovedEgressHosts);
  }

  const idempotencyKey =
    params.auth.idempotencyKey ??
    computeDeployIdempotencyKey({
      projectId: project.id,
      snapshotId: snapshot.id,
      principalUid: params.principalUid,
      operation: "preview",
    });

  const authWithKey: DelegationAuthContext = {
    ...params.auth,
    idempotencyKey,
  };

  const client = params.client ?? createSalamandaClientFromEnv();
  const upserted = await client.upsertLimb(authWithKey, compiled.manifestToml, compiled.assets);

  let existingLimbs: string[] = [];
  try {
    existingLimbs = (await client.getBindings(params.principalUid)).limbs;
  } catch {
    existingLimbs = [];
  }
  const merged = Array.from(new Set([...existingLimbs, upserted.limb_id]));
  const previewed = await client.previewBindings(authWithKey, params.principalUid, merged);

  return {
    previewed: true,
    limbId: upserted.limb_id,
    version: upserted.version,
    bindings: previewed.limbs,
    idempotencyKey,
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
    enforceOwnerNamespace?: boolean;
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
  await daemon.bases.ensureBaseSynced();
  const basePack = daemon.bases.get(project.baseTarget);
  if (!basePack) {
    throw new DeploymentAuthorizationError(
      `Base target '${project.baseTarget}' is not registered`,
      400
    );
  }

  const alignedToml = alignManifestForPrincipal(snapshot.files["limb.toml"] ?? "", {
    principalUid: params.principalUid,
    enforceOwnerNamespace: shouldEnforceOwnerNamespace(
      project.baseTarget,
      params.enforceOwnerNamespace
    ),
  });
  const vfsForPublish = {
    ...snapshot.files,
    "limb.toml": alignedToml,
  };

  const l2JsRuntime = await daemon.resolveL2JsRuntimeCapability();
  // Validate with isSharedPublication = true (enforces iframe isolation, etc.)
  const compiled = await compileLimbVfs(vfsForPublish, {
    platformManifest: basePack.manifest,
    baseSpec: basePack.baseSpec,
    isSharedPublication: true,
    approvedEgressHosts: params.approvedEgressHosts ?? [],
    l2JsRuntime,
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

  const idempotencyKey =
    params.auth.idempotencyKey ??
    computeDeployIdempotencyKey({
      projectId: project.id,
      snapshotId: snapshot.id,
      principalUid: params.principalUid,
      operation: "publish",
    });

  const authWithKey: DelegationAuthContext = {
    ...params.auth,
    idempotencyKey,
  };

  const client = params.client ?? createSalamandaClientFromEnv();
  const upserted = await client.upsertLimb(authWithKey, compiled.manifestToml, compiled.assets);
  const published = await client.publishLimb(authWithKey, upserted.limb_id);

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
    idempotencyKey,
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
