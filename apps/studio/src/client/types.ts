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

export interface HealthDto {
  ok: boolean;
  service: string;
  version: string;
  provider: {
    name: string;
    model: string;
    mode: "live" | "studio-local" | "custom";
  };
  bases: string[];
  l3Enabled: boolean;
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
