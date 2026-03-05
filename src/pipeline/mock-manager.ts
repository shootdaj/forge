/**
 * Mock Manager
 *
 * Manages the mock registry for tracking and swapping external service mocks.
 * Implements the 4-file pattern: interface / mock / real / factory.
 *
 * The mock manager is a code module (not an agent step). It provides:
 * - Registration and retrieval of mock entries via StateManager
 * - Detection of external services from phase descriptions
 * - Prompt generation for mock creation (Wave 1) and swap (Wave 2)
 * - Validation of mock entries
 *
 * Requirements: MOCK-01, MOCK-02, MOCK-03, MOCK-04, PIPE-02
 */

import type { StateManager } from "../state/state-manager.js";
import type { MockEntry, ServiceDetection } from "./types.js";

// ---------------------------------------------------------------------------
// Known external service patterns
// ---------------------------------------------------------------------------

/**
 * Known external services and their metadata.
 * Used by detectExternalServices to match keywords in phase descriptions.
 */
const KNOWN_SERVICES: ReadonlyArray<{
  keywords: string[];
  service: string;
  signupUrl: string;
  credentialsNeeded: string[];
  why: string;
}> = [
  {
    keywords: ["stripe", "payment", "billing", "subscription"],
    service: "stripe",
    signupUrl: "https://dashboard.stripe.com/register",
    credentialsNeeded: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    why: "Payment processing",
  },
  {
    keywords: ["sendgrid", "email", "transactional email"],
    service: "sendgrid",
    signupUrl: "https://signup.sendgrid.com/",
    credentialsNeeded: ["SENDGRID_API_KEY"],
    why: "Transactional email delivery",
  },
  {
    keywords: ["twilio", "sms", "phone", "messaging"],
    service: "twilio",
    signupUrl: "https://www.twilio.com/try-twilio",
    credentialsNeeded: [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_PHONE_NUMBER",
    ],
    why: "SMS and phone messaging",
  },
  {
    keywords: ["openai", "gpt", "chatgpt", "ai model", "llm"],
    service: "openai",
    signupUrl: "https://platform.openai.com/signup",
    credentialsNeeded: ["OPENAI_API_KEY"],
    why: "AI/LLM API access",
  },
  {
    keywords: ["aws", "amazon web services", "s3", "lambda", "dynamodb"],
    service: "aws",
    signupUrl: "https://aws.amazon.com/",
    credentialsNeeded: [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_REGION",
    ],
    why: "AWS cloud services",
  },
  {
    keywords: ["s3", "object storage", "file storage", "bucket"],
    service: "aws-s3",
    signupUrl: "https://aws.amazon.com/s3/",
    credentialsNeeded: [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_S3_BUCKET",
    ],
    why: "S3 object storage",
  },
  {
    keywords: ["oauth", "google auth", "github auth", "social login"],
    service: "oauth",
    signupUrl: "",
    credentialsNeeded: ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET"],
    why: "OAuth authentication provider",
  },
  {
    keywords: ["smtp", "mail server", "email server"],
    service: "smtp",
    signupUrl: "",
    credentialsNeeded: [
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_USER",
      "SMTP_PASSWORD",
    ],
    why: "SMTP email server",
  },
  {
    keywords: ["redis", "cache", "session store", "pub/sub"],
    service: "redis",
    signupUrl: "https://redis.com/try-free/",
    credentialsNeeded: ["REDIS_URL"],
    why: "Redis caching and pub/sub",
  },
  {
    keywords: ["firebase", "firestore", "fcm", "push notification"],
    service: "firebase",
    signupUrl: "https://console.firebase.google.com/",
    credentialsNeeded: [
      "FIREBASE_PROJECT_ID",
      "FIREBASE_PRIVATE_KEY",
      "FIREBASE_CLIENT_EMAIL",
    ],
    why: "Firebase services",
  },
  {
    keywords: ["database", "postgres", "mysql", "mongodb"],
    service: "database",
    signupUrl: "",
    credentialsNeeded: ["DATABASE_URL"],
    why: "Database connection",
  },
  {
    keywords: ["cloudflare", "cdn", "edge"],
    service: "cloudflare",
    signupUrl: "https://dash.cloudflare.com/sign-up",
    credentialsNeeded: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID"],
    why: "Cloudflare CDN and edge services",
  },
];

// ---------------------------------------------------------------------------
// MockManager class
// ---------------------------------------------------------------------------

/**
 * Manages mock registration, detection, prompt building, and validation.
 *
 * Requirements: MOCK-01, MOCK-02, MOCK-03, MOCK-04
 */
export class MockManager {
  constructor(private stateManager: StateManager) {}

  // -------------------------------------------------------------------------
  // Registry operations (MOCK-01, MOCK-02)
  // -------------------------------------------------------------------------

  /**
   * Register a mock entry for a service.
   * Updates state.mockRegistry[serviceName] = entry.
   *
   * Requirement: MOCK-01, MOCK-02
   */
  async registerMock(serviceName: string, entry: MockEntry): Promise<void> {
    await this.stateManager.update((state) => ({
      ...state,
      mockRegistry: {
        ...state.mockRegistry,
        [serviceName]: entry,
      },
    }));
  }

  /**
   * Get all registered mocks.
   * Returns state.mockRegistry.
   *
   * Requirement: MOCK-02
   */
  async getMockRegistry(): Promise<Record<string, MockEntry>> {
    const state = this.stateManager.load();
    return state.mockRegistry as Record<string, MockEntry>;
  }

  /**
   * Get a single mock entry by service name.
   */
  async getMock(serviceName: string): Promise<MockEntry | undefined> {
    const registry = await this.getMockRegistry();
    return registry[serviceName];
  }

  // -------------------------------------------------------------------------
  // Service detection (PIPE-02)
  // -------------------------------------------------------------------------

