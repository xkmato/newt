import { NextResponse } from "next/server";
import { namespaceLimbId } from "@newt/contract";
import { assertProjectOwnership, authenticateRequest, StudioAuthError } from "@/server/auth";
import { getStudioDaemon } from "@/server/daemon";
import { createSalamandaClientFromEnv } from "@/server/salamanda-deployer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const principal = await authenticateRequest(request);
    const { id } = await context.params;
    const daemon = getStudioDaemon();
    const project = daemon.db.getProject(id);
    if (!project) {
      return NextResponse.json({ error: `Project '${id}' not found` }, { status: 404 });
    }
    assertProjectOwnership(project, principal);

    const latestDeployment = daemon.db.getLatestDeploymentForProject(id);
    const deployments = daemon.db.listDeploymentsForProject(id).slice(0, 10);
    const currentSnapshot = daemon.db.getCurrentSnapshot(id);
    const compiledLimbId =
      currentSnapshot?.compiledBundle?.manifest?.limb.id ?? project.limbId;
    const namespacedLimbId = namespaceLimbId(principal.principalUid, compiledLimbId);

    let activeBindings: string[] = [];
    let salamandaReachable = true;
    try {
      const client = createSalamandaClientFromEnv();
      const res = await client.getBindings(principal.principalUid);
      activeBindings = res.limbs;
    } catch {
      salamandaReachable = false;
    }

    const isBound =
      activeBindings.includes(compiledLimbId) || activeBindings.includes(namespacedLimbId);

    return NextResponse.json({
      projectId: id,
      limbId: compiledLimbId,
      namespacedLimbId,
      latestDeployment,
      deployments,
      activeBindings,
      isBound,
      salamandaReachable,
    });
  } catch (err) {
    if (err instanceof StudioAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
