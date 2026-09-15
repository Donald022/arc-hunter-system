import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getConfig } from "../config.ts";
import { logger } from "../logger.ts";

const { Client } = pg;

export function migrationsDir(): string {
  const fromCwd = resolve(process.cwd(), "migrations");
  if (existsSync(fromCwd)) return fromCwd;
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");
}

export function listMigrationFiles(dir = migrationsDir()): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export async function migrate(opts?: { databaseUrl?: string; schema?: string }): Promise<string[]> {
  const cfg = getConfig();
  const url = opts?.databaseUrl ?? cfg.DATABASE_URL;
  const schema = opts?.schema ?? cfg.DB_SCHEMA;
  if (!url) throw new Error("DATABASE_URL is required to run migrations");
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error(`unsafe schema name: ${schema}`);

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const dir = migrationsDir();
    for (const file of listMigrationFiles(dir)) {
      const sql = readFileSync(join(dir, file), "utf8");
      const sum = checksum(sql);
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE filename = $1",
        [file],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== sum) {
          throw new Error(`migration checksum mismatch for ${file}`);
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [file, sum]);
        await client.query("COMMIT");
        applied.push(file);
        logger.info("applied migration", { filename: file, schema });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  migrate()
    .then((files) => {
      console.log(files.length ? `applied: ${files.join(", ")}` : "no pending migrations");
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
