import { z } from "zod";
import { getStudioDaemon } from "@/server/daemon";
import { VariantPolicyError } from "@/server/variant-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MaterializeSchema = z.object({
  baseRepoDir: z.string().min(1).optional(),
});

function formatSse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (process.env.NEWT_ENABLE_L3_VARIANTS !== "1") {
    return Response.json(
      { error: "Level 3 Variant authoring is disabled. Set NEWT_ENABLE_L3_VARIANTS=1." },
      { status: 403 }
    );
  }

  const daemon = getStudioDaemon();
  const project = daemon.db.getProject(id);
  if (!project) {
    return Response.json({ error: `Project '${id}' not found` }, { status: 404 });
  }
  const snap = daemon.db.getCurrentSnapshot(id);
  const patch = snap?.compiledBundle?.variantPatch;
  if (!snap || !patch) {
    return Response.json(
      { error: "Project does not have a compiled Level 3 variant patch (`patches/variant.patch`)." },
      { status: 400 }
    );
  }
  const basePack = daemon.bases.get(project.baseTarget);
  if (!basePack) {
    return Response.json({ error: `Unknown base target '${project.baseTarget}'` }, { status: 400 });
  }

  const raw = await request.text();
  const body = raw.trim() ? MaterializeSchema.parse(JSON.parse(raw)) : {};
  const baseRepoDir = body.baseRepoDir ?? process.env.NEWT_BASE_REPO_DIR;
  if (!baseRepoDir) {
    return Response.json(
      { error: "Provide `baseRepoDir` in request body or set NEWT_BASE_REPO_DIR." },
      { status: 400 }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const record = await daemon.variants.materialize({
          projectId: id,
          baseRepoDir,
          baseSpec: basePack.baseSpec,
          patchDiff: patch.diff,
          onProgress: (ev) => {
            controller.enqueue(formatSse("variant.progress", ev));
          },
        });
        controller.enqueue(formatSse("variant.ready", record));
      } catch (err) {
        if (err instanceof VariantPolicyError) {
          controller.enqueue(
            formatSse("variant.error", {
              code: "SAL-EDIT-001",
              error: err.message,
              diagnostics: err.diagnostics,
            })
          );
        } else {
          controller.enqueue(
            formatSse("variant.error", {
              error: err instanceof Error ? err.message : String(err),
            })
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
