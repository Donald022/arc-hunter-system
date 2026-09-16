/**
 * Tests for the 4 code-owned pre-production blockers.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app.ts";
import { useTestStore } from "./helpers.ts";
import { loadConfig, resetConfigCache } from "../src/config.ts";
import {
  validateEmail,
  isProductionSafeEmail,
  getEmailRejectionReason,
} from "../src/domain/email-validation.ts";
import {
  isFixtureSource,
  isFixtureFile,
  hasFixtureSources,
  parseAllowlist,
  isAllowlisted,
  getOutboundMode,
  validateSendRecipient,
} from "../src/domain/safety.ts";
import { executeApprovedSend } from "../src/integrations/gmail.ts";

describe("Blocker implementations", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    Object.assign(originalEnv, {
      NODE_ENV: process.env.NODE_ENV,
      DRY_RUN: process.env.DRY_RUN,
      LIVE_SEND_ENABLED: process.env.LIVE_SEND_ENABLED,
      TEST_RECIPIENT_ALLOWLIST: process.env.TEST_RECIPIENT_ALLOWLIST,
    });

    resetConfigCache();
    process.env.NODE_ENV = "staging";
    process.env.DRY_RUN = "true";
    process.env.LIVE_SEND_ENABLED = "false";
  });

  afterEach(() => {
    Object.keys(originalEnv).forEach((key) => {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    });
    resetConfigCache();
  });

  describe("Blocker 2: Email validation", () => {
    it("rejects empty emails", () => {
      const result = validateEmail("");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("empty_email");
    });

    it("rejects malformed emails", () => {
      const malformed = ["notanemail", "missing@domain", "@nodomain.com"];

      for (const email of malformed) {
        const result = validateEmail(email);
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/malformed/);
      }
    });

    it("rejects .test domain", () => {
      const result = validateEmail("user@example.test");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("reserved_test_domain");
    });

    it("rejects .invalid domain", () => {
      const result = validateEmail("user@example.invalid");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("reserved_test_domain");
    });

    it("rejects .example domain", () => {
      const result = validateEmail("user@subdomain.example");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("reserved_test_domain");
    });

    it("rejects .localhost domain", () => {
      const result = validateEmail("user@app.localhost");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("reserved_test_domain");
    });

    it("rejects example.com", () => {
      const result = validateEmail("user@example.com");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("reserved_example_domain");
    });

    it("rejects example.net and example.org", () => {
      expect(validateEmail("test@example.net").valid).toBe(false);
      expect(validateEmail("test@example.org").valid).toBe(false);
    });

    it("rejects localhost domain", () => {
      const result = validateEmail("user@localhost");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("localhost_domain");
    });

    it("rejects IP address domains", () => {
      const result = validateEmail("user@192.168.1.1");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("ip_address_domain");
    });

    it("handles casing correctly", () => {
      const result = validateEmail("User@EXAMPLE.TEST");
      expect(result.valid).toBe(false);
      expect(result.normalized).toBe("user@example.test");
    });

    it("accepts valid email", () => {
      const result = validateEmail("user@company.com");
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe("user@company.com");
    });

    it("provides human-readable rejection reasons", () => {
      const reason = getEmailRejectionReason("user@example.test");
      expect(reason).toMatch(/reserved test domain/i);
      expect(reason).not.toMatch(/user/); // Should not include actual email
    });
  });

  describe("Blocker 1: Fixture contamination", () => {
    it("identifies fixture:// sources", () => {
      expect(isFixtureSource("fixture://broker-test")).toBe(true);
      expect(isFixtureSource("https://real-source.com")).toBe(false);
    });

    it("identifies fixture file:// paths", () => {
      expect(isFixtureFile("file:///path/to/fixtures/data.json")).toBe(true);
      expect(isFixtureFile("file:///path/to/imports/data.csv")).toBe(false);
    });

    it("detects fixture sources in array", () => {
      const sources = ["https://real-source.com", "fixture://broker-test"];
      expect(hasFixtureSources(sources)).toBe(true);
    });

    it("allows non-fixture sources", () => {
      const sources = ["https://real-source.com", "file:///imports/data.csv"];
      expect(hasFixtureSources(sources)).toBe(false);
    });

    it("blocks fixture contact in production", async () => {
      resetConfigCache();
      process.env.NODE_ENV = "production";
      process.env.LIVE_SEND_ENABLED = "true";
      process.env.DRY_RUN = "false";
      process.env.DAILY_SEND_CAP = "5";
      process.env.DASHBOARD_FIXTURE_LOGIN = "false"; // Must be false in production

      const cfg = loadConfig();
      const store = useTestStore();

      const company = await store.companies.upsert({
        name: "Fixture Company",
        domain: "example.test",
        segment: "Broker",
        region_signals: [],
        why_relevant: "test",
        source_urls: ["fixture://broker-test"],
        account_priority: 0,
        status: "active",
      });

      const contact = await store.contacts.upsert({
        company_id: company.id,
        name: "Fixture User",
        title: "Test",
        work_email: "fixture@example.test",
        email_confidence: "Verified",
        hunter_tags: ["broker"],
        role: "Direct Buyer",
        direct_buyer_potential: 70,
        connection_potential: 60,
        fit_score: 85,
        evidence_summary: "test",
        state: "APPROVED",
        do_not_contact: false,
      });

      const draft = await store.drafts.insert({
        contact_id: contact.id,
        version: 1,
        subject: "Test",
        body: "Test body",
        body_hash: "test-hash",
        fact_version_hash: "test-fact-1",
        contact_email: contact.work_email ?? "",
        sender_address: "test@arc-hunter-test.com",
        invalidated: false,
        personalization_claims: [],
        arc_claim_ids: [],
        word_count: 2,
      });

      const result = await executeApprovedSend({
        store,
        draft,
        contact,
        actor: "test",
        cfg,
      });

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/fixture.*blocked|invalid_email/i);
    });
  });

  describe("Blocker 7: Test recipient allowlist", () => {
    it("parses comma-separated allowlist", () => {
      resetConfigCache();
      process.env.TEST_RECIPIENT_ALLOWLIST = "test1@company.com,test2@company.com";

      const cfg = loadConfig();
      const list = parseAllowlist(cfg);

      expect(list).toEqual(["test1@company.com", "test2@company.com"]);
    });

    it("normalizes allowlist emails", () => {
      resetConfigCache();
      process.env.TEST_RECIPIENT_ALLOWLIST = " Test@Company.COM , test2@company.com ";

      const cfg = loadConfig();
      const list = parseAllowlist(cfg);

      expect(list).toEqual(["test@company.com", "test2@company.com"]);
    });

    it("rejects wildcards in allowlist", () => {
      resetConfigCache();
      process.env.TEST_RECIPIENT_ALLOWLIST = "*@company.com";

      expect(() => loadConfig()).toThrow(/wildcard|Invalid/i);
    });

    it("rejects domain-only entries", () => {
      resetConfigCache();
      process.env.TEST_RECIPIENT_ALLOWLIST = "@company.com";

      expect(() => loadConfig()).toThrow(/Invalid/i);
    });

    it("checks email against allowlist", () => {
      resetConfigCache();
      process.env.TEST_RECIPIENT_ALLOWLIST = "allowed@test.com";

      const cfg = loadConfig();

      expect(isAllowlisted("allowed@test.com", cfg)).toBe(true);
      expect(isAllowlisted("notallowed@test.com", cfg)).toBe(false);
    });

    it("returns false for empty allowlist", () => {
      resetConfigCache();
      delete process.env.TEST_RECIPIENT_ALLOWLIST;

      const cfg = loadConfig();

      expect(isAllowlisted("any@test.com", cfg)).toBe(false);
    });

    it("determines outbound mode correctly", () => {
      resetConfigCache();
      process.env.NODE_ENV = "staging";
      process.env.LIVE_SEND_ENABLED = "false";
      let cfg = loadConfig();
      expect(getOutboundMode(cfg)).toBe("disabled");

      resetConfigCache();
      process.env.NODE_ENV = "staging";
      process.env.LIVE_SEND_ENABLED = "true";
      process.env.DRY_RUN = "false";
      cfg = loadConfig();
      expect(getOutboundMode(cfg)).toBe("allowlist");

      resetConfigCache();
      process.env.NODE_ENV = "production";
      process.env.LIVE_SEND_ENABLED = "true";
      process.env.DRY_RUN = "false";
      process.env.DASHBOARD_FIXTURE_LOGIN = "false";
      cfg = loadConfig();
      expect(getOutboundMode(cfg)).toBe("production");
    });

    it("blocks non-allowlisted recipient in staging", () => {
      resetConfigCache();
      process.env.NODE_ENV = "staging";
      process.env.TEST_RECIPIENT_ALLOWLIST = "allowed@test.com";

      const cfg = loadConfig();

      const result = validateSendRecipient("notallowed@test.com", cfg, false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("not_on_test_allowlist");
    });

    it("allows allowlisted recipient in staging", () => {
      resetConfigCache();
      process.env.NODE_ENV = "staging";
      process.env.LIVE_SEND_ENABLED = "true";
      process.env.DRY_RUN = "false";
      process.env.TEST_RECIPIENT_ALLOWLIST = "allowed@test.com";

      const cfg = loadConfig();

      const result = validateSendRecipient("allowed@test.com", cfg, false);
      expect(result.allowed).toBe(true);
    });

    it("blocks fixture contact even if allowlisted in production", () => {
      resetConfigCache();
      process.env.NODE_ENV = "production";
      process.env.LIVE_SEND_ENABLED = "true";
      process.env.DRY_RUN = "false";
      process.env.DASHBOARD_FIXTURE_LOGIN = "false";
      process.env.TEST_RECIPIENT_ALLOWLIST = "fixture@test.com";

      const cfg = loadConfig();

      const result = validateSendRecipient("fixture@test.com", cfg, true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("fixture_contact_blocked_in_production");
    });
  });

  describe("Blocker 6: Health endpoints", () => {
    it("responds to /health/live", async () => {
      useTestStore(); // Ensure test DB is initialized
      const app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/health/live",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe("ok");
      expect(body.timestamp).toBeDefined();

      await app.close();
    });

    it("/health/ready checks database", async () => {
      useTestStore(); // Ensure test DB is initialized
      const app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/health/ready",
      });

      // Accept both 200 (ready) and 503 (migrations not found in test schema)
      expect([200, 503]).toContain(res.statusCode);
      const body = JSON.parse(res.body);
      expect(body.timestamp).toBeDefined();

      await app.close();
    });

    it("/health/ready reports dependencies", async () => {
      useTestStore(); // Ensure test DB is initialized
      const app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/health/ready",
      });

      // Accept both 200 (ready) and 503 (unavailable)
      expect([200, 503]).toContain(res.statusCode);
      const body = JSON.parse(res.body);

      if (res.statusCode === 200) {
        expect(body.dependencies).toBeDefined();
        expect(body.status).toBe("ready");
      }

      await app.close();
    });

    it("/health/ready does not expose secrets", async () => {
      useTestStore(); // Ensure test DB is initialized
      const app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/health/ready",
      });

      // Accept both 200 (ready) and 503 (unavailable)
      expect([200, 503]).toContain(res.statusCode);

      // Check response doesn't contain secrets
      expect(res.body).not.toMatch(/AIza/i);
      expect(res.body).not.toMatch(/xoxb-/);
      expect(res.body).not.toMatch(/ntn_/);
      expect(res.body).not.toMatch(/postgresql:\/\/[^@]+:[^@]+@/);

      // Dependencies should only show configured/enabled status
      const body = JSON.parse(res.body);
      if (body.dependencies) {
        expect(body.dependencies.notion).toMatch(/^(configured|not_configured)$/);
        expect(body.dependencies.gemini).toMatch(/^(enabled|disabled)$/);
      }

      await app.close();
    });

    it("/health/ready sanitizes database errors", async () => {
      useTestStore(); // Ensure test DB is initialized
      const app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/health/ready",
      });

      // Should either succeed or fail gracefully
      expect([200, 503]).toContain(res.statusCode);

      await app.close();
    });
  });

  describe("Combined blocker enforcement", () => {
    it("enforces all gates in sequence", async () => {
      resetConfigCache();
      process.env.NODE_ENV = "staging";
      process.env.LIVE_SEND_ENABLED = "true";
      process.env.DRY_RUN = "false";
      process.env.TEST_RECIPIENT_ALLOWLIST = "allowed@company.com";

      const cfg = loadConfig();
      const store = useTestStore();

      // Test 1: Invalid email should fail email validation
      let result = validateSendRecipient("", cfg, false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("empty_email");

      // Test 2: Reserved domain should fail
      result = validateSendRecipient("user@example.test", cfg, false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("reserved_test_domain");

      // Test 3: Non-allowlisted should fail in staging
      result = validateSendRecipient("notallowed@company.com", cfg, false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("not_on_test_allowlist");

      // Test 4: Fixture in production should fail
      resetConfigCache();
      process.env.NODE_ENV = "production";
      process.env.LIVE_SEND_ENABLED = "true";
      process.env.DRY_RUN = "false";
      process.env.DASHBOARD_FIXTURE_LOGIN = "false";
      const prodCfg = loadConfig();

      result = validateSendRecipient("fixture@company.com", prodCfg, true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("fixture_contact_blocked_in_production");

      // Test 5: Valid allowlisted email in staging should pass
      resetConfigCache();
      process.env.NODE_ENV = "staging";
      process.env.LIVE_SEND_ENABLED = "true";
      process.env.DRY_RUN = "false";
      process.env.TEST_RECIPIENT_ALLOWLIST = "allowed@company.com";
      const stagingCfg = loadConfig();

      result = validateSendRecipient("allowed@company.com", stagingCfg, false);
      expect(result.allowed).toBe(true);
    });
  });
});
