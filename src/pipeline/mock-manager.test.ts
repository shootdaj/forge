/**
 * Mock Manager Unit Tests
 *
 * Tests for mock registration, service detection, prompt building,
 * and mock entry validation.
 *
 * Requirements: MOCK-01, MOCK-02, MOCK-03, MOCK-04, PIPE-02
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockManager } from "./mock-manager.js";
import type { MockEntry, ServiceDetection } from "./types.js";
import type { ForgeState } from "../state/schema.js";
import { createInitialState } from "../state/state-manager.js";

// ---------------------------------------------------------------------------
// In-memory StateManager mock (same pattern as phase-runner tests)
// ---------------------------------------------------------------------------

class MockStateManager {
  private _state: ForgeState;

  constructor(state?: Partial<ForgeState>) {
    this._state = { ...createInitialState("/tmp/test-project"), ...state };
  }

  load(): ForgeState {
    return { ...this._state };
  }

  save(state: ForgeState): void {
    this._state = { ...state };
  }

  async update(
    updater: (current: ForgeState) => ForgeState,
  ): Promise<ForgeState> {
    const current = this.load();
    const updated = updater(current);
    this.save(updated);
    return updated;
  }

  exists(): boolean {
    return true;
  }

  get statePath(): string {
    return "/tmp/test-project/forge-state.json";
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createStripeMockEntry(): MockEntry {
  return {
    interface: "src/services/stripe.ts",
    mock: "src/services/stripe.mock.ts",
    real: "src/services/stripe.real.ts",
    factory: "src/services/stripe.factory.ts",
    testFixtures: ["test/fixtures/stripe-webhook.json"],
    envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  };
}

function createSendgridMockEntry(): MockEntry {
  return {
    interface: "src/services/sendgrid.ts",
    mock: "src/services/sendgrid.mock.ts",
    real: "src/services/sendgrid.real.ts",
    factory: "src/services/sendgrid.factory.ts",
    testFixtures: [],
    envVars: ["SENDGRID_API_KEY"],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MockManager - Registry Operations", () => {
  let stateManager: MockStateManager;
  let mockManager: MockManager;

  beforeEach(() => {
    stateManager = new MockStateManager();
    // Cast is safe because MockStateManager implements the same interface
    mockManager = new MockManager(stateManager as any);
  });

  it("TestMockManager_RegisterAndRetrieve", async () => {
    const entry = createStripeMockEntry();

    await mockManager.registerMock("stripe", entry);

    const retrieved = await mockManager.getMock("stripe");
    expect(retrieved).toBeDefined();
    expect(retrieved!.interface).toBe("src/services/stripe.ts");
    expect(retrieved!.mock).toBe("src/services/stripe.mock.ts");
    expect(retrieved!.real).toBe("src/services/stripe.real.ts");
    expect(retrieved!.factory).toBe("src/services/stripe.factory.ts");
    expect(retrieved!.envVars).toEqual([
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
  });

  it("TestMockManager_RegisterMultiple", async () => {
    await mockManager.registerMock("stripe", createStripeMockEntry());
    await mockManager.registerMock("sendgrid", createSendgridMockEntry());

    const registry = await mockManager.getMockRegistry();
    expect(Object.keys(registry)).toHaveLength(2);
    expect(registry["stripe"]).toBeDefined();
    expect(registry["sendgrid"]).toBeDefined();
  });

  it("TestMockManager_GetMock_NotFound", async () => {
    const result = await mockManager.getMock("nonexistent");
    expect(result).toBeUndefined();
  });
});

describe("MockManager - Service Detection", () => {
  let mockManager: MockManager;

  beforeEach(() => {
    const stateManager = new MockStateManager();
    mockManager = new MockManager(stateManager as any);
  });

  it("TestMockManager_DetectExternalServices_Stripe", () => {
    const services = mockManager.detectExternalServices(
      "Build payment processing with Stripe integration",
      3,
    );

    expect(services).toHaveLength(1);
    expect(services[0].service).toBe("stripe");
    expect(services[0].phase).toBe(3);
    expect(services[0].credentialsNeeded).toContain("STRIPE_SECRET_KEY");
    expect(services[0].credentialsNeeded).toContain("STRIPE_WEBHOOK_SECRET");
    expect(services[0].signupUrl).toContain("stripe.com");
  });

  it("TestMockManager_DetectExternalServices_Multiple", () => {
    const services = mockManager.detectExternalServices(
      "Integrate payment processing with Stripe and email delivery via SendGrid. Also need Redis for caching.",
      5,
    );

    expect(services.length).toBeGreaterThanOrEqual(3);

    const serviceNames = services.map((s) => s.service);
    expect(serviceNames).toContain("stripe");
    expect(serviceNames).toContain("sendgrid");
    expect(serviceNames).toContain("redis");

    // All should reference the correct phase
    for (const s of services) {
      expect(s.phase).toBe(5);
    }
  });

  it("TestMockManager_DetectExternalServices_NoneFound", () => {
    const services = mockManager.detectExternalServices(
      "Build a pure computation module with no external dependencies. Just math functions.",
      2,
    );

    expect(services).toEqual([]);
  });

  it("TestMockManager_DetectExternalServices_CaseInsensitive", () => {
    const services = mockManager.detectExternalServices(
      "Integrate with STRIPE for PAYMENT processing",
      1,
    );

    expect(services).toHaveLength(1);
    expect(services[0].service).toBe("stripe");
  });

  it("TestMockManager_DetectExternalServices_NoDuplicates", () => {
    const services = mockManager.detectExternalServices(
      "Payment with Stripe, billing with Stripe, subscription with Stripe",
      1,
    );

    // Should only have one Stripe entry despite multiple keyword matches
    const stripeEntries = services.filter((s) => s.service === "stripe");
    expect(stripeEntries).toHaveLength(1);
  });
});

describe("MockManager - Prompt Builders", () => {
  let mockManager: MockManager;

  beforeEach(() => {
    const stateManager = new MockStateManager();
    mockManager = new MockManager(stateManager as any);
  });

  it("TestMockManager_BuildMockInstructions", () => {
    const services: ServiceDetection[] = [
      {
        service: "stripe",
        why: "Payment processing",
        phase: 3,
        signupUrl: "https://dashboard.stripe.com/register",
        credentialsNeeded: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
      },
    ];

    const instructions = mockManager.buildMockInstructions(services);

    expect(instructions).toContain("External Service Mocking Instructions");
    expect(instructions).toContain("stripe");
    expect(instructions).toContain("Payment processing");
    expect(instructions).toContain("src/services/{name}.ts");
    expect(instructions).toContain("src/services/{name}.mock.ts");
    expect(instructions).toContain("src/services/{name}.real.ts");
    expect(instructions).toContain("src/services/{name}.factory.ts");
    expect(instructions).toContain("FORGE:MOCK");
  });

  it("TestMockManager_BuildMockInstructions_SameInterface", () => {
    const services: ServiceDetection[] = [
      {
        service: "stripe",
        why: "Payment processing",
        phase: 3,
        credentialsNeeded: ["STRIPE_SECRET_KEY"],
      },
    ];

    const instructions = mockManager.buildMockInstructions(services);

    // Must mention MOCK-04: same TypeScript interface
    expect(instructions).toContain("MOCK-04");
    expect(instructions).toContain("SAME TypeScript interface");
  });

  it("TestMockManager_BuildMockInstructions_Empty", () => {
    const instructions = mockManager.buildMockInstructions([]);
    expect(instructions).toBe("");
  });

  it("TestMockManager_BuildSwapPrompt", () => {
    const registry: Record<string, MockEntry> = {
      stripe: createStripeMockEntry(),
      sendgrid: createSendgridMockEntry(),
    };

    const credentials: Record<string, string> = {
      STRIPE_SECRET_KEY: "sk_test_xxx",
      STRIPE_WEBHOOK_SECRET: "whsec_xxx",
      SENDGRID_API_KEY: "SG.xxx",
    };

    const prompt = mockManager.buildSwapPrompt(registry, credentials);

    expect(prompt).toContain("Wave 2: Mock-to-Real Swap");
    expect(prompt).toContain("### stripe");
    expect(prompt).toContain("### sendgrid");
    expect(prompt).toContain("src/services/stripe.ts");
    expect(prompt).toContain("src/services/stripe.mock.ts");
    expect(prompt).toContain("src/services/stripe.real.ts");
    expect(prompt).toContain("STRIPE_SECRET_KEY");
    expect(prompt).toContain("SENDGRID_API_KEY");
    expect(prompt).toContain("FORGE:MOCK");
    expect(prompt).toContain("MOCK-04");
  });

  it("TestMockManager_BuildSwapPrompt_Empty", () => {
    const prompt = mockManager.buildSwapPrompt({}, {});
    expect(prompt).toContain("No mocks to swap");
  });
});

describe("MockManager - Validation", () => {
  let mockManager: MockManager;

  beforeEach(() => {
    const stateManager = new MockStateManager();
    mockManager = new MockManager(stateManager as any);
  });

  it("TestMockManager_ValidateMockEntry_Valid", () => {
    const entry = createStripeMockEntry();
    const result = mockManager.validateMockEntry(entry);

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("TestMockManager_ValidateMockEntry_MissingFiles", () => {
    const entry: MockEntry = {
      interface: "src/services/stripe.ts",
      mock: "",
      real: "src/services/stripe.real.ts",
      factory: "",
      testFixtures: [],
      envVars: [],
    };

    const result = mockManager.validateMockEntry(entry);

    expect(result.valid).toBe(false);
    expect(result.missing).toContain("mock");
    expect(result.missing).toContain("factory");
    expect(result.missing).not.toContain("interface");
    expect(result.missing).not.toContain("real");
  });

  it("TestMockManager_ValidateMockEntry_WithFs", () => {
    const entry = createStripeMockEntry();

    // Mock filesystem that only has interface and mock files
    const mockFs = {
      existsSync: (p: string) =>
        p === "src/services/stripe.ts" ||
        p === "src/services/stripe.mock.ts",
    };

    const result = mockManager.validateMockEntry(entry, mockFs);

    expect(result.valid).toBe(false);
    expect(result.missing).toContain("real");
    expect(result.missing).toContain("factory");
  });

  it("TestMockManager_ValidateMockEntry_AllFilesExist", () => {
    const entry = createStripeMockEntry();

    const mockFs = {
      existsSync: () => true,
    };

    const result = mockManager.validateMockEntry(entry, mockFs);

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
