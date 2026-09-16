/**
 * Fixture detection and test recipient allowlist enforcement.
 * Defense-in-depth protection against fixture/test data reaching production.
 */

import type { AppConfig } from "../config.ts";
import { validateEmail } from "./email-validation.ts";

/**
 * Check if a source URL is a fixture source.
 */
export function isFixtureSource(sourceUrl: string | undefined | null): boolean {
  if (!sourceUrl) return false;
  const normalized = sourceUrl.trim().toLowerCase();
  return normalized.startsWith("fixture://");
}

/**
 * Check if a file:// source URL points to a bundled test fixture.
 * Legitimate operator CSV imports should not be in the /fixtures/ directory.
 */
export function isFixtureFile(sourceUrl: string | undefined | null): boolean {
  if (!sourceUrl) return false;
  const normalized = sourceUrl.trim().toLowerCase();
  if (!normalized.startsWith("file://")) return false;

  // Check if it's in the fixtures directory
  return normalized.includes("/fixtures/") || normalized.includes("\\fixtures\\");
}

/**
 * Check if any source is a fixture or test source.
 */
export function hasFixtureSources(sources: Array<string | undefined | null>): boolean {
  return sources.some((s) => isFixtureSource(s) || isFixtureFile(s));
}

/**
 * Parse and normalize the TEST_RECIPIENT_ALLOWLIST.
 */
export function parseAllowlist(config: AppConfig): string[] {
  if (!config.TEST_RECIPIENT_ALLOWLIST) {
    return [];
  }

  return config.TEST_RECIPIENT_ALLOWLIST.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Check if an email is on the test recipient allowlist.
 */
export function isAllowlisted(email: string | undefined | null, config: AppConfig): boolean {
  if (!email) return false;

  const allowlist = parseAllowlist(config);
  if (allowlist.length === 0) {
    return false; // Empty allowlist means no sends permitted
  }

  const normalized = email.trim().toLowerCase();
  return allowlist.includes(normalized);
}

/**
 * Determine the current outbound mode for the dashboard.
 */
export function getOutboundMode(config: AppConfig): "disabled" | "allowlist" | "production" {
  if (!config.LIVE_SEND_ENABLED) {
    return "disabled";
  }

  if (config.NODE_ENV === "staging" || config.NODE_ENV === "development") {
    return "allowlist";
  }

  return "production";
}

/**
 * Check if an email can be sent in the current environment.
 * Enforces test allowlist in staging/development, and validates email format.
 */
export interface SendValidationResult {
  allowed: boolean;
  reason?: string;
}

export function validateSendRecipient(
  email: string | undefined | null,
  config: AppConfig,
  isFixture: boolean = false,
): SendValidationResult {
  // Never allow fixture-derived contacts in production
  if (config.NODE_ENV === "production" && isFixture) {
    return { allowed: false, reason: "fixture_contact_blocked_in_production" };
  }

  // Validate email format and reserved domains
  const emailValidation = validateEmail(email);
  if (!emailValidation.valid) {
    return { allowed: false, reason: emailValidation.reason };
  }

  // Check allowlist in staging/development when configured
  // The allowlist is enforced regardless of LIVE_SEND_ENABLED to test the behavior
  if (
    (config.NODE_ENV === "staging" || config.NODE_ENV === "development") &&
    config.TEST_RECIPIENT_ALLOWLIST
  ) {
    if (!isAllowlisted(email, config)) {
      return { allowed: false, reason: "not_on_test_allowlist" };
    }
  }

  return { allowed: true };
}
