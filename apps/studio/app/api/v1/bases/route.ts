import { NextResponse } from "next/server";
import { z } from "zod";
import type { AmphibianPlatformManifest } from "@newt/base-sdk";
import { getStudioDaemon } from "@/server/daemon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RegisterBaseBodySchema = z.union([
  z.object({
    url: z.string().url(),
  }),
  z.object({
    manifest: z.record(z.unknown()),
    fixtures: z.record(z.array(z.record(z.unknown()))).optional(),
  }),
]);

export async function GET() {
  const daemon = getStudioDaemon();
  return NextResponse.json({
    bases: daemon.bases.list(),
  });
}

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const parsed = RegisterBaseBodySchema.parse(raw);
    const daemon = getStudioDaemon();

    if ("url" in parsed) {
      const inspected = await daemon.bases.inspectAndRegisterUrl(parsed.url);
      return NextResponse.json(inspected, { status: 201 });
    }

    const base = daemon.bases.registerManifest(
      parsed.manifest as unknown as AmphibianPlatformManifest,
      parsed.fixtures ?? {}
    );
    return NextResponse.json({ source: "manifest", base }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
