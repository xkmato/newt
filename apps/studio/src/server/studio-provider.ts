import {
  createLlmProviderFromEnv,
  type LlmGenerateJsonRequest,
  type LlmGenerateJsonResponse,
  type LlmProvider,
} from "@newt/agents";
import type { AmphibianPlatformManifest } from "@newt/base-sdk";
import { serializeLimbManifestToml } from "@newt/contract";

function slugify(input: string, fallback: string): string {
  const clean = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (clean.length >= 3) return clean;
  return fallback;
}

function extractUserIntent(userPrompt: string): string {
  const xmlMatch = userPrompt.match(/<user_intent>\s*([\s\S]*?)\s*<\/user_intent>/i);
  if (xmlMatch?.[1]) return xmlMatch[1].trim();
  const reqMatch = userPrompt.match(/User Request:\s*([^\n]+)/i);
  if (reqMatch?.[1]) return reqMatch[1].trim();
  return userPrompt.trim();
}

function extractBaseId(systemPrompt: string): string {
  const match =
    systemPrompt.match(/base = "([^"]+)"/) ??
    systemPrompt.match(/Target base id:\s*"([^"]+)"/i);
  return match?.[1] ?? "xkmato";
}

function extractPreferredSlot(userPrompt: string): string | null {
  const match = userPrompt.match(/Preferred Target Slot:\s*([a-z0-9._-]+)/i);
  return match?.[1] ?? null;
}

interface ParsedBlueprintHint {
  mode: "standalone-ui" | "salamanda-limb";
  limbId: string;
  displayName: string;
  description: string;
  slot: string;
  routePattern: string;
  entryFile: string;
  compiledAsset: string;
  sidecarScope: "none" | "personal" | "shared" | "scratch";
  baseId: string;
}

