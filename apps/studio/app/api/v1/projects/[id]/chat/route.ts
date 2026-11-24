import { z } from "zod";
import { getStudioDaemon } from "@/server/daemon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ChatBodySchema = z.object({
  prompt: z.string().min(1).max(8000),
  selectedSlot: z.string().min(1).optional(),
  approvedEgressHosts: z.array(z.string()).optional(),
});

function formatSseFrame(eventName: string, data: unknown): Uint8Array {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  return new TextEncoder().encode(payload);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const daemon = getStudioDaemon();

  if (!daemon.db.getProject(id)) {
    return Response.json({ error: `Project '${id}' not found` }, { status: 404 });
  }

  let body: z.infer<typeof ChatBodySchema>;
  try {
    body = ChatBodySchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }

  const authorUid = request.headers.get("x-newt-uid")?.trim() || undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const turn = await daemon.runChatTurn({
          projectId: id,
          prompt: body.prompt,
          authorUid,
          selectedSlot: body.selectedSlot,
          approvedEgressHosts: body.approvedEgressHosts,
          onEvent: (event) => {
            controller.enqueue(formatSseFrame(event.type, event));
          },
        });

        controller.enqueue(
          formatSseFrame("snapshot.saved", {
            projectId: id,
            status: turn.result.status,
            ok: turn.result.ok,
            blockReason: turn.result.blockReason ?? null,
            snapshot: turn.snapshot,
            diff: turn.diff,
            totalUsage: turn.result.totalUsage,
          })
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(formatSseFrame("turn.error", { type: "turn.error", message }));
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
      "X-Accel-Buffering": "no",
    },
  });
}
