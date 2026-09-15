import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeDomain(input?: string | null): string | undefined {
  if (!input) return undefined;
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0] ?? s;
  s = s.split(":")[0] ?? s;
  s = s.replace(/\.$/, "");
  if (!s || !s.includes(".")) return undefined;
  return s;
}

export function domainFromUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return normalizeDomain(u.hostname);
  } catch {
    return normalizeDomain(url);
  }
}

export function normalizeEmail(input?: string | null): string | undefined {
  if (!input) return undefined;
  const s = input.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return undefined;
  return s;
}

export function normalizeProfileUrl(input?: string | null): string | undefined {
  if (!input) return undefined;
  try {
    const u = new URL(input);
    u.hash = "";
    u.search = "";
    let path = u.pathname.replace(/\/+$/, "");
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return `https://${host}${path}`.toLowerCase();
  } catch {
    return undefined;
  }
}

export function normalizePersonName(input: string): string {
  return normalizeWhitespace(input).toLowerCase().replace(/[.,]/g, "");
}

export function contentHash(parts: Array<string | undefined | null>): string {
  return sha256(parts.map((p) => (p ?? "").trim().toLowerCase()).join("\n"));
}

export function tentativeMatchKey(name: string, employerOrDomain: string): string {
  return sha256(
    `${normalizePersonName(name)}|${normalizeDomain(employerOrDomain) ?? employerOrDomain.toLowerCase()}`,
  );
}

export interface IdentityMatch {
  kind: "email" | "profile" | "tentative";
  key: string;
  ambiguous: boolean;
}

export function identityKeys(input: {
  email?: string;
  profileUrl?: string;
  name: string;
  companyDomain?: string;
}): IdentityMatch[] {
  const keys: IdentityMatch[] = [];
  const email = normalizeEmail(input.email);
  if (email) keys.push({ kind: "email", key: email, ambiguous: false });
  const profile = normalizeProfileUrl(input.profileUrl);
  if (profile) keys.push({ kind: "profile", key: profile, ambiguous: false });
  if (input.companyDomain) {
    keys.push({
      kind: "tentative",
      key: tentativeMatchKey(input.name, input.companyDomain),
      ambiguous: true,
    });
  }
  return keys;
}
