import { getConfig, type AppConfig } from "../config.ts";
import type { Store } from "../db/types.ts";
import { getStore } from "../db/pool.ts";

export class PauseUnreadableError extends Error {
  constructor() {
    super("pause state unreadable; failing closed");
    this.name = "PauseUnreadableError";
  }
}

export async function requireDiscoveryAllowed(store: Store = getStore()): Promise<void> {
  let pause;
  try {
    pause = await store.pause.get();
  } catch {
    throw new PauseUnreadableError();
  }
  if (!pause) throw new PauseUnreadableError();
  if (pause.discovery_paused) throw new Error("discovery_paused");
}

export async function requireOutboundAllowed(
  store: Store = getStore(),
  cfg: AppConfig = getConfig(),
): Promise<void> {
  let pause;
  try {
    pause = await store.pause.get();
  } catch {
    throw new PauseUnreadableError();
  }
  if (!pause) throw new PauseUnreadableError();
  if (pause.outbound_paused) throw new Error("outbound_paused");
  if (!cfg.LIVE_SEND_ENABLED) throw new Error("LIVE_SEND_ENABLED=false");
  if (cfg.DRY_RUN) throw new Error("DRY_RUN=true");
}

export async function setPaused(
  which: "discovery" | "outbound",
  paused: boolean,
  actor: string,
  store: Store = getStore(),
) {
  const current = await store.pause.get();
  const next = await store.pause.set(
    which === "discovery" ? { discovery_paused: paused } : { outbound_paused: paused },
    actor,
  );
  await store.audit.add({
    actor,
    at: new Date().toISOString(),
    setting: which === "discovery" ? "discovery_paused" : "outbound_paused",
    old_value: current,
    new_value: next,
    notion_sync: "n/a",
  });
  return next;
}