function parseBlueprintFromPrompt(userPrompt: string, systemPrompt: string): ParsedBlueprintHint {
  const baseId = extractBaseId(systemPrompt);
  const start =
    userPrompt.indexOf("Blueprint JSON:") !== -1
      ? userPrompt.indexOf("Blueprint JSON:")
      : userPrompt.indexOf("LimbBlueprint:");
  if (start !== -1) {
    const jsonStart = userPrompt.indexOf("{", start);
    if (jsonStart !== -1) {
      let depth = 0;
      let end = -1;
      for (let i = jsonStart; i < userPrompt.length; i++) {
        const ch = userPrompt[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end !== -1) {
        try {
          const bp = JSON.parse(userPrompt.slice(jsonStart, end + 1)) as {
            mode?: "standalone-ui" | "salamanda-limb";
            limbId?: string;
            displayName?: string;
            description?: string;
            uiMounts?: Array<{
              slot: string;
              routePattern?: string;
              entryFile: string;
              compiledAsset: string;
            }>;
            sidecar?: { scope?: "none" | "personal" | "shared" | "scratch" };
          };
          const mount = bp.uiMounts?.[0];
          return {
            mode: bp.mode ?? (baseId === "standalone" ? "standalone-ui" : "salamanda-limb"),
            limbId: bp.limbId ?? "newt-widget",
            displayName: bp.displayName ?? "Newt Widget",
            description: bp.description ?? "Synthesized by Newt Studio",
            slot: mount?.slot ?? (baseId === "standalone" ? "standalone.canvas" : "blog.sidebar"),
            routePattern: mount?.routePattern ?? "/*",
            entryFile: mount?.entryFile ?? "src/ui/Widget.tsx",
            compiledAsset: mount?.compiledAsset ?? "ui/Widget.html",
            sidecarScope: bp.sidecar?.scope ?? "personal",
            baseId,
          };
        } catch {
          // fall through
        }
      }
    }
  }
  return {
    mode: baseId === "standalone" ? "standalone-ui" : "salamanda-limb",
    limbId: "newt-widget",
    displayName: "Newt Widget",
    description: "Synthesized by Newt Studio",
    slot: baseId === "standalone" ? "standalone.canvas" : "blog.sidebar",
    routePattern: baseId === "xkmato" ? "/blog/*" : "/*",
    entryFile: "src/ui/Widget.tsx",
    compiledAsset: "ui/Widget.html",
    sidecarScope: baseId === "standalone" ? "none" : "personal",
    baseId,
  };
}

function buildStandaloneWidgetTsx(displayName: string, prompt: string): string {
  const isPomodoro = /timer|pomodoro|focus|clock/i.test(prompt);
  const titleSafe = JSON.stringify(displayName);
  if (isPomodoro) {
    return `import { useEffect, useState } from "preact/hooks";
import { useSlotContext } from "@newt/ui-sdk";

export default function FocusWidget() {
  const ctx = useSlotContext();
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [tasks, setTasks] = useState<Array<{ id: number; label: string; done: boolean }>>([
    { id: 1, label: "Draft Amphibian essay notes", done: false },
    { id: 2, label: "Verify dark mode contrast tokens", done: true },
  ]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const secs = String(secondsLeft % 60).padStart(2, "0");

  const addTask = (e: Event) => {
    e.preventDefault();
    const label = draft.trim();
    if (!label) return;
    setTasks((prev) => [...prev, { id: Date.now(), label, done: false }]);
    setDraft("");
  };

  return (
    <section
      aria-label=${titleSafe}
      style={{
        background: "var(--newt-card)",
        color: "var(--newt-fg)",
        border: "1px solid var(--newt-border)",
        borderRadius: "var(--newt-radius)",
        padding: "16px",
        display: "grid",
        gap: "12px",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>${displayName}</h2>
          <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--newt-muted)" }}>
            Theme: {ctx.theme} · Slot: {ctx.slotId}
          </p>
        </div>
        <span
          data-testid="timer-display"
          style={{
            fontVariantNumeric: "tabular-nums",
            fontSize: "22px",
            fontWeight: 700,
            color: "var(--newt-primary)",
          }}
        >
          {mins}:{secs}
        </span>
      </header>

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          onClick={() => setRunning((r) => !r)}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: "8px",
            border: "none",
            background: "var(--newt-primary)",
            color: "var(--newt-primary-fg)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {running ? "Pause" : "Start Focus"}
        </button>
        <button
          type="button"
          onClick={() => {
            setRunning(false);
            setSecondsLeft(25 * 60);
          }}
          style={{
            padding: "8px 12px",
            borderRadius: "8px",
            border: "1px solid var(--newt-border)",
            background: "var(--newt-surface)",
            color: "var(--newt-fg)",
            cursor: "pointer",
          }}
        >
          Reset
        </button>
      </div>

      <form onSubmit={addTask} style={{ display: "flex", gap: "8px" }}>
        <input
          type="text"
          aria-label="New focus task"
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          placeholder="Add a focus task..."
          style={{
            flex: 1,
            padding: "7px 10px",
            borderRadius: "8px",
            border: "1px solid var(--newt-border)",
            background: "var(--newt-bg)",
            color: "var(--newt-fg)",
            fontSize: "13px",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "7px 12px",
            borderRadius: "8px",
            border: "1px solid var(--newt-border)",
            background: "var(--newt-accent)",
            color: "var(--newt-accent-fg)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Add
        </button>
      </form>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" }}>
        {tasks.map((task) => (
          <li
            key={task.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 8px",
              borderRadius: "6px",
              background: "var(--newt-surface)",
              fontSize: "13px",
            }}
          >
            <input
              type="checkbox"
              checked={task.done}
              onChange={() =>
                setTasks((prev) =>
                  prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t))
                )
              }
            />
            <span style={{ textDecoration: task.done ? "line-through" : "none" }}>{task.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
`;
  }

  return `import { useState } from "preact/hooks";
import { useSlotContext } from "@newt/ui-sdk";

export default function StandaloneWidget() {
  const ctx = useSlotContext();
  const [count, setCount] = useState(1);
  const [items, setItems] = useState<string[]>(["Portable semantic tokens", "Strict inline CSP"]);
  const [input, setInput] = useState("");

  const handleAdd = (e: Event) => {
    e.preventDefault();
    const next = input.trim();
    if (!next) return;
    setItems((prev) => [next, ...prev]);
    setInput("");
  };

  return (
    <section
      aria-label=${titleSafe}
      style={{
        background: "var(--newt-card)",
        color: "var(--newt-fg)",
        border: "1px solid var(--newt-border)",
        borderRadius: "var(--newt-radius)",
        padding: "16px",
        display: "grid",
        gap: "12px",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>${displayName}</h2>
          <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--newt-muted)" }}>
            Standalone Widget · Theme: {ctx.theme}
          </p>
        </div>
        <button
          type="button"
          data-testid="standalone-counter-btn"
          onClick={() => setCount((c) => c + 1)}
          style={{
            padding: "6px 12px",
            borderRadius: "999px",
            border: "none",
            background: "var(--newt-primary)",
            color: "var(--newt-primary-fg)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Count: {count}
        </button>
      </header>

      <form onSubmit={handleAdd} style={{ display: "flex", gap: "8px" }}>
        <input
          type="text"
          aria-label="Add widget item"
          value={input}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          placeholder="Add an item..."
          style={{
            flex: 1,
            padding: "7px 10px",
            borderRadius: "8px",
            border: "1px solid var(--newt-border)",
            background: "var(--newt-bg)",
            color: "var(--newt-fg)",
            fontSize: "13px",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "7px 12px",
            borderRadius: "8px",
            border: "1px solid var(--newt-border)",
            background: "var(--newt-accent)",
            color: "var(--newt-accent-fg)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Add
        </button>
      </form>

      <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", display: "grid", gap: "4px" }}>
        {items.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
`;
}

function buildSidebarNotesTsx(displayName: string, sidecarScope: "personal" | "shared"): string {
  const titleSafe = JSON.stringify(displayName);
  const scopeLiteral = JSON.stringify(sidecarScope);
  return `import { useState } from "preact/hooks";
import { executeSidecar, useSidecarQuery, useSlotContext } from "@newt/ui-sdk";

interface MarginNoteRow {
  id: number;
  post_slug: string;
  body: string;
  created_at: string;
}

export default function SidebarMarginNotes() {
  const ctx = useSlotContext();
  const postSlug = ctx.props["post-slug"] ?? ctx.props["post-id"] ?? "launching-amphibian";
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: notes, loading, error, refetch } = useSidecarQuery<MarginNoteRow>(
    ${scopeLiteral},
    "SELECT id, post_slug, body, created_at FROM margin_notes WHERE post_slug = ? ORDER BY id DESC",
    [postSlug]
  );

  const handleSave = async (e: Event) => {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean || saving) return;
    setSaving(true);
    try {
      await executeSidecar(
        ${scopeLiteral},
        "INSERT INTO margin_notes (post_slug, body, created_at) VALUES (?, ?, ?)",
        [postSlug, clean, new Date().toISOString()]
      );
      setDraft("");
      await refetch();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label=${titleSafe}
      style={{
        background: "var(--newt-card)",
        color: "var(--newt-fg)",
        border: "1px solid var(--newt-border)",
        borderRadius: "var(--newt-radius)",
        padding: "14px",
        display: "grid",
        gap: "10px",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>${displayName}</h2>
        <span style={{ fontSize: "11px", color: "var(--newt-muted)" }}>
          {ctx.theme} · {notes.length} saved
        </span>
      </header>

      <form onSubmit={handleSave} style={{ display: "grid", gap: "8px" }}>
        <textarea
          aria-label="Margin note text"
          rows={2}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          placeholder={"Jot a private note on " + postSlug + "..."}
          style={{
            width: "100%",
            resize: "vertical",
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid var(--newt-border)",
            background: "var(--newt-bg)",
            color: "var(--newt-fg)",
            fontSize: "13px",
            fontFamily: "inherit",
          }}
        />
        <button
          type="submit"
          disabled={saving}
          data-testid="save-note-btn"
          style={{
            padding: "7px 12px",
            borderRadius: "8px",
            border: "none",
            background: "var(--newt-primary)",
            color: "var(--newt-primary-fg)",
            fontWeight: 600,
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          {saving ? "Saving..." : "Save Note to SQLite"}
        </button>
      </form>

      {error ? (
        <p style={{ margin: 0, fontSize: "12px", color: "#ef4444" }}>{error}</p>
      ) : loading ? (
        <p style={{ margin: 0, fontSize: "12px", color: "var(--newt-muted)" }}>Loading sidecar...</p>
      ) : notes.length === 0 ? (
        <p style={{ margin: 0, fontSize: "12px", color: "var(--newt-muted)" }}>
          No notes yet for <code>{postSlug}</code>.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" }}>
          {notes.map((n) => (
            <li
              key={n.id}
              style={{
                padding: "8px 10px",
                borderRadius: "8px",
                background: "var(--newt-surface)",
                border: "1px solid var(--newt-border)",
                fontSize: "12.5px",
              }}
            >
              <div>{n.body}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
`;
}

function buildRepeaterReactionTsx(displayName: string): string {
  const titleSafe = JSON.stringify(displayName);
  return `import { executeSidecar, useSidecarQuery, useSlotContext } from "@newt/ui-sdk";

interface ReactionRow {
  post_id: string;
  count: number;
}

export default function MicropostReactions() {
  const ctx = useSlotContext();
  const postId = ctx.props["post-id"] ?? ctx.instanceKey;
  const { data, refetch } = useSidecarQuery<ReactionRow>(
    "personal",
    "SELECT post_id, count FROM post_reactions WHERE post_id = ?",
    [postId]
  );
  const count = Number(data[0]?.count ?? 0);

  const bump = async () => {
    await executeSidecar(
      "personal",
      "INSERT INTO post_reactions (post_id, count) VALUES (?, 1) ON CONFLICT(post_id) DO UPDATE SET count = count + 1",
      [postId]
    );
    await refetch();
  };

  return (
    <div
      aria-label=${titleSafe}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "4px 2px",
        fontSize: "12px",
        color: "var(--newt-muted)",
      }}
    >
      <button
        type="button"
        onClick={bump}
        style={{
          padding: "4px 10px",
          borderRadius: "999px",
          border: "1px solid var(--newt-border)",
          background: "var(--newt-surface)",
          color: "var(--newt-fg)",
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        ✦ Bookmark ({count})
      </button>
      <span>post: {postId.slice(0, 8)}</span>
    </div>
  );
}
`;
}

function buildBlogHeaderTtsTsx(displayName: string): string {
  const titleSafe = JSON.stringify(displayName);
  return `import { useState } from "preact/hooks";
import { useSlotContext } from "@newt/ui-sdk";

export default function BlogHeaderCompanion() {
  const ctx = useSlotContext();
  const [playing, setPlaying] = useState(false);
  const readingTime = ctx.props["reading-time"] ?? "4";
  const slug = ctx.props["post-slug"] ?? "article";

  return (
    <div
      aria-label=${titleSafe}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "10px 14px",
        borderRadius: "var(--newt-radius)",
        background: "var(--newt-surface)",
        border: "1px solid var(--newt-border)",
        color: "var(--newt-fg)",
        fontSize: "13px",
      }}
    >
      <div>
        <strong>${displayName}</strong>
        <span style={{ marginLeft: "8px", color: "var(--newt-muted)" }}>
          {readingTime} min listen · {slug}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        style={{
          padding: "6px 12px",
          borderRadius: "999px",
          border: "none",
          background: "var(--newt-primary)",
          color: "var(--newt-primary-fg)",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {playing ? "Pause Audio" : "Play Audio"}
      </button>
    </div>
  );
}
`;
}

/**
 * Deterministic offline Studio Synthesizer implementing `LlmProvider`.
 * Used automatically when no live API key (`GEMINI_API_KEY`, etc.) is configured or when
 * `NEWT_STUDIO_DEMO_PROVIDER=1` is set (e.g., offline demos & Playwright E2E).
 */
export class StudioDeterministicLlmProvider implements LlmProvider {
  readonly providerName = "studio-local";
  readonly modelName = "newt-deterministic-v1";
  private lastUserIntent = "";

  constructor(private readonly manifestResolver?: (baseId: string) => AmphibianPlatformManifest | null) {}

  async generateJson<T = unknown>(
    req: LlmGenerateJsonRequest
  ): Promise<LlmGenerateJsonResponse<T>> {
    const usage = {
      provider: this.providerName,
      model: this.modelName,
      inputTokens: Math.max(80, Math.round(req.userPrompt.length / 4)),
      outputTokens: 240,
    };

    if (req.role === "architect") {
      const intent = extractUserIntent(req.userPrompt);
      this.lastUserIntent = intent;
      const baseId = extractBaseId(req.systemPrompt);
      const preferredSlot = extractPreferredSlot(req.userPrompt);
      const manifest = this.manifestResolver?.(baseId) ?? null;

      const l3AllowedBySystem = /Enabled Extension Levels:\s*\[[^\]]*3[^\]]*\]/i.test(
        req.systemPrompt
      );
      const wantsL3 =
        l3AllowedBySystem &&
        /\b(level\s*3|l3|variant|layout\s+patch|source\s+patch|rebase|full[- ]source|root\s+layout)\b/i.test(
          intent
        );

      if (wantsL3) {
        const displayName = "Custom Layout Variant";
        const limbId = slugify(displayName, "custom-layout-variant");
        return {
          data: {
            mode: "salamanda-limb",
            limbId,
            displayName,
            description: intent.slice(0, 200) || "Level 3 full-source layout variant",
            level: 3,
            rationale:
              "Level 3 full-source variant gate is enabled and the requested layout edit modifies base source templates.",
            uiMounts: [],
            patch: {
              diffFile: "patches/variant.patch",
              touches: ["app/page.html"],
              summary: "Minimal unified diff updating base layout heading",
            },
            sidecar: { scope: "none", tables: [] },
            functions: [],
            permissions: {
              dataRead: [],
              egress: [],
              maxMemoryMb: 256,
              maxCpuMs: 2000,
            },
            designSpec: {
              layoutPattern: "source-variant",
              semanticTokensUsed: ["--newt-bg", "--newt-fg"],
              states: ["populated"],
              accessibilityNotes: "Preserves semantic landmarks in base template",
            },
          } as T,
          usage,
        };
      }

      const isStandalone = baseId === "standalone" || /standalone|widget|pomodoro|focus timer/i.test(intent) && baseId === "standalone";
      let slot =
        preferredSlot ??
        (isStandalone
          ? "standalone.canvas"
          : /micropost|repeater|feed card|reaction/i.test(intent)
            ? "micropost.footer"
            : /header|tts|audio|listen|luganda/i.test(intent)
              ? "blog.header"
              : manifest?.slots.find((s) => s.id === "blog.sidebar")?.id ??
                manifest?.slots[0]?.id ??
                "blog.sidebar");

      const slotObj = manifest?.slots.find((s) => s.id === slot);
      if (manifest && !slotObj && manifest.slots[0]) {
        slot = manifest.slots[0].id;
      }
      const routePattern =
        slotObj?.routes[0] ??
        (slot.startsWith("blog.") ? "/blog/*" : slot === "micropost.footer" ? "/feed" : "/*");

      const isRepeater = slotObj?.cardinality === "repeater" || slot === "micropost.footer";
      const isHeader = slot === "blog.header";
      const useSidecar = !isStandalone && !isHeader;
      const sidecarScope = useSidecar ? (/poll|shared|community/i.test(intent) ? "shared" : "personal") : "none";

      const displayName = isStandalone
        ? /timer|pomodoro|focus/i.test(intent)
          ? "Focus Timer & Tasks"
          : "Standalone Interactive Widget"
        : isRepeater
          ? "Micropost Bookmark Bar"
          : isHeader
            ? "Article Audio Companion"
            : "Blog Sidebar Margin Notes";

      const limbId = slugify(displayName, "newt-limb");
      const componentName = isStandalone
        ? "StandaloneWidget"
        : isRepeater
          ? "MicropostBar"
          : isHeader
            ? "HeaderAudio"
            : "MarginNotes";

      const tables =
        sidecarScope === "none"
          ? []
          : isRepeater
            ? [{ name: "post_reactions", ddlSummary: "post_id TEXT PRIMARY KEY, count INTEGER NOT NULL" }]
            : [
                {
                  name: "margin_notes",
                  ddlSummary:
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, post_slug TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL",
                },
              ];

      return {
        data: {
          mode: isStandalone ? "standalone-ui" : "salamanda-limb",
          limbId,
          displayName,
          description: intent.slice(0, 200) || `Synthesized ${displayName}`,
          level: 1,
          rationale: `Level 1 declarative slot (${slot}) with ${sidecarScope} sidecar cleanly fulfills the request.`,
          uiMounts: [
            {
              slot,
              routePattern,
              entryFile: `src/ui/${componentName}.tsx`,
              compiledAsset: `ui/${componentName}.html`,
              isolation: "iframe",
            },
          ],
          sidecar: {
            scope: sidecarScope,
            tables,
          },
          functions: [],
          permissions: {
            dataRead:
              manifest?.permissions_catalog?.readable_collections?.includes("blogposts") && !isStandalone
                ? ["blogposts"]
                : [],
            egress: [],
            maxMemoryMb: 64,
            maxCpuMs: 400,
          },
          designSpec: {
            layoutPattern: isRepeater ? "compact-toolbar" : "card",
            semanticTokensUsed: [
              "--newt-card",
              "--newt-surface",
              "--newt-fg",
              "--newt-muted",
              "--newt-primary",
              "--newt-border",
              "--newt-radius",
            ],
            states: ["loading", "empty", "populated", "error"],
            accessibilityNotes: "Semantic landmarks, explicit button types, and labeled inputs.",
          },
        } as T,
        usage,
      };
    }

    if (req.role === "data-functions") {
      const bp = parseBlueprintFromPrompt(req.userPrompt, req.systemPrompt);
      const manifest = this.manifestResolver?.(bp.baseId) ?? null;
      const slotMeta = manifest?.slots.find((s) => s.id === bp.slot);
      const isRepeater = slotMeta?.cardinality === "repeater" || bp.slot === "micropost.footer";
      const firstReadable = manifest?.permissions_catalog?.readable_collections?.[0];
      const manifestToml = serializeLimbManifestToml({
        limb: {
          id: bp.limbId,
          name: bp.displayName,
          version: "0.1.0",
          level: 1,
          author: "uid:studio",
          description: bp.description,
        },
        requires: {
          contract: ">=1.0",
          base: bp.baseId,
          slots: [bp.slot],
        },
        ui: [
          {
            slot: bp.slot,
            route_pattern: bp.routePattern,
            component: bp.compiledAsset,
            isolation: "iframe",
          },
        ],
        permissions: {
          data_read: firstReadable ? [firstReadable] : [],
          data_write: [],
          egress: [],
          sidecar: bp.sidecarScope,
          max_memory_mb: 64,
          max_cpu_ms: 400,
        },
        ...(bp.sidecarScope !== "none" ? { sidecar: { migrations: "migrations/" } } : {}),
      });

      const files: Array<{ path: string; content: string }> = [
        { path: "limb.toml", content: manifestToml },
      ];

      if (bp.sidecarScope !== "none") {
        if (isRepeater) {
          files.push({
            path: "migrations/001_init.sql",
            content:
              "CREATE TABLE IF NOT EXISTS post_reactions (\n  post_id TEXT PRIMARY KEY,\n  count INTEGER NOT NULL DEFAULT 0\n);\n",
          });
        } else {
          files.push({
            path: "migrations/001_init.sql",
            content:
              "CREATE TABLE IF NOT EXISTS margin_notes (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  post_slug TEXT NOT NULL,\n  body TEXT NOT NULL,\n  created_at TEXT NOT NULL\n);\n",
          });
          files.push({
            path: "fixtures/seed.sql",
            content:
              "INSERT INTO margin_notes (post_slug, body, created_at) VALUES ('launching-amphibian', 'Highlight: Luganda TTS & living software thesis', '2026-11-24T10:00:00.000Z');\n",
          });
        }
      }

      return {
        data: {
          summary: `Generated limb.toml${bp.sidecarScope !== "none" ? " and SQLite sidecar migration" : ""}`,
          files,
        } as T,
        usage,
      };
    }

    if (req.role === "ui-craftsman") {
      const bp = parseBlueprintFromPrompt(req.userPrompt, req.systemPrompt);
      const manifest = this.manifestResolver?.(bp.baseId) ?? null;
      const slotMeta = manifest?.slots.find((s) => s.id === bp.slot);
      const isRepeater = slotMeta?.cardinality === "repeater" || bp.slot === "micropost.footer";
      let code: string;
      if (bp.mode === "standalone-ui" || bp.baseId === "standalone") {
        code = buildStandaloneWidgetTsx(bp.displayName, this.lastUserIntent || bp.description);
      } else if (isRepeater) {
        code = buildRepeaterReactionTsx(bp.displayName);
      } else if (bp.slot === "blog.header") {
        code = buildBlogHeaderTtsTsx(bp.displayName);
      } else {
        code = buildSidebarNotesTsx(
          bp.displayName,
          bp.sidecarScope === "shared" ? "shared" : "personal"
        );
      }

      return {
        data: {
          summary: `Synthesized ${bp.displayName} UI component (${bp.entryFile})`,
          files: [{ path: bp.entryFile, content: code }],
        } as T,
        usage,
      };
    }

    if (req.role === "variant-patch") {
      // Extract either upstream conflict file or base source file so generated unified diff always applies cleanly via `git apply`!
      const fileMatch =
        req.userPrompt.match(/=== UPSTREAM FILE:\s*([^\s=]+)\s*===\n([\s\S]*?)(?:\n=== |$)/) ??
        req.userPrompt.match(/=== BASE FILE:\s*([^\s=]+)\s*===\n([\s\S]*?)(?:\n=== |$)/);
      const targetPath = fileMatch?.[1]?.trim() ?? "src/app/page.tsx";
      const rawContent = (fileMatch?.[2] ?? "<h1>Vanilla Base Layout</h1>\n").trimEnd();
      const lines = rawContent.split("\n");
      const firstLine = lines[0] ?? "<h1>Vanilla Base Layout</h1>";
      const patchedFirstLine = firstLine.includes("<h1")
        ? firstLine.replace(/>([^<]*)</, ">Custom L3 Layout Variant — $1<")
        : `/* Newt L3 Variant */ ${firstLine}`;

      const diffLines = [
        `--- a/${targetPath}`,
        `+++ b/${targetPath}`,
        `@@ -1,${lines.length} +1,${lines.length} @@`,
        `-${firstLine}`,
        `+${patchedFirstLine}`,
        ...lines.slice(1).map((l) => ` ${l}`),
        "",
      ];

      return {
        data: {
          summary: `Synthesized minimal Level 3 unified diff for ${targetPath}`,
          diffFile: "patches/variant.patch",
          diff: diffLines.join("\n"),
          touches: [targetPath],
        } as T,
        usage,
      };
    }

    // Repair fallback
    const bp = parseBlueprintFromPrompt(req.userPrompt, req.systemPrompt);
    return {
      data: {
        diagnosis: "Applied fallback repair to ensure clean compilation",
        edits: [
          {
            path: bp.entryFile,
            content: buildStandaloneWidgetTsx(bp.displayName, bp.description),
          },
        ],
      } as T,
      usage,
    };
  }
}

export function resolveStudioLlmProvider(
  manifestResolver?: (baseId: string) => AmphibianPlatformManifest | null,
  env: Record<string, string | undefined> = process.env
): { provider: LlmProvider; mode: "live" | "studio-local" } {
  if (env.NEWT_STUDIO_DEMO_PROVIDER === "1") {
    return {
      provider: new StudioDeterministicLlmProvider(manifestResolver),
      mode: "studio-local",
    };
  }

  try {
    return {
      provider: createLlmProviderFromEnv(env),
      mode: "live",
    };
  } catch {
    return {
      provider: new StudioDeterministicLlmProvider(manifestResolver),
      mode: "studio-local",
    };
  }
}
