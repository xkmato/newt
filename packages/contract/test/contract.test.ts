import { describe, expect, it } from "vitest";
import {
  buildCapabilitiesResponse,
  parseBaseSpecToml,
  parseLimbManifestToml,
  parseSlotsManifestJson,
  serializeLimbManifestToml,
  validateLimbManifestToml,
  validateSlotsManifestSchema,
} from "../src/index.js";

const SAMPLE_BASE_TOML = `
[base]
name = "xkmato"
upstream = "http://127.0.0.1:3000"
framework = "nextjs"

[extensions]
allow_levels = [1, 2, 3]
slots_manifest = "slots.json"

[identity]
adapter = "jwt"
jwks_url = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
issuer = "https://securetoken.google.com/xkmato-prod"
audience = "xkmato-prod"
token_sources = ["cookie:__session", "header:authorization"]

[data.canonical]
mode = "scoped-credentials"
adapter = "firebase-custom-token"
readable_collections = ["posts", "comments", "users:public"]
sensitive_collections = ["dms", "payments", "users:private", "admin"]

[variants]
install = "pnpm install --frozen-lockfile"
build = "pnpm build"
start = "pnpm start -p \${PORT}"
health = "/api/health"
edit_allow = ["src/**", "app/**", "components/**", "public/**"]
edit_deny = [".env*", "firestore.rules", "firebase.json", "salamanda.toml"]
`;

const SAMPLE_SLOTS_JSON = JSON.stringify({
  base: "xkmato",
  contract_version: "1.0.0",
  slots: [
    {
      id: "post.header",
      description: "Mounted directly above the essay body.",
      routes: ["/post/*", "/feed/*"],
      anchor_selector: '[data-salamanda-slot="post.header"]',
      placement: "inside-end",
      context_props: ["post-id", "author-id", "lang"],
    },
    {
      id: "post.sidebar",
      description: "Sidebar companion slot.",
      routes: ["/post/*", "/feed/*"],
      anchor_selector: '[data-salamanda-slot="post.sidebar"]',
      placement: "inside-end",
      context_props: ["post-id"],
    },
  ],
});

const LUGANDA_TTS_TOML = `
[limb]
id = "luganda-tts"
name = "Luganda Accent & Phoneme TTS Reader"
version = "0.1.0"
level = 2
author = "uid:kenneth"
description = "Mounts a Luganda-aware audio synthesizer into the post.header slot."

[requires]
contract = ">=1.0"
base = "xkmato"
slots = ["post.header"]

[[ui]]
slot = "post.header"
route_pattern = "/feed/*"
component = "ui/AudioPlayer.html"
isolation = "iframe"

[[functions]]
route = "/_limb/luganda-tts/synthesize"
method = "POST"
handler = "functions/synthesize.js"

[permissions]
data_read = ["posts", "users:public"]
data_write = []
egress = ["tts.sunbird.ai"]
sidecar = "personal"
max_memory_mb = 64
max_cpu_ms = 500

[sidecar]
migrations = "migrations/"
`;

describe("@newt/contract Salamanda v1.0.0 parity", () => {
  const base = parseBaseSpecToml(SAMPLE_BASE_TOML);
  const slots = parseSlotsManifestJson(SAMPLE_SLOTS_JSON);

  it("validates slots.json against slots.schema.json and builds CapabilitiesResponse", () => {
    expect(validateSlotsManifestSchema(slots).valid).toBe(true);
    const caps = buildCapabilitiesResponse(base, slots);
    expect(caps.contract_version).toBe("1.0.0");
    expect(caps.base.name).toBe("xkmato");
    expect(caps.slots).toContain("post.header");
    expect(caps.features.l3_variant_runtime).toBe("experimental");
  });

  it("round-trips and validates reference luganda-tts limb cleanly", () => {
    const parsed = parseLimbManifestToml(LUGANDA_TTS_TOML);
    const roundtrip = parseLimbManifestToml(serializeLimbManifestToml(parsed));
    expect(roundtrip.limb.id).toBe("luganda-tts");

    const report = validateLimbManifestToml(LUGANDA_TTS_TOML, base, slots, true);
    expect(report.valid).toBe(true);
    expect(report.diagnostics).toHaveLength(0);
  });

  it("reproduces all SAL-* security & contract diagnostic codes", () => {
    // 1. SAL-TOML-001
    expect(validateLimbManifestToml("not = [valid toml", base, slots).diagnostics[0]?.code).toBe(
      "SAL-TOML-001"
    );

    // 2. SAL-SCHEMA-001, SAL-SLOT-001, SAL-UI-001, SAL-ROUTE-001, SAL-EGRESS-001, SAL-PERM-001
    const badLimb = `
[limb]
id = "-BAD_ID-"
name = "Exfil Bot"
version = "0.1.0"
level = 2
author = "uid:attacker"

[requires]
contract = ">=1.0"
base = "xkmato"
slots = ["unknown.slot"]

[[ui]]
slot = "unknown.slot"
component = "ui/Widget.html"
isolation = "same-origin-personal"

[[functions]]
route = "/api/wrong-prefix"
method = "POST"
handler = "functions/bad.ts"

[permissions]
data_read = ["dms"]
data_write = []
egress = ["169.254.169.254"]
sidecar = "none"
`;
    const report = validateLimbManifestToml(badLimb, base, slots, true);
    expect(report.valid).toBe(false);
    const codes = report.diagnostics.map((d) => d.code);
    expect(codes).toContain("SAL-SCHEMA-001");
    expect(codes).toContain("SAL-SLOT-001");
    expect(codes).toContain("SAL-UI-001");
    expect(codes).toContain("SAL-ROUTE-001");
    expect(codes).toContain("SAL-EGRESS-001");
    expect(codes).toContain("SAL-PERM-001");

    // 3. SAL-LEVEL-001 & SAL-LEVEL-002
    const l1WithEgress = LUGANDA_TTS_TOML.replace("level = 2", "level = 1");
    expect(
      validateLimbManifestToml(l1WithEgress, base, slots, false).diagnostics.map((d) => d.code)
    ).toContain("SAL-LEVEL-002");

    const baseNoL3 = { ...base, extensions: { ...base.extensions, allow_levels: [1, 2] as Array<1 | 2> } };
    const l3MissingPatch = `
[limb]
id = "variant-test"
name = "Variant Test"
version = "0.1.0"
level = 3
author = "uid:dev"

[requires]
contract = ">=1.0"
base = "xkmato"

[permissions]
data_read = ["posts"]
data_write = []
egress = []
sidecar = "none"
`;
    const l3Report = validateLimbManifestToml(l3MissingPatch, baseNoL3, slots, false);
    expect(l3Report.diagnostics.map((d) => d.code)).toContain("SAL-LEVEL-001");
    expect(l3Report.diagnostics.map((d) => d.code)).toContain("SAL-PATCH-001");

    // 4. SAL-EDIT-001 & SAL-PERM-002
    const l3TamperRules = `
[limb]
id = "rule-tamper"
name = "Tamper Rules"
version = "0.1.0"
level = 3
author = "uid:attacker"

[requires]
contract = ">=1.0"
base = "xkmato"

[patch]
digest = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
touches = ["app/page.tsx", "firestore.rules"]

[permissions]
data_read = ["admin"]
data_write = []
egress = []
sidecar = "none"
`;
    const tamperReport = validateLimbManifestToml(l3TamperRules, base, slots, false);
    expect(tamperReport.diagnostics.map((d) => d.code)).toContain("SAL-EDIT-001");
    expect(tamperReport.diagnostics.map((d) => d.code)).toContain("SAL-PERM-002");
  });
});
