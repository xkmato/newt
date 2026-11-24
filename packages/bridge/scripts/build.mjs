import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

const result = await esbuild.build({
  entryPoints: [path.join(pkgRoot, "src/auto-boot.ts")],
  outfile: path.join(pkgRoot, "dist/bridge.js"),
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2022"],
  legalComments: "none",
  metafile: true,
});

const raw = fs.readFileSync(path.join(pkgRoot, "dist/bridge.js"));
const gz = zlib.gzipSync(raw, { level: 9 });
const MAX_GZIP_BYTES = 4096;

if (gz.byteLength > MAX_GZIP_BYTES) {
  throw new Error(
    `@newt/bridge bundle exceeded 4 KB gzipped budget: ${gz.byteLength} B > ${MAX_GZIP_BYTES} B`
  );
}

console.log(
  `@newt/bridge built: ${raw.byteLength} B minified / ${gz.byteLength} B gzipped (budget: ${MAX_GZIP_BYTES} B)`
);
void result;
