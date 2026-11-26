import { NextResponse } from "next/server";
import { z } from "zod";
import type { AmphibianPlatformManifest } from "@newt/base-sdk";
import { getStudioDaemon } from "@/server/daemon";
import { buildCorsHeaders } from "@/server/config";

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

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(request.headers.get("origin")),
  });
}

export async function GET() {
  const daemon = getStudioDaemon();
  await daemon.bases.ensureBaseSynced();
  return NextResponse.json(
    {
      bases: daemon.bases.list(),
    },
    {
      headers: buildCorsHeaders(),
    }
  );
}

export async function POST(request: Request) {
  const cors = buildCorsHeaders(request.headers.get("origin"));
  try {
    const raw = await request.json();
    const parsed = RegisterBaseBodySchema.parse(raw);
    const daemon = getStudioDaemon();

    if ("url" in parsed) {
      const inspected = await daemon.bases.inspectAndRegisterUrl(parsed.url);
      return NextResponse.json(inspected, { status: 201, headers: cors });
    }

    const base = daemon.bases.registerManifest(
      parsed.manifest as unknown as AmphibianPlatformManifest,
      parsed.fixtures ?? {}
    );
    return NextResponse.json({ source: "manifest", base }, { status: 201, headers: cors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400, headers: cors });
  }
}
