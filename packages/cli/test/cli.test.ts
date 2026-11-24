import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toSalamandaSlotsManifest } from "@newt/base-sdk";
import { xkmatoBaseSpec, xkmatoPlatformManifest } from "@newt/base-xkmato";
import { validateLimbManifestToml } from "@newt/contract";
import { runCli, runDevCommand } from "../src/index.js";

function createCapturedIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
  };
}

describe("Task 3.3 — @newt/cli standalone commands", () => {
  const tempDirs: string[] = [];

  function makeTempDir(prefix: string): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(d);
    return d;
  }

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("scaffolds with `newt init`, compiles with `newt build` into a Salamanda-valid Limb directory, and passes `newt validate`", async () => {
    const projectDir = makeTempDir("newt-cli-limb-");
    const initCap = createCapturedIo();
    const initCode = await runCli(
      ["init", projectDir, "--base", "xkmato", "--name", "Reading Notes", "--slot", "blog.sidebar"],
      initCap.io
    );
    expect(initCode).toBe(0);
    expect(fs.existsSync(path.join(projectDir, "limb.toml"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src/ui/Widget.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "migrations/001_init.sql"))).toBe(true);

    const buildCap = createCapturedIo();
    const buildCode = await runCli(["build", projectDir, "--out", "dist-limb"], buildCap.io);
    expect(buildCode).toBe(0);

    const outDir = path.join(projectDir, "dist-limb");
    expect(fs.existsSync(path.join(outDir, "limb.toml"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "ui/Widget.html"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "migrations/001_init.sql"))).toBe(true);

    // Verify emitted Limb directory passes Salamanda contract validation cleanly
    const builtToml = fs.readFileSync(path.join(outDir, "limb.toml"), "utf8");
    const slotsManifest = toSalamandaSlotsManifest(xkmatoPlatformManifest);
    const report = validateLimbManifestToml(builtToml, xkmatoBaseSpec, slotsManifest, false);
    expect(report.valid).toBe(true);
    expect(report.diagnostics).toEqual([]);

    const valCap = createCapturedIo();
    const valCode = await runCli(["validate", projectDir, "--json"], valCap.io);
    expect(valCode).toBe(0);
    const parsed = JSON.parse(valCap.stdout.join("\n")) as { valid: boolean };
    expect(parsed.valid).toBe(true);

    // Verify `newt dev` serves compiled preview and status JSON
    const devCap = createCapturedIo();
    const dev = await runDevCommand({ dir: projectDir, port: 0, base: "xkmato" }, devCap.io);
    try {
      const statusRes = await fetch(`${dev.url}/status.json`);
      const statusJson = (await statusRes.json()) as { valid: boolean; limbId: string };
      expect(statusJson.valid).toBe(true);
      expect(statusJson.limbId).toBe("reading-notes");
    } finally {
      await dev.close();
    }
  });

  it("bootstraps a Base Pack from a live URL with `newt inspect-url` and runs `newt doctor`", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/.well-known/amphibian.json") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><head><style>:root{--background:#fff;--foreground:#111;--primary:#0a0;}</style></head><body><main><article><h1>Indie Blog</h1></article><aside>Sidebar</aside></main></body></html>`);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    try {
      const outDir = makeTempDir("newt-inspect-");
      const outFile = path.join(outDir, "amphibian.json");
      const cap = createCapturedIo();
      const code = await runCli(
        ["inspect-url", `http://127.0.0.1:${port}/`, "--out", outFile],
        cap.io
      );
      expect(code).toBe(0);
      expect(fs.existsSync(outFile)).toBe(true);
      expect(fs.existsSync(path.join(outDir, "slots.json"))).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(outFile, "utf8")) as {
        slots: Array<{ id: string }>;
        theme: { tokens: Record<string, string> };
      };
      expect(manifest.slots.map((s) => s.id)).toEqual(
        expect.arrayContaining(["article.header", "page.sidebar", "main.header"])
      );
      expect(manifest.theme.tokens["--newt-bg"]).toBe("--background");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const docCap = createCapturedIo();
    const docCode = await runCli(["doctor"], docCap.io);
    expect(docCode).toBe(0);
    expect(docCap.stdout.join("\n")).toContain("node:sqlite");
  });
});
