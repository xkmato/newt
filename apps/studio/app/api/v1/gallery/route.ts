import { NextResponse } from "next/server";
import { getStudioDaemon } from "@/server/daemon";
import { extractDelegatedPrincipal } from "@/server/salamanda-deployer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseTarget = url.searchParams.get("base")?.trim() || undefined;
  const { principalUid } = extractDelegatedPrincipal(request);
  const daemon = getStudioDaemon();

  const listings = daemon.db.listPublicGallery(baseTarget).map((listing) => ({
    ...listing,
    entitled: daemon.db.hasEntitlement(listing.limbId, principalUid),
  }));

  return NextResponse.json({
    principalUid,
    listings,
  });
}
