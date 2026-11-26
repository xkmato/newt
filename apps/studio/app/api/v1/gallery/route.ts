import { NextResponse } from "next/server";
import { authenticateRequest, StudioAuthError } from "@/server/auth";
import { isFeatureEnabled } from "@/server/config";
import { getStudioDaemon } from "@/server/daemon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isFeatureEnabled("gallery")) {
    return NextResponse.json(
      { error: "Not found: gallery feature is disabled (enable 'gallery' in NEWT_FEATURES)." },
      { status: 404 }
    );
  }

  try {
    const { principalUid } = await authenticateRequest(request);
    const url = new URL(request.url);
    const baseTarget = url.searchParams.get("base")?.trim() || undefined;
    const daemon = getStudioDaemon();

    const listings = daemon.db.listPublicGallery(baseTarget).map((listing) => ({
      ...listing,
      entitled: daemon.db.hasEntitlement(listing.limbId, principalUid),
    }));

    return NextResponse.json({
      principalUid,
      listings,
    });
  } catch (err) {
    if (err instanceof StudioAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
