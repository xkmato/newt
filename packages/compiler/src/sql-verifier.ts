import initSqlJs, { type SqlJsStatic } from "sql.js";
import type { Diagnostic, SidecarScope } from "@newt/contract";
import type { NewtVfs } from "./types.js";

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs();
  }
  return sqlJsPromise;
}

export function containsForbiddenSqliteDirective(sql: string): string | null {
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    const cleaned = stmt.replace(/^(--[^\n]*\n\s*)+/g, "").trim().toUpperCase();
    if (cleaned.startsWith("ATTACH")) return "ATTACH DATABASE";
    if (cleaned.startsWith("PRAGMA")) return "PRAGMA";
  }
  return null;
}

/**
 * Stage 2: Executes all `migrations/*.sql` (and optional `fixtures/seed.sql`) inside
 * an ephemeral WebAssembly SQLite (`sql.js`) database to catch syntax errors and
 * forbidden `ATTACH`/`PRAGMA` statements before deployment to Salamanda.
 */
export async function verifySidecarMigrations(
  vfs: NewtVfs,
  sidecarScope: SidecarScope,
  migrationsDir = "migrations/"
): Promise<{ diagnostics: Diagnostic[]; migrationAssets: Record<string, string> }> {
  const diagnostics: Diagnostic[] = [];
  const migrationAssets: Record<string, string> = {};

  const prefix = migrationsDir.endsWith("/") ? migrationsDir : `${migrationsDir}/`;
  const migrationKeys = Object.keys(vfs)
    .filter((k) => k.startsWith(prefix) && k.endsWith(".sql"))
    .sort();

  if (sidecarScope === "none") {
    return { diagnostics, migrationAssets };
  }

  const SQL = await getSqlJs();
  const db = new SQL.Database();

  try {
    for (const fileKey of migrationKeys) {
      const sqlContent = vfs[fileKey] ?? "";
      const forbidden = containsForbiddenSqliteDirective(sqlContent);
      if (forbidden) {
        diagnostics.push({
          code: "NEWT-SQL-002",
          severity: "error",
          path: fileKey,
          message: `Forbidden SQLite directive '${forbidden}' in migration '${fileKey}'.`,
          hint: "Salamanda sidecar databases disallow ATTACH DATABASE and PRAGMA statements.",
          suggested_fix: `Remove '${forbidden}' statements from '${fileKey}'.`,
        });
        continue;
      }

      try {
        db.run(sqlContent);
        const normalizedAssetKey = `migrations/${fileKey.slice(prefix.length)}`;
        migrationAssets[normalizedAssetKey] = sqlContent;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        diagnostics.push({
          code: "NEWT-SQL-001",
          severity: "error",
          path: fileKey,
          message: `SQLite migration failed in '${fileKey}': ${msg}`,
          hint: "Ensure valid SQLite DDL syntax (CREATE TABLE IF NOT EXISTS ...).",
        });
      }
    }

    const seedSql = vfs["fixtures/seed.sql"];
    if (seedSql && diagnostics.length === 0) {
      const forbiddenSeed = containsForbiddenSqliteDirective(seedSql);
      if (forbiddenSeed) {
        diagnostics.push({
          code: "NEWT-SQL-002",
          severity: "error",
          path: "fixtures/seed.sql",
          message: `Forbidden SQLite directive '${forbiddenSeed}' in 'fixtures/seed.sql'.`,
        });
      } else {
        try {
          db.run(seedSql);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          diagnostics.push({
            code: "NEWT-SQL-001",
            severity: "error",
            path: "fixtures/seed.sql",
            message: `Seed SQL failed against migrations: ${msg}`,
            hint: "Ensure seed INSERT columns match your migration CREATE TABLE definitions.",
          });
        }
      }
    }
  } finally {
    db.close();
  }

  return { diagnostics, migrationAssets };
}
