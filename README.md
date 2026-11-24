# Newt

**Newt** is a standalone, platform-portable **AI-Agentic UI & Limb Authoring Studio** in the **[Amphibian](https://xkmato.com/s/rlelxi77)** class alongside **[Salamanda](https://github.com/xkmato/salamanda)**.

While **Salamanda** is the Rust session-overlay & variant runtime (`:8080` Edge Proxy + `:7474` Control Plane), **Newt** is the standalone authoring tool and fail-open browser bridge that enables users to prompt, preview, validate, and publish custom UIs and platform features ("Limbs")—starting with **XKmato** while remaining portable to any web application via `/.well-known/amphibian.json`.

## Workspace Packages (Milestone 0)

- `@newt/contract` (`packages/contract`) — Salamanda Public Contract `v1.0.0` JSON schemas, TOML manifest parser/serializer, 100% parity offline `SAL-*` policy validator, and `SalamandaControlPlaneClient`.
- `@newt/base-sdk` (`packages/base-sdk`) — Portable `AmphibianPlatformManifest` (`/.well-known/amphibian.json`) specification, semantic `--newt-*` CSS variable mapper, singleton/repeater slot model, LLM context formatter, and zero-config HTML/CSS landmark auto-inspector.
- `@newt/base-xkmato` (`packages/base-xkmato`) — Ground-truth Base Target Pack for XKmato (routes, 9 slots, `shadcn/ui` `oklch` theme tokens, `BlogPost` / `Micropost` canonical schemas, and realistic TipTap essay fixtures).

## Quickstart

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the complete system architecture and `M0`–`M6` execution roadmap.
