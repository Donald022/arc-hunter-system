import { describe, expect, it } from "vitest";
import { checksum, listMigrationFiles, migrationsDir } from "../src/db/migrate.ts";
import { readFileSync } from "node:fs";
import { join as pathJoin } from "node:path";

describe("migrations", () => {
  it("ships a checksummed init migration that creates the private ledger tables", () => {
    const files = listMigrationFiles();
    expect(files[0]).toBe("001_init.sql");
    const sql = readFileSync(pathJoin(migrationsDir(), files[0]!), "utf8");
    expect(checksum(sql)).toMatch(/^[a-f0-9]{64}$/);
    for (const table of [
      "companies",
      "contacts",
      "signals",
      "evidence",
      "drafts",
      "outreach_events",
      "send_attempts",
      "suppression",
      "job_runs",
      "external_sync",
      "llm_usage",
      "pause_switches",
      "settings_audit",
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("send_attempts_first_touch_uidx");
  });
});
