import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveBridgeBundlePath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "../../packages/bridge/dist/bridge.js"),
    path.resolve(process.cwd(), "packages/bridge/dist/bridge.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function GET() {
  const bundlePath = resolveBridgeBundlePath();
  if (!bundlePath) {
    return new Response("/* @newt/bridge bundle not built */", {
      status: 503,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const code = fs.readFileSync(bundlePath, "utf8");
  return new Response(code, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
