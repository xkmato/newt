import { NextResponse } from "next/server";
import { z } from "zod";
import { getStudioDaemon } from "@/server/daemon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RebaseSchema = z.object({
  newCommit: z.string().min(1).optional(),
  autoRepair: z.boolean().optional(),
  repairPrompt: z.string().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (process.env.NEWT_ENABLE_L3_VARIANTS !== "1") {
      return NextResponse.json(
        { error: "Level 3 Variant authoring is disabled. Set NEWT_ENABLE_L3_VARIANTS=1." },
        { status: 403 }
      );
    }

    const daemon = getStudioDaemon();
    const project = daemon.db.getProject(id);
    if (!project) {
      return NextResponse.json({ error: `Project '${id}' not found` }, { status: 404 });
    }
    const basePack = daemon.bases.get(project.baseTarget);
    if (!basePack) {
      return NextResponse.json({ error: `Unknown base target '${project.baseTarget}'` }, { status: 400 });
    }

    const raw = await request.text();
    const body = raw.trim() ? RebaseSchema.parse(JSON.parse(raw)) : {};

    const rebased = daemon.variants.rebaseOntoCommit({
      projectId: id,
      newCommit: body.newCommit,
    });

    if (rebased.state !== "Stale" || !body.autoRepair) {
      return NextResponse.json({
        repaired: false,
        variant: rebased,
      });
    }

    // 1-Click AI Self-Repair on Stale Rebase Conflict!
    const repairTurn = await daemon.runChatTurn({
      projectId: id,
      prompt:
        body.repairPrompt ??
        `Rebase and repair our Level 3 layout variant patch cleanly onto upstream commit ${rebased.baseCommit}`,
      enableL3: true,
      rebaseConflict: {
        baseCommit: rebased.baseCommit,
        conflictReason: rebased.conflictReason ?? "git apply conflict",
        upstreamFiles: rebased.upstreamFiles,
      },
    });

    const repairedPatch = repairTurn.snapshot?.compiledBundle?.variantPatch;
    if (!repairTurn.result.ok || !repairedPatch) {
      return NextResponse.json(
        {
          repaired: false,
          error: "AI self-repair could not synthesize a valid rebased patch.",
          variant: rebased,
        },
        { status: 422 }
      );
    }

    const rematerialized = await daemon.variants.materialize({
      projectId: id,
      baseRepoDir: rebased.baseRepoDir,
      baseSpec: basePack.baseSpec,
      patchDiff: repairedPatch.diff,
    });

    return NextResponse.json({
      repaired: rematerialized.state === "Running",
      snapshot: repairTurn.snapshot,
      variant: rematerialized,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
