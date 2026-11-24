export * from "./commands.js";

import {
  type CliIo,
  runBuildCommand,
  runDevCommand,
  runDoctorCommand,
  runInitCommand,
  runInspectUrlCommand,
  runStudioCommand,
  runValidateCommand,
} from "./commands.js";

function parseFlags(argv: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      if (eqIdx !== -1) {
        flags[token.slice(2, eqIdx)] = token.slice(eqIdx + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(token);
    }
  }

  return { positional, flags };
}

const HELP_TEXT = `newt — Standalone AI-Agentic UI & Salamanda Limb CLI

Usage:
  newt init [dir] [--base xkmato|standalone] [--level 1|2] [--slot <slot>] [--name <name>]
  newt build [dir] [--out dist-limb] [--base xkmato|standalone|<amphibian.json>] [--shared]
  newt validate [dir] [--base xkmato|standalone|<amphibian.json>] [--shared] [--json] [--salamanda <url>]
  newt inspect-url <url> [--out amphibian.json]
  newt dev [dir] [--port 4173] [--base xkmato|standalone|<amphibian.json>]
  newt studio [--port 3100]
  newt doctor
`;

export async function runCli(
  argv: string[],
  io?: CliIo
): Promise<number> {
  const out = io ?? {
    stdout: (line: string) => process.stdout.write(`${line}\n`),
    stderr: (line: string) => process.stderr.write(`${line}\n`),
  };

  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    out.stdout(HELP_TEXT);
    return 0;
  }

  const { positional, flags } = parseFlags(rest);

  try {
    if (cmd === "init") {
      runInitCommand(
        {
          dir: positional[0] ?? ".",
          base: typeof flags.base === "string" ? flags.base : undefined,
          name: typeof flags.name === "string" ? flags.name : undefined,
          slot: typeof flags.slot === "string" ? flags.slot : undefined,
          level: flags.level === "2" ? 2 : 1,
        },
        out
      );
      return 0;
    }

    if (cmd === "build") {
      const res = await runBuildCommand(
        {
          dir: positional[0] ?? ".",
          outDir: typeof flags.out === "string" ? flags.out : undefined,
          base: typeof flags.base === "string" ? flags.base : undefined,
          shared: Boolean(flags.shared),
        },
        out
      );
      return res.bundle.valid ? 0 : 1;
    }

    if (cmd === "validate") {
      const res = await runValidateCommand(
        {
          dir: positional[0] ?? ".",
          base: typeof flags.base === "string" ? flags.base : undefined,
          shared: Boolean(flags.shared),
          json: Boolean(flags.json),
          salamandaUrl: typeof flags.salamanda === "string" ? flags.salamanda : undefined,
        },
        out
      );
      return res.valid ? 0 : 1;
    }

    if (cmd === "inspect-url") {
      const targetUrl = positional[0];
      if (!targetUrl) {
        out.stderr("Usage: newt inspect-url <url> [--out amphibian.json]");
        return 1;
      }
      await runInspectUrlCommand(
        {
          url: targetUrl,
          outPath: typeof flags.out === "string" ? flags.out : undefined,
        },
        out
      );
      return 0;
    }

    if (cmd === "dev") {
      await runDevCommand(
        {
          dir: positional[0] ?? ".",
          port: typeof flags.port === "string" ? Number(flags.port) : 4173,
          base: typeof flags.base === "string" ? flags.base : undefined,
        },
        out
      );
      // Keep process alive until SIGINT/SIGTERM when invoked as CLI
      await new Promise<void>((resolve) => {
        process.once("SIGINT", () => resolve());
        process.once("SIGTERM", () => resolve());
      });
      return 0;
    }

    if (cmd === "studio") {
      return await runStudioCommand(
        { port: typeof flags.port === "string" ? Number(flags.port) : 3100 },
        out
      );
    }

    if (cmd === "doctor") {
      const res = await runDoctorCommand(
        {
          salamandaUrl: typeof flags.salamanda === "string" ? flags.salamanda : undefined,
        },
        out
      );
      return res.ok ? 0 : 1;
    }

    out.stderr(`Unknown command '${cmd}'. Run 'newt --help' for usage.`);
    return 1;
  } catch (err) {
    out.stderr(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
