# Newt

**Newt** is a standalone, platform-portable **AI-Agentic UI & Limb Authoring Studio** in the **[Amphibian](https://xkmato.com/s/rlelxi77)** class alongside **[Salamanda](https://github.com/xkmato/salamanda)**.

While **Salamanda** is the Rust session-overlay & variant runtime (`:8080` Edge Proxy + `:7474` Control Plane), **Newt** is the standalone authoring tool and fail-open browser bridge that enables users to prompt, preview, validate, and publish custom UIs and platform features ("Limbs")—starting with **XKmato** while remaining portable to any web application via `/.well-known/amphibian.json`.

## Workspace Packages & Apps (Milestones 0–6)

- `@newt/contract` (`packages/contract`) — Salamanda Public Contract `v1.0.0` JSON schemas, TOML manifest parser/serializer, 100% parity offline `SAL-*` policy validator (including `SAL-EDIT-001` Level 3 `edit_allow`/`edit_deny` hard-deny enforcement), `SalamandaControlPlaneClient`, and consumer-driven `v1.1` RFC contract tests.
- `@newt/base-sdk` (`packages/base-sdk`) — Portable `AmphibianPlatformManifest` (`/.well-known/amphibian.json`) specification, semantic `--newt-*` CSS variable mapper, singleton/repeater slot model, LLM context formatter, and zero-config HTML/CSS landmark auto-inspector.
- `@newt/base-xkmato` (`packages/base-xkmato`) — Ground-truth Base Target Pack for XKmato (routes, 9 slots, `shadcn/ui` `oklch` theme tokens, `BlogPost` / `Micropost` canonical schemas, and realistic TipTap essay fixtures).
- `@newt/ui-sdk` (`packages/ui-sdk`) — Ultra-lightweight (`< 3 KB` gzipped) client runtime bundled into generated UIs (`useSlotContext`, `usePlatformTheme`, `useSidecarQuery`, `executeSidecar`, `readCanonical`, broker-proxied `invokeLimbFunction`, and `autoResizeFrame`).
- `@newt/bridge` (`packages/bridge`) — Fail-open, zero-dependency (`< 4 KB` gzipped) auth-agnostic browser bridge (`<amphibian-slot>` Shadow DOM mounter, `MutationObserver` repeater hydration, Visual Slot Picker, non-modal `<dialog popover="manual">` drawer, `MessageChannel` `newt.host.v1` auth handoff, and `2.5s` fail-open probe).
- `@newt/compiler` (`packages/compiler`) — Deterministic VFS compiler (`esbuild` TSX -> single-file `srcdoc` HTML with SHA-256 script-hash CSP, `sql.js` migration dry-runner, L2 `@host:` verifier, L3 `patches/variant.patch` `sha256` + `SAL-EDIT-001` verifier, JSDOM smoke runner, and `MockSalamandaHostBroker`).
- `@newt/db` (`packages/db`) — Zero-ops SQLite WAL persistence (`node:sqlite`) for projects, immutable VFS checkpoints, snapshot diffs, 1-click rollback, threads/messages, deployments, and gallery monetization entitlements.
- `@newt/agents` (`packages/agents`) — Platform-agnostic multi-agent synthesis engine (Google Gemini default via `@google/genai`, plus Anthropic/OpenAI/Ollama), prompt-injection `Gatekeeper`, parallel `Architect`/`DataAndFunctions`/`UiCraftsman`/`VariantPatchAgent` state machine (with Level 3 gate controlled by `NEWT_ENABLE_L3_VARIANTS`), and bounded `RepairAgent` self-healing loop.
- `@newt/studio` (`apps/studio`) — Standalone Next.js Studio, `/embed` In-App Builder Drawer, `/gallery` with native modal Permission Consent Cards, `/bridge.js`, pluggable HMAC `EntitlementVerifier` webhook, live Salamanda `ClientDelegationAuth` deployment/publish/bindings routes (`/deploy`, `/publish`, `/bindings/me`), Pluggable Base Shell Simulator, Code/Diff Editor, in-browser `sql.js` Sidecar Explorer, Contract/Security Inspector, and Level 3 Variant Workbench (Patch Diff Review, async Git worktree `Materializing -> Building -> Starting -> Running` progress streaming, and `Stale` Rebase Conflict Resolution with 1-click AI self-repair).
- `@newt/cli` (`packages/cli`) — Standalone `newt` CLI (`init`, `studio`, `dev`, `build`, `validate`, `inspect-url`, `doctor`).
- `docs/salamanda-rfcs/` — Ready-to-merge upstream Salamanda `v1.1` RFCs and patches (`RFC-0001`, `RFC-0002`, `RFC-0003`).
- `examples/generic-blog-demo/` — Zero-Next.js, zero-Firebase vanilla Node/HTML blog platform proving cross-platform portability of `@newt/bridge` + Newt Studio.

## Quickstart

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @newt/studio test:e2e

# Launch Standalone Newt Studio (http://127.0.0.1:3100)
pnpm studio

# Or use the standalone CLI
pnpm newt doctor
pnpm newt init ./my-limb --base xkmato --slot blog.sidebar
pnpm newt build ./my-limb
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the complete system architecture and `M0`–`M6` execution roadmap.
