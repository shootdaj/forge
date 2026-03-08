/**
 * Case Transform Utility Tests
 *
 * Tests for snake_case <-> camelCase bidirectional mapping.
 *
 * Requirements: STA-02
 */

import { describe, it, expect } from "vitest";
import {
  snakeToCamel,
  camelToSnake,
  snakeToCamelKeys,
  camelToSnakeKeys,
} from "./case-transform.js";

describe("Case Transform Utilities", () => {
  describe("TestSnakeToCamel_SimpleStrings", () => {
    it("converts simple snake_case to camelCase", () => {
      expect(snakeToCamel("max_budget_total")).toBe("maxBudgetTotal");
      expect(snakeToCamel("model")).toBe("model");
      expect(snakeToCamel("docker_compose_file")).toBe("dockerComposeFile");
      expect(snakeToCamel("a_b_c")).toBe("aBC");
      expect(snakeToCamel("")).toBe("");
    });
  });

  describe("TestCamelToSnake_SimpleStrings", () => {
    it("converts camelCase to snake_case", () => {
      expect(camelToSnake("maxBudgetTotal")).toBe("max_budget_total");
      expect(camelToSnake("model")).toBe("model");
      expect(camelToSnake("dockerComposeFile")).toBe("docker_compose_file");
      expect(camelToSnake("aBC")).toBe("a_b_c");
      expect(camelToSnake("")).toBe("");
    });
  });

  describe("TestSnakeToCamelKeys_NestedObjects_STA02", () => {
    it("STA-02: recursively transforms nested object keys", () => {
      const input = {
        project_dir: "/path",
        total_budget_used: 42.5,
        spec_compliance: {
          total_requirements: 16,
          gap_history: [16, 5, 2],
        },
        services_needed: [
          {
            service: "stripe",
            signup_url: "https://stripe.com",
            credentials_needed: ["KEY"],
          },
        ],
      };

      const result = snakeToCamelKeys<Record<string, unknown>>(input);

      expect(result.projectDir).toBe("/path");
      expect(result.totalBudgetUsed).toBe(42.5);
      expect(
        (result.specCompliance as Record<string, unknown>).totalRequirements,
      ).toBe(16);
      expect(
        (result.specCompliance as Record<string, unknown>).gapHistory,
      ).toEqual([16, 5, 2]);

      const services = result.servicesNeeded as Array<Record<string, unknown>>;
      expect(services[0].service).toBe("stripe");
      expect(services[0].signupUrl).toBe("https://stripe.com");
      expect(services[0].credentialsNeeded).toEqual(["KEY"]);
    });
  });

  describe("TestCamelToSnakeKeys_NestedObjects_STA02", () => {
    it("STA-02: recursively transforms camelCase keys to snake_case", () => {
      const input = {
        projectDir: "/path",
        totalBudgetUsed: 42.5,
        specCompliance: {
          totalRequirements: 16,
          gapHistory: [16, 5, 2],
        },
      };

      const result = camelToSnakeKeys<Record<string, unknown>>(input);

      expect(result.project_dir).toBe("/path");
      expect(result.total_budget_used).toBe(42.5);
      expect(
        (result.spec_compliance as Record<string, unknown>).total_requirements,
      ).toBe(16);
    });
  });

  describe("TestRoundTrip_SnakeToCamelAndBack", () => {
    it("STA-02: round-trip snake->camel->snake preserves data", () => {
      const original = {
        project_dir: "/path",
        current_wave: 2,
        phases: {
          "1": { status: "completed", budget_used: 4.23 },
        },
        mock_registry: {
          stripe: {
            interface: "src/stripe.ts",
            env_vars: ["KEY"],
          },
        },
      };

      const camel = snakeToCamelKeys<Record<string, unknown>>(original);
      const backToSnake = camelToSnakeKeys<Record<string, unknown>>(camel);

      expect(backToSnake).toEqual(original);
    });
  });

  describe("TestCamelToSnake_PreservesScreamingSnakeCase", () => {
    it("preserves SCREAMING_SNAKE_CASE keys like env var names", () => {
      expect(camelToSnake("OAUTH_CLIENT_ID")).toBe("OAUTH_CLIENT_ID");
      expect(camelToSnake("OAUTH_CLIENT_SECRET")).toBe("OAUTH_CLIENT_SECRET");
      expect(camelToSnake("API_KEY")).toBe("API_KEY");
      expect(camelToSnake("DB_URL")).toBe("DB_URL");
    });

    it("preserves numeric keys", () => {
      expect(camelToSnake("1")).toBe("1");
      expect(camelToSnake("42")).toBe("42");
    });

    it("preserves credential keys in nested objects through round-trip", () => {
      const original = {
        credentials: {
          OAUTH_CLIENT_ID: "abc",
          OAUTH_CLIENT_SECRET: "xyz",
        },
        human_guidance: {},
        project_dir: "/tmp/test",
      };

      const camel = snakeToCamelKeys<Record<string, unknown>>(original);
      const backToSnake = camelToSnakeKeys<Record<string, unknown>>(camel);

      expect(backToSnake).toEqual(original);
    });
  });

  describe("TestTransformPrimitives", () => {
    it("handles null, undefined, and primitives without error", () => {
      expect(snakeToCamelKeys(null)).toBeNull();
      expect(snakeToCamelKeys(undefined)).toBeUndefined();
      expect(snakeToCamelKeys(42)).toBe(42);
      expect(snakeToCamelKeys("hello")).toBe("hello");
      expect(snakeToCamelKeys(true)).toBe(true);
    });
  });

  describe("TestTransformArrays", () => {
    it("transforms objects inside arrays", () => {
      const input = [
        { item_name: "a", sub_items: [{ nested_key: 1 }] },
        { item_name: "b" },
      ];

      const result = snakeToCamelKeys<Array<Record<string, unknown>>>(input);

      expect(result[0].itemName).toBe("a");
      expect(
        (result[0].subItems as Array<Record<string, unknown>>)[0].nestedKey,
      ).toBe(1);
      expect(result[1].itemName).toBe("b");
    });
  });
});
