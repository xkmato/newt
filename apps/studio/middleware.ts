import { type NextRequest, NextResponse } from "next/server";

function getAllowedFrameAncestors(): string[] {
  const raw = process.env.NEWT_ALLOWED_FRAME_ANCESTORS?.trim();
  if (!raw) return ["'none'"];
  const list = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : ["'none'"];
}

function buildCorsHeadersForMiddleware(originHeader: string | null): Record<string, string> {
  const allowed = new Set<string>([
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3100",
    "http://127.0.0.1:3100",
  ]);
  for (const a of getAllowedFrameAncestors()) {
    if (a.startsWith("http://") || a.startsWith("https://")) {
      allowed.add(a.replace(/\/+$/, ""));
    }
  }
  const baseUrl = process.env.NEWT_BASE_URL?.trim();
  if (baseUrl) {
    try {
      allowed.add(new URL(baseUrl).origin);
    } catch {
      // ignore invalid URL
    }
  }

  const normalized = originHeader?.trim().replace(/\/+$/, "");
  const isLocal = process.env.NEWT_ENV?.trim().toLowerCase() === "local";
  const allowOrigin =
    normalized && allowed.has(normalized) ? normalized : isLocal ? "*" : "";

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Idempotency-Key, X-Dev-Uid, X-Newt-Uid",
    Vary: "Origin",
  };
  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }
  return headers;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/v1/") || pathname === "/bridge.js") {
    const cors = buildCorsHeadersForMiddleware(request.headers.get("origin"));
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: cors });
    }
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(cors)) {
      res.headers.set(k, v);
    }
    return res;
  }

  if (pathname === "/embed" || pathname.startsWith("/embed/")) {
    const ancestors = getAllowedFrameAncestors();
    const res = NextResponse.next();
    res.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors.join(" ")}`);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/embed", "/embed/:path*", "/api/v1/:path*", "/bridge.js"],
};
