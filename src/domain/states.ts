import { CONTACT_STATES, TERMINAL_NO_AUTO_SEND, type ContactState } from "./types.ts";

const ALLOWED: Record<ContactState, ContactState[]> = {
  DISCOVERED: ["RESEARCHING", "DISQUALIFIED", "DNC"],
  RESEARCHING: ["QUALIFIED", "QUALIFIED_NO_EMAIL", "RESEARCH_REVIEW", "DISQUALIFIED", "DNC"],
  RESEARCH_REVIEW: ["RESEARCHING", "QUALIFIED", "QUALIFIED_NO_EMAIL", "DISQUALIFIED", "DNC"],
  DISQUALIFIED: ["RESEARCHING"],
  QUALIFIED: ["QUALIFIED_NO_EMAIL", "DRAFT_READY", "FACT_REVIEW", "DNC", "DISQUALIFIED"],
  QUALIFIED_NO_EMAIL: ["QUALIFIED", "DNC", "DISQUALIFIED"],
  DRAFT_READY: ["PENDING_APPROVAL", "FACT_REVIEW", "DNC"],
  FACT_REVIEW: ["DRAFT_READY", "DISQUALIFIED", "DNC"],
  PENDING_APPROVAL: ["EDITING", "APPROVED", "SKIPPED", "DNC", "FACT_REVIEW"],
  EDITING: ["PENDING_APPROVAL", "DNC"],
  APPROVED: ["SENDING", "PENDING_APPROVAL", "DNC"],
  SENDING: ["SENT", "SEND_UNCERTAIN", "SEND_FAILED", "DNC"],
  SENT: ["REPLIED", "BOUNCED", "DNC", "MANUAL_HANDOFF"],
  REPLIED: ["MANUAL_HANDOFF"],
  SKIPPED: [],
  DNC: [],
  SEND_UNCERTAIN: ["SENT", "SEND_FAILED", "DNC"],
  SEND_FAILED: ["PENDING_APPROVAL", "DNC"],
  BOUNCED: ["DNC", "MANUAL_HANDOFF"],
  MANUAL_HANDOFF: [],
};

export interface Transition {
  from: ContactState;
  to: ContactState;
  actor: string;
  at: string;
  reason?: string;
}

export function canTransition(from: ContactState, to: ContactState): boolean {
  if (from === to) return true;
  return (ALLOWED[from] ?? []).includes(to);
}

export function assertTransition(from: ContactState, to: ContactState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal state transition ${from} -> ${to}`);
  }
}

export function forbidsAutoSend(state: ContactState, doNotContact = false): boolean {
  return (
    doNotContact || TERMINAL_NO_AUTO_SEND.has(state) || state === "SKIPPED" || state === "SENDING"
  );
}

export function isManualRescueAllowed(state: ContactState): boolean {
  return state === "DISQUALIFIED" || state === "RESEARCH_REVIEW" || state === "FACT_REVIEW";
}

export { CONTACT_STATES };
