import type { BasePack } from "@newt/base-sdk";
import { xkmatoFixtures } from "./fixtures.js";
import { xkmatoBaseSpec, xkmatoPlatformManifest } from "./manifest.js";

export * from "./manifest.js";
export * from "./fixtures.js";

export const xkmatoBasePack: BasePack<typeof xkmatoFixtures> = {
  manifest: xkmatoPlatformManifest,
  baseSpec: xkmatoBaseSpec,
  fixtures: xkmatoFixtures,
};
