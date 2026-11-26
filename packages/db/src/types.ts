import type { CompiledLimbBundle, NewtVfs } from "@newt/compiler";

export type ProjectMode = "standalone-ui" | "salamanda-limb";
export type MessageRole = "user" | "assistant" | "tool" | "system";
export type DeploymentEnvironment =
  | "local-dev"
  | "blog-preview"
  | "blog-live"
  | "xkmato-preview"
  | "xkmato-published"
  | "custom";
export type DeploymentStatus = "active" | "detached" | "quarantined" | "failed";
export type GalleryVisibility = "unlisted" | "public";
export type MonetizationMode = "free" | "allowlist" | "ledger_gate";
export type EntitlementSource = "author_invite" | "payment_receipt" | "free_install";

export interface ProjectRecord {
  id: string;
  ownerUid: string;
  limbId: string;
  name: string;
  mode: ProjectMode;
  baseTarget: string;
  currentSnapshotId: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface VfsSnapshotRecord {
  id: number;
  projectId: string;
  parentSnapshotId: number | null;
  files: NewtVfs;
  compiledBundle: CompiledLimbBundle | null;
  summary: string;
  createdAt: number;
}

export interface VfsFileDiff {
  path: string;
  status: "added" | "modified" | "removed";
  before?: string;
  after?: string;
}

export interface ThreadRecord {
  id: string;
  projectId: string;
  createdAt: number;
}

export interface MessageRecord {
  id: string;
  threadId: string;
  role: MessageRole;
  content: unknown;
  snapshotId: number | null;
  createdAt: number;
}

export interface DeploymentRecord {
  id: string;
  projectId: string;
  snapshotId: number;
  principalUid: string;
  environment: DeploymentEnvironment;
  publishedDigest: string | null;
  status: DeploymentStatus;
  idempotencyKey?: string | null;
  errorMessage?: string | null;
  createdAt: number;
}

export interface GalleryListingRecord {
  limbId: string;
  projectId: string;
  authorUid: string;
  title: string;
  description: string;
  baseTarget: string;
  publishedDigest: string;
  visibility: GalleryVisibility;
  monetizationMode: MonetizationMode;
  priceLabel: string | null;
  permissionsSummary: {
    level: number;
    slots: string[];
    dataRead: string[];
    egress: string[];
    sidecar: string;
  };
  installsCount: number;
  publishedAt: number;
}

export interface EntitlementGrantRecord {
  id: string;
  limbId: string;
  consumerUid: string;
  grantSource: EntitlementSource;
  externalReceiptId: string | null;
  grantedAt: number;
}
