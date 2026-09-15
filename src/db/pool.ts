import pg from "pg";
import { getConfig } from "../config.ts";
import { MemoryStore } from "./memory.ts";
import { PostgresStore } from "./postgres.ts";
import type { Store } from "./types.ts";

const { Pool } = pg;

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  const cfg = getConfig();
  if (!cfg.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  pool ??= new Pool({
    connectionString: cfg.DATABASE_URL,
    max: cfg.PG_POOL_MAX,
    ssl: { rejectUnauthorized: false },
    options: `-c search_path=${cfg.DB_SCHEMA},public`,
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

let active: Store | undefined;

export function setStore(store: Store): void {
  active = store;
}

export function getStore(): Store {
  if (active) return active;
  const cfg = getConfig();
  active = cfg.DATABASE_URL ? new PostgresStore(getPool()) : new MemoryStore();
  return active;
}

export function useMemoryStore(): MemoryStore {
  const mem = new MemoryStore();
  setStore(mem);
  return mem;
}

