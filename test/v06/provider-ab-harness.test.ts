import assert from "node:assert/strict";
import test from "node:test";
import {
  createEnvironmentHttpInvoker,
  runProviderAB,
  type ProviderInvocation
} from "./provider-ab-harness.js";

test("provider A/B runner applies identical fact metrics to all three variants", async () => {
  const invocations: ProviderInvocation[] = [];
  const results = await runProviderAB([{
    id: "case-1",
    requiredFacts: ["limit >= 12", "do not delete"],
    prompts: {
      raw: "raw",
      shapelex: "shapelex",
      native_compaction: "native"
    }
  }], {
    maxRequests: 3,
    maxInputTokensPerRequest: 100,
    async invoke(invocation) {
      invocations.push(invocation);
      return {
        output: invocation.variant === "shapelex"
          ? "limit >= 12 and do not delete"
          : "limit >= 12",
        inputTokens: 10,
        outputTokens: 5
      };
    }
  });

  assert.deepEqual(invocations.map((item) => item.variant), [
    "raw",
    "shapelex",
    "native_compaction"
  ]);
  assert.deepEqual(results.map((item) => item.factFidelity), [0.5, 1, 0.5]);
});

test("provider A/B runner enforces request and token caps before accepting a report", async () => {
  const scenario = [{
    id: "bounded",
    requiredFacts: [],
    prompts: { raw: "a", shapelex: "b", native_compaction: "c" }
  }] as const;
  await assert.rejects(
    () => runProviderAB(scenario, {
      maxRequests: 2,
      maxInputTokensPerRequest: 100,
      async invoke() {
        throw new Error("must not run");
      }
    }),
    /requires 3/
  );
  await assert.rejects(
    () => runProviderAB(scenario, {
      maxRequests: 3,
      maxInputTokensPerRequest: 5,
      async invoke() {
        return { output: "", inputTokens: 6, outputTokens: 0 };
      }
    }),
    /token cap/
  );
});

test("HTTP provider adapter requires environment-only credentials and is mockable", async () => {
  assert.throws(
    () => createEnvironmentHttpInvoker({ environment: {} }),
    /SHAPELEX_PROVIDER_ENDPOINT/
  );

  let authorization = "";
  const invoke = createEnvironmentHttpInvoker({
    environment: {
      SHAPELEX_PROVIDER_ENDPOINT: "https://provider.invalid/evaluate",
      SHAPELEX_PROVIDER_API_KEY: "secret-from-environment"
    },
    fetchImpl: async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({
        output: "safe result",
        inputTokens: 12,
        outputTokens: 3
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  const result = await invoke({ caseId: "mock", variant: "raw", prompt: "hello" });

  assert.equal(authorization, "Bearer secret-from-environment");
  assert.deepEqual(result, { output: "safe result", inputTokens: 12, outputTokens: 3 });
});

