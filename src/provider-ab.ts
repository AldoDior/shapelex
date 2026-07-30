export type ProviderVariant = "raw" | "shapelex" | "native_compaction";

export interface ProviderABCase {
  id: string;
  requiredFacts: readonly string[];
  prompts: Record<ProviderVariant, string>;
}

export interface ProviderInvocation {
  caseId: string;
  variant: ProviderVariant;
  prompt: string;
}

export interface ProviderInvocationResult {
  output: string;
  inputTokens: number;
  outputTokens: number;
}

export type ProviderInvoker = (
  invocation: ProviderInvocation
) => Promise<ProviderInvocationResult>;

export interface ProviderABResult {
  caseId: string;
  variant: ProviderVariant;
  inputTokens: number;
  outputTokens: number;
  factFidelity: number;
}

export async function runProviderAB(
  cases: readonly ProviderABCase[],
  {
    invoke,
    maxRequests,
    maxInputTokensPerRequest
  }: {
    invoke: ProviderInvoker;
    maxRequests: number;
    maxInputTokensPerRequest: number;
  }
): Promise<ProviderABResult[]> {
  const plannedRequests = cases.length * 3;
  if (!Number.isSafeInteger(maxRequests) || maxRequests < plannedRequests) {
    throw new RangeError(`Provider evaluation requires ${plannedRequests} allowed requests.`);
  }
  if (!Number.isSafeInteger(maxInputTokensPerRequest) || maxInputTokensPerRequest < 1) {
    throw new RangeError("maxInputTokensPerRequest must be a positive safe integer.");
  }

  const results: ProviderABResult[] = [];
  for (const item of cases) {
    validateCase(item);
    for (const variant of ["raw", "shapelex", "native_compaction"] as const) {
      const response = await invoke({
        caseId: item.id,
        variant,
        prompt: item.prompts[variant]
      });
      validateUsage(response);
      if (response.inputTokens > maxInputTokensPerRequest) {
        throw new RangeError(`${item.id}/${variant} exceeded the configured input-token cap.`);
      }
      const recoveredFacts = item.requiredFacts.filter((fact) => response.output.includes(fact));
      results.push({
        caseId: item.id,
        variant,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        factFidelity: item.requiredFacts.length === 0
          ? 1
          : recoveredFacts.length / item.requiredFacts.length
      });
    }
  }
  return results;
}

export function createEnvironmentHttpInvoker({
  environment = process.env,
  fetchImpl = fetch,
  timeoutMs = 30_000
}: {
  environment?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): ProviderInvoker {
  const endpoint = environment.SHAPELEX_PROVIDER_ENDPOINT;
  const apiKey = environment.SHAPELEX_PROVIDER_API_KEY;
  if (!endpoint || !apiKey) {
    throw new Error("SHAPELEX_PROVIDER_ENDPOINT and SHAPELEX_PROVIDER_API_KEY are required.");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("Provider timeout must be a positive number.");
  }

  return async (invocation) => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(invocation),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      throw new Error(`Provider evaluation failed with HTTP ${response.status}.`);
    }
    const payload: unknown = await response.json();
    return parseProviderResponse(payload);
  };
}

function validateCase(value: ProviderABCase): void {
  if (
    !value
    || typeof value.id !== "string"
    || value.id.length === 0
    || !Array.isArray(value.requiredFacts)
    || value.requiredFacts.some((fact) => typeof fact !== "string")
    || !value.prompts
    || ["raw", "shapelex", "native_compaction"].some(
      (variant) => typeof value.prompts[variant as ProviderVariant] !== "string"
    )
  ) {
    throw new TypeError("Provider evaluation case is invalid.");
  }
}

function parseProviderResponse(value: unknown): ProviderInvocationResult {
  if (!value || typeof value !== "object") {
    throw new TypeError("Provider response must be an object.");
  }
  const candidate = value as Partial<ProviderInvocationResult>;
  validateUsage(candidate);
  if (typeof candidate.output !== "string") {
    throw new TypeError("Provider response output must be a string.");
  }
  return candidate as ProviderInvocationResult;
}

function validateUsage(
  value: Partial<ProviderInvocationResult>
): asserts value is ProviderInvocationResult {
  for (const [name, count] of [
    ["inputTokens", value.inputTokens],
    ["outputTokens", value.outputTokens]
  ] as const) {
    if (!Number.isSafeInteger(count) || (count ?? -1) < 0) {
      throw new TypeError(`${name} must be a non-negative safe integer.`);
    }
  }
}
