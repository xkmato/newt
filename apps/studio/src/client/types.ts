import type { AmphibianPlatformManifest } from "@newt/base-sdk";
import type { CompiledLimbBundle, NewtVfs } from "@newt/compiler";
import type { BaseSpec, CapabilitiesResponse, Diagnostic, SlotsManifest } from "@newt/contract";
import type { ProjectMode, ProjectRecord, VfsFileDiff, VfsSnapshotRecord } from "@newt/db";

export interface BasePackDto {
  id: string;
  builtIn: boolean;
  manifest: AmphibianPlatformManifest;
  baseSpec: BaseSpec;
  slotsManifest: SlotsManifest;
  capabilities: CapabilitiesResponse;
  fixtures: Record<string, Array<Record<string, unknown>>>;
}

export interface StudioFeatureMapDto {
  l1: boolean;
  l2: boolean;
  l3: boolean;
  gallery: boolean;
  publish: boolean;
  monetization: boolean;
}

export interface HealthDto {
  ok: boolean;
  service: string;
  version: string;
  env?: string;
  provider: {
    name: string;
    model: string;
    mode: "live" | "studio-local" | "custom";
  };
  bases: string[];
  defaultBase?: string;
  features?: StudioFeatureMapDto;
  l3Enabled: boolean;
}

export interface DeploymentStatusDto {
  projectId: string;
  limbId: string;
  namespacedLimbId: string;
  latestDeployment: {
    id: string;
    snapshotId: number;
    status: "active" | "detached" | "quarantined" | "failed";
    environment: string;
    idempotencyKey?: string | null;
    errorMessage?: string | null;
    createdAt: number;
  } | null;
  activeBindings: string[];
  isBound: boolean;
  salamandaReachable: boolean;
}

export interface ProjectDetailDto {
  project: ProjectRecord;
  currentSnapshot: VfsSnapshotRecord | null;
  snapshots: VfsSnapshotRecord[];
  diff: VfsFileDiff[];
  messages: Array<{
    id: string;
    threadId: string;
    role: "user" | "assistant" | "tool" | "system";
    content: unknown;
    snapshotId: number | null;
    createdAt: number;
  }>;
}

export interface TraceItem {
  id: string;
  event: string;
  summary: string;
  status: "info" | "ok" | "error" | "warn";
  timestamp: number;
  diagnostics?: Diagnostic[];
}

export type { CompiledLimbBundle, NewtVfs, ProjectMode, ProjectRecord, VfsFileDiff, VfsSnapshotRecord };