  /**
   * Detect external services from a phase description.
   * Uses keyword matching against known service patterns.
   *
   * Requirement: PIPE-02
   *
   * @param phaseDescription - Text describing the phase work
   * @param phaseNumber - Phase number for tracking
   * @returns Array of detected ServiceDetection objects
   */
  detectExternalServices(
    phaseDescription: string,
    phaseNumber: number,
  ): ServiceDetection[] {
    const descLower = phaseDescription.toLowerCase();
    const detected: ServiceDetection[] = [];
    const seenServices = new Set<string>();

    for (const known of KNOWN_SERVICES) {
      // Skip if we already detected this service
      if (seenServices.has(known.service)) continue;

      // Check if any keyword matches
      const matched = known.keywords.some((kw) => descLower.includes(kw));
      if (matched) {
        seenServices.add(known.service);
        detected.push({
          service: known.service,
          why: known.why,
          phase: phaseNumber,
          signupUrl: known.signupUrl || undefined,
          credentialsNeeded: [...known.credentialsNeeded],
        });
      }
    }

    return detected;
  }

  // -------------------------------------------------------------------------
  // Prompt builders (PIPE-02, MOCK-03)
  // -------------------------------------------------------------------------

  /**
   * Build mock instructions for a phase execution prompt (Wave 1).
   * Tells the agent to use the 4-file pattern for each detected service.
   *
   * Requirement: PIPE-02, MOCK-04
   *
   * @param services - External services detected for this phase
   * @returns Instruction text to append to the phase execution prompt
   */
  buildMockInstructions(services: ServiceDetection[]): string {
    if (services.length === 0) {
      return "";
    }

    const serviceList = services
      .map((s) => `- **${s.service}**: ${s.why}`)
      .join("\n");

    return `## External Service Mocking Instructions

The following external services were detected for this phase:
${serviceList}

For each external service, create 4 files following this pattern:
1. \`src/services/{name}.ts\` -- TypeScript interface defining the service contract
2. \`src/services/{name}.mock.ts\` -- Mock implementation with \`// FORGE:MOCK -- swap for real in Wave 2\` tag
3. \`src/services/{name}.real.ts\` -- Real implementation (stub that throws "Not implemented -- Wire in Wave 2")
4. \`src/services/{name}.factory.ts\` -- Factory that returns mock or real based on \`process.env.USE_REAL_{NAME}\`

**IMPORTANT (MOCK-04):** Mock and real implementations MUST implement the SAME TypeScript interface defined in the interface file. The factory must return the interface type so consumers are decoupled from the implementation.

All mock files MUST include the comment tag: \`// FORGE:MOCK -- swap for real in Wave 2\`

Use the mock implementation in all application code during this phase. Real credentials will be provided in Wave 2.`;
  }

  /**
   * Build swap prompt for Wave 2 (MOCK-03).
   * Given the full mock registry, produces a prompt telling the agent
   * to replace each mock with a real implementation using credentials.
   *
   * Requirement: MOCK-03
   *
   * @param registry - Full mock registry from state
   * @param credentials - Credential key-value pairs from the user
   * @returns Prompt text for the swap step
   */
  buildSwapPrompt(
    registry: Record<string, MockEntry>,
    credentials: Record<string, string>,
  ): string {
    const entries = Object.entries(registry);
    if (entries.length === 0) {
      return "No mocks to swap. All services are already using real implementations.";
    }

    const swapInstructions = entries
      .map(([serviceName, entry]) => {
        const relevantCreds = entry.envVars
          .filter((v) => credentials[v])
          .map((v) => `  - \`${v}\` = provided`)
          .join("\n");

        return `### ${serviceName}
- **Interface:** \`${entry.interface}\`
- **Current mock:** \`${entry.mock}\` (to be replaced)
- **Real implementation:** \`${entry.real}\` (fill in with real logic)
- **Factory:** \`${entry.factory}\` (update to default to real)
- **Credentials available:**
${relevantCreds || "  - (none provided)"}

Replace the stub in \`${entry.real}\` with a working implementation using the provided credentials. Update \`${entry.factory}\` to default to the real implementation. Remove the \`// FORGE:MOCK\` tag from swapped files. Ensure the real implementation passes the same tests as the mock (MOCK-04).`;
      })
      .join("\n\n");

    return `## Wave 2: Mock-to-Real Swap

Replace all mock implementations with real ones using the provided credentials.

${swapInstructions}

After swapping, run integration tests to verify real implementations work correctly.`;
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Validate that a mock entry has all 4 files.
   * Optionally checks files exist on disk.
   *
   * @param entry - MockEntry to validate
   * @param fs - Optional filesystem for checking file existence
   * @returns Validation result with missing file details
   */
  validateMockEntry(
    entry: MockEntry,
    fs?: { existsSync: (p: string) => boolean },
  ): { valid: boolean; missing: string[] } {
    const missing: string[] = [];

    // Check that all 4 file paths are non-empty strings
    if (!entry.interface || entry.interface.trim() === "") {
      missing.push("interface");
    }
    if (!entry.mock || entry.mock.trim() === "") {
      missing.push("mock");
    }
    if (!entry.real || entry.real.trim() === "") {
      missing.push("real");
    }
    if (!entry.factory || entry.factory.trim() === "") {
      missing.push("factory");
    }

    // Optionally check files exist on disk
    if (fs && missing.length === 0) {
      if (!fs.existsSync(entry.interface)) missing.push("interface");
      if (!fs.existsSync(entry.mock)) missing.push("mock");
      if (!fs.existsSync(entry.real)) missing.push("real");
      if (!fs.existsSync(entry.factory)) missing.push("factory");
    }

    return {
      valid: missing.length === 0,
      missing,
    };
  }
}
