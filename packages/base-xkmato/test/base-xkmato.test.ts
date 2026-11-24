import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateLimbManifestToml, validateSlotsManifestSchema } from "@newt/contract";
import { toSalamandaSlotsManifest, validatePlatformManifest } from "@newt/base-sdk";
import { xkmatoBasePack, xkmatoBaseSpec, xkmatoPlatformManifest } from "../src/index.js";

describe("@newt/base-xkmato ground-truth alignment", () => {
  it("validates xkmatoPlatformManifest and generates a schema-valid Salamanda slots.json", () => {
    expect(validatePlatformManifest(xkmatoPlatformManifest).valid).toBe(true);
    const slots = toSalamandaSlotsManifest(xkmatoPlatformManifest);
    expect(validateSlotsManifestSchema(slots).valid).toBe(true);
    expect(slots.slots.map((s) => s.id)).toContain("blog.header");
    expect(slots.slots.map((s) => s.id)).toContain("blog.sidebar");
    expect(slots.slots.map((s) => s.id)).toContain("micropost.footer");
  });

  it("validates a blog.header Luganda TTS Limb and blocks reading sensitive subscribers", () => {
    const slots = toSalamandaSlotsManifest(xkmatoPlatformManifest);
    const validLimb = `
[limb]
id = "xkmato-luganda-reader"
name = "Luganda Essay Audio Reader"
version = "0.1.0"
level = 2
author = "uid:kenneth"

[requires]
contract = ">=1.0"
base = "xkmato"
slots = ["blog.header"]

[[ui]]
slot = "blog.header"
route_pattern = "/blog/*"
component = "ui/LugandaPlayer.html"
isolation = "iframe"

[[functions]]
route = "/_limb/xkmato-luganda-reader/speak"
method = "POST"
handler = "functions/speak.ts"

[permissions]
data_read = ["blogposts"]
data_write = []
egress = ["tts.sunbird.ai"]
sidecar = "personal"
`;
    expect(validateLimbManifestToml(validLimb, xkmatoBaseSpec, slots, true).valid).toBe(true);

    const subscriberLeakLimb = validLimb.replace(
      'data_read = ["blogposts"]',
      'data_read = ["subscribers"]'
    );
    const badReport = validateLimbManifestToml(subscriberLeakLimb, xkmatoBaseSpec, slots, true);
    expect(badReport.valid).toBe(false);
    expect(badReport.diagnostics.map((d) => d.code)).toContain("SAL-PERM-001");
  });

  it("stays in sync with /Users/kenneth/Code/xkmato/.well-known/amphibian.json when present", () => {
    const xkmatoManifestPath = "/Users/kenneth/Code/xkmato/public/.well-known/amphibian.json";
    if (fs.existsSync(path.resolve(xkmatoManifestPath))) {
      const liveJson = JSON.parse(fs.readFileSync(xkmatoManifestPath, "utf8")) as {
        slots: Array<{ id: string }>;
      };
      expect(liveJson.slots.map((s) => s.id)).toEqual(
        xkmatoBasePack.manifest.slots.map((s) => s.id)
      );
    }
  });
});
