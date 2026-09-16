/**
 * Centralized email validation and recipient safety checks.
 * Used at every stage: ingestion, enrichment, draft, reservation, and send.
 */

const RESERVED_TEST_TLDS = [".test", ".invalid", ".example", ".localhost"] as const;

const RESERVED_EXAMPLE_DOMAINS = ["example.com", "example.net", "example.org"] as const;

export interface EmailValidationResult {
  valid: boolean;
  reason?: string;
  normalized?: string;
}

/**
 * Validates and normalizes an email address.
 * Rejects test/reserved domains and malformed addresses.
 */
export function validateEmail(email: string | undefined | null): EmailValidationResult {
  if (!email) {
    return { valid: false, reason: "empty_email" };
  }

  // Trim and normalize
  const trimmed = email.trim();
  if (!trimmed) {
    return { valid: false, reason: "empty_email" };
  }

  // Basic format check
  const emailRegex = /^[^\s@]+@[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, reason: "malformed_email" };
  }

  // Normalize to lowercase
  const normalized = trimmed.toLowerCase();

  // Extract domain
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex === -1 || atIndex === 0) {
    return { valid: false, reason: "malformed_email" };
  }

  const localPart = normalized.substring(0, atIndex);
  const domain = normalized.substring(atIndex + 1);

  // Check local part and domain have content
  if (!localPart || localPart.length === 0 || !domain || domain.length === 0) {
    return { valid: false, reason: "malformed_email" };
  }

  // Check for localhost first (before TLD check)
  if (domain === "localhost" || domain.startsWith("localhost.")) {
    return { valid: false, reason: "localhost_domain", normalized };
  }

  // Check domain has at least one dot (TLD requirement) except for localhost
  if (!domain.includes(".")) {
    return { valid: false, reason: "malformed_email" };
  }

  // Check reserved TLDs
  for (const tld of RESERVED_TEST_TLDS) {
    if (domain.endsWith(tld)) {
      return { valid: false, reason: "reserved_test_domain", normalized };
    }
  }

  // Check reserved example domains
  for (const reservedDomain of RESERVED_EXAMPLE_DOMAINS) {
    if (domain === reservedDomain) {
      return { valid: false, reason: "reserved_example_domain", normalized };
    }
  }

  // Check for localhost
  if (domain === "localhost" || domain.startsWith("localhost.")) {
    return { valid: false, reason: "localhost_domain", normalized };
  }

  // Additional checks for malformed addresses
  if (domain.startsWith(".") || domain.endsWith(".")) {
    return { valid: false, reason: "malformed_domain", normalized };
  }

  if (domain.includes("..")) {
    return { valid: false, reason: "malformed_domain", normalized };
  }

  // Check for IP addresses (not allowed)
  const ipRegex = /^\d+\.\d+\.\d+\.\d+$/;
  if (ipRegex.test(domain)) {
    return { valid: false, reason: "ip_address_domain", normalized };
  }

  return { valid: true, normalized };
}

/**
 * Validates that an email is safe to use for production sends.
 * This is the final gate before any email operation.
 */
export function isProductionSafeEmail(email: string | undefined | null): boolean {
  const result = validateEmail(email);
  return result.valid;
}

/**
 * Get a human-readable rejection reason for logging/audit.
 * Never includes the actual email address in the reason.
 */
export function getEmailRejectionReason(email: string | undefined | null): string {
  const result = validateEmail(email);
  if (result.valid) {
    return "email_is_valid";
  }

  const reasons: Record<string, string> = {
    empty_email: "Email address is empty or missing",
    malformed_email: "Email address is malformed",
    reserved_test_domain: "Email uses reserved test domain (.test, .invalid, .example, .localhost)",
    reserved_example_domain: "Email uses reserved example domain (example.com/net/org)",
    localhost_domain: "Email uses localhost domain",
    malformed_domain: "Email domain is malformed",
    ip_address_domain: "Email uses IP address as domain",
  };

  return reasons[result.reason || "unknown"] || "Email validation failed";
}
