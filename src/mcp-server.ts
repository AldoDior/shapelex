import process from "node:process";
import { DEFAULT_MAX_STORE_BYTES, ShapeLexEngine } from "./shapelex.js";
import { PACKAGE_VERSION } from "./version.js";

export function createEngineFromEnvironment(environment: any = process.env, cwd = process.cwd()) {
  const persistent = environment.SHAPELEX_PERSIST !== "0";
  return new ShapeLexEngine({
    storageDir: persistent ? environment.SHAPELEX_STORE_DIR ?? ".shapelex" : undefined,
    persistent,
    maxStoreBytes: maxStoreBytesFromEnv(environment.SHAPELEX_MAX_STORE_MB),
    workspaceRoot: environment.SHAPELEX_WORKSPACE_ROOT ?? cwd
  });
}

const defaultToolset = normalizeToolset(process.env.SHAPELEX_TOOLSET);
const defaultResponseMode = normalizeResponseMode(process.env.SHAPELEX_RESPONSE_MODE);
const DEFAULT_MAX_JSON_RPC_LINE_CHARACTERS = 16 * 1024 * 1024;
const serverInstructions = [
  "ShapeLex is agent-driven compressed navigable memory.",
  "Use ShapeLex proactively for long pasted context, repeated project notes, older conversation history, large docs, logs, or code snippets; do not wait for the user to say \"use ShapeLex\".",
  "Briefly tell the user the first time you compress context in a session, and when switching or cleaning memory.",
  "Use shapelex_context before loading old memory into the prompt.",
  "Recommend lean mode for normal work; suggest full mode only when the user needs deeper search, retrieve, explain, risk, or stats actions.",
  "Suggest a new readable sessionId when the project, repo, client, or task changes so unrelated memory does not mix.",
  "Suggest cleanup when memory is old, noisy, unrelated, or confusing; preview with shapelex_prune dryRun before deleting and ask before destructive cleanup.",
  "Prefer sourcePath for workspace files so full file text does not enter the model prompt merely to be compressed.",
  "Do not compress short one-off text; inline text already present in conversation only helps if compact memory will be reused later.",
  "Expand sx:// handles before relying on exact wording, numbers, dates, negations, user instructions, code, errors, commands, or decisions.",
  "If risk.shouldExpand or risk.mustExpand is true for a needed detail, expand before acting.",
  "Keep chat output terse so saved input tokens are not wasted on unnecessary explanation."
].join(" ");
const leanToolNames = new Set([
  "shapelex_compress_text",
  "shapelex_compress_messages",
  "shapelex_context",
  "shapelex_expand",
  "shapelex_memory_overview",
  "shapelex_clear",
  "shapelex_prune"
]);

const tools = [
  {
    name: "shapelex_compress_messages",
    description: "Agent-driven: compress older/repeated chat into sx:// handles.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              content: { type: "string" }
            },
            required: ["role", "content"]
          }
        },
        label: { type: "string" },
        budgetTokens: { type: "integer", minimum: 1 }
      },
      required: ["messages"],
      additionalProperties: false
    }
  },
  {
    name: "shapelex_compress_text",
    description: "Compress reusable long text; prefer sourcePath for workspace files to avoid loading full file text.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        text: { type: "string" },
        sourcePath: { type: "string" },
        label: { type: "string" },
        mode: { type: "string", enum: ["text", "doc", "message", "code"] },
        budgetTokens: { type: "integer", minimum: 1 }
      },
      oneOf: [
        { required: ["text"] },
        { required: ["sourcePath"] }
      ],
      additionalProperties: false
    }
  },
  {
    name: "shapelex_expand",
    description: "Expand sx:// to exact text for precision.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        handle: { type: "string" }
      },
      required: ["handle"],
      additionalProperties: false
    }
  },
  {
    name: "shapelex_context",
    description: "Agent-driven: return compact task-ready memory.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        query: { type: "string" },
        mode: { type: "string", enum: ["text", "code", "conversation"] },
        limit: { type: "number" },
        detail: { type: "string", enum: ["brief", "standard"] }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "shapelex_inspect",
    description: "Full only: deeper search/retrieve/explain/risk/stats.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "retrieve", "explain", "risk", "stats"] },
        sessionId: { type: "string" },
        query: { type: "string" },
        uri: { type: "string" },
        level: { type: "number" },
        mode: { type: "string", enum: ["text", "code", "conversation"] },
        limit: { type: "number" },
        text: { type: "string" }
      },
      required: ["action"],
      additionalProperties: false
    }
  },
  {
    name: "shapelex_memory_overview",
    description: "Show sessions and cleanup suggestions.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "shapelex_clear",
    description: "Clear one session or all memory after approval.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "shapelex_prune",
    description: "Preview/remove old sessions; use dryRun first.",
    inputSchema: {
      type: "object",
      properties: {
        olderThanDays: { type: "number" },
        maxSessions: { type: "number" },
        dryRun: { type: "boolean" }
      },
      additionalProperties: false
    }
  }
];

export function startMcpServer({
  input = process.stdin,
  output = process.stdout,
  maxLineCharacters = DEFAULT_MAX_JSON_RPC_LINE_CHARACTERS,
  targetEngine,
  toolset = defaultToolset,
  responseMode = defaultResponseMode
}: any = {}) {
  if (!Number.isSafeInteger(maxLineCharacters) || maxLineCharacters <= 0) {
    throw new RangeError("maxLineCharacters must be a positive safe integer");
  }
  const handle = createJsonRpcHandler(targetEngine ?? createEngineFromEnvironment(), {
    toolset,
    responseMode
  });
  let buffer = "";
  let discardingOversizedLine = false;
  let queue = Promise.resolve();
  let resolveClosed: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  input.setEncoding?.("utf8");

  const enqueueLine = (line: string | undefined) => {
    queue = queue.then(async () => {
      if (line === undefined) {
        output.write(`${JSON.stringify(errorResponse(null, new JsonRpcError(-32600, "Invalid Request")))}\n`);
        return;
      }
      if (!line.trim()) {
        return;
      }

      let request;
      try {
        request = JSON.parse(line);
        const response = await handle(request);
        if (response) {
          output.write(`${JSON.stringify(response)}\n`);
        }
      } catch (error) {
        const id = request?.id ?? null;
        const rpcError = error instanceof SyntaxError
          ? new JsonRpcError(-32700, "Parse error")
          : error;
        output.write(`${JSON.stringify(errorResponse(id, rpcError))}\n`);
      }
    });
  };

  input.on("data", (rawChunk: string | Buffer) => {
    const chunk = typeof rawChunk === "string" ? rawChunk : rawChunk.toString("utf8");
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf("\n", offset);
      const end = newline === -1 ? chunk.length : newline;
      const segmentLength = end - offset;
      if (
        !discardingOversizedLine
        && buffer.length + segmentLength <= maxLineCharacters
      ) {
        buffer += chunk.slice(offset, end);
      } else {
        buffer = "";
        discardingOversizedLine = true;
      }

      if (newline === -1) {
        break;
      }
      enqueueLine(discardingOversizedLine ? undefined : buffer.replace(/\r$/u, ""));
      buffer = "";
      discardingOversizedLine = false;
      offset = newline + 1;
    }
  });

  input.on("end", () => {
    if (discardingOversizedLine) {
      enqueueLine(undefined);
    } else if (buffer.length > 0) {
      enqueueLine(buffer.replace(/\r$/u, ""));
    }
    void queue.finally(resolveClosed!);
  });

  return { closed };
}

// Keep the importable convenience handler isolated from persistent user memory.
// The stdio server creates its environment-configured persistent engine lazily.
export const handleJsonRpc = createJsonRpcHandler(new ShapeLexEngine({ persistent: false }));

export function createJsonRpcHandler(
  targetEngine: ShapeLexEngine,
  { toolset = "lean", responseMode = "content-only" }: any = {}
) {
  const activeTools = toolsForToolset(normalizeToolset(toolset));
  const activeResponseMode = normalizeResponseMode(responseMode);

  return async function handle(request: any): Promise<any> {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      return errorResponse(null, new JsonRpcError(-32600, "Invalid Request"));
    }
    if (request.jsonrpc !== "2.0") {
      return errorResponse(request.id ?? null, new JsonRpcError(-32600, "Invalid Request"));
    }
    if (typeof request.method !== "string") {
      return errorResponse(request.id ?? null, new JsonRpcError(-32600, "Invalid Request"));
    }

    const isNotification = request.id === undefined;
    if (request.method?.startsWith("notifications/")) {
      return undefined;
    }

    try {
      const result = await dispatch(
        targetEngine,
        activeTools,
        activeResponseMode,
        request.method,
        request.params ?? {}
      );
      if (isNotification) {
        return undefined;
      }
      return {
        jsonrpc: "2.0",
        id: request.id,
        result
      };
    } catch (error) {
      if (isNotification) {
        return undefined;
      }
      return errorResponse(request.id, error);
    }
  };
}

async function dispatch(
  targetEngine: ShapeLexEngine,
  activeTools: any[],
  responseMode: string,
  method: any,
  params: any
): Promise<any> {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params.protocolVersion ?? "2025-06-18",
        capabilities: {
          tools: {},
          resources: {
            listChanged: false
          }
        },
        serverInfo: {
          name: "shapelex-mcp",
          version: PACKAGE_VERSION
        },
        instructions: serverInstructions
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: activeTools };
    case "tools/call":
      return callTool(targetEngine, activeTools, responseMode, params);
    case "resources/list":
      return targetEngine.listResources(params);
    case "resources/read":
      return targetEngine.readResource(params);
    default:
      throw new JsonRpcError(-32601, `Method not found: ${method}`);
  }
}

function callTool(targetEngine: ShapeLexEngine, activeTools: any[], responseMode: string, params: any): any {
  if (!params || typeof params !== "object") {
    throw new TypeError("tools/call params must be an object");
  }
  const { name, arguments: args = {} } = params;
  if (typeof name !== "string") {
    throw new TypeError("tools/call params.name must be a string");
  }
  const tool = activeTools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new TypeError(`Tool is not available in the active ShapeLex toolset: ${name}`);
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new TypeError("tools/call params.arguments must be an object");
  }
  validateSchemaValue(args, tool.inputSchema, "tools/call params.arguments");
  let result;

  switch (name) {
    case "shapelex_compress_messages":
      result = targetEngine.compressMessages(args);
      break;
    case "shapelex_compress_text":
      result = args.sourcePath === undefined
        ? targetEngine.compressText(args)
        : targetEngine.compressFile(args);
      break;
    case "shapelex_expand":
      result = targetEngine.expand(args);
      break;
    case "shapelex_inspect":
      result = inspectShapeLex(targetEngine, args);
      break;
    case "shapelex_context":
      result = targetEngine.context(args);
      break;
    case "shapelex_memory_overview":
      result = targetEngine.memoryOverview(args);
      break;
    case "shapelex_clear":
      result = targetEngine.clear(args);
      break;
    case "shapelex_prune":
      result = targetEngine.prune(args);
      break;
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  const response: any = {
    content: [
      {
        type: "text",
        text: renderToolText(name, result)
      }
    ]
  };
  if (responseMode === "compatible") {
    response.structuredContent = renderStructuredContent(name, result);
  }
  return response;
}

function renderToolText(name: string, result: any) {
  if (name === "shapelex_compress_text" || name === "shapelex_compress_messages") {
    return String(result.compressedText ?? JSON.stringify(result));
  }
  if (name === "shapelex_context") {
    return String(result.contextText ?? JSON.stringify(result));
  }
  if (name === "shapelex_expand") {
    return String(result.text ?? JSON.stringify(result));
  }
  if (name === "shapelex_memory_overview") {
    return renderMemoryOverviewText(result);
  }
  return JSON.stringify(result, null, 2);
}

function renderMemoryOverviewText(result: any) {
  const sessions = Array.isArray(result.sessions) ? result.sessions : [];
  const usage = result.tokenAccounting?.currentSession ?? {};
  const visibleSessions = sessions.slice(0, 6);
  const lines = [
    "ShapeLex memory overview",
    String(result.plainEnglish ?? `Current session: ${result.currentSessionId ?? "default"}.`),
    `Estimated compression for current session: operations=${usage.operations ?? 0} raw=${usage.rawTokens ?? 0} compact=${usage.compressedTokens ?? 0} delta=${usage.tokenDelta ?? 0} savings=${usage.savingsRatio ?? 0} (not provider billing).`,
    `Stored sessions: ${sessions.length}.`
  ];
  for (const session of visibleSessions) {
    lines.push(
      `- ${session.sessionId}${session.isCurrent ? " (current)" : ""}: documents=${session.documents}, handles=${session.handles}, lastUsed=${session.lastUsed}`
    );
  }
  if (sessions.length > visibleSessions.length) {
    lines.push(`- ${sessions.length - visibleSessions.length} more session(s) omitted from text; compatible mode retains full structured details.`);
  }
  for (const suggestion of (result.suggestions ?? []).slice(0, 3)) {
    lines.push(`Suggestion: ${suggestion}`);
  }
  return lines.join("\n");
}

function renderStructuredContent(name: string, result: any) {
  if (name === "shapelex_compress_text" || name === "shapelex_compress_messages") {
    const handles = result.responseHandles ?? (result.levels?.[4]?.handles ?? []).slice(0, 8);
    const totalHandles = result.levels?.[4]?.handles?.length ?? handles.length;
    return {
      sessionId: result.sessionId,
      documentId: result.documentId,
      uri: result.uri,
      label: result.label,
      mode: result.mode,
      source: result.source,
      compressedText: result.compressedText,
      handles: handles.map((handle: any) => ({
        uri: handle.uri,
        mustExpand: Boolean(handle.risk?.mustExpand)
      })),
      totalHandles,
      omittedHandles: Math.max(0, totalHandles - handles.length),
      risk: compactRisk(result.risk),
      tokenAccounting: result.tokenAccounting,
      rawTokenEstimate: result.rawTokenEstimate,
      compressedTokenEstimate: result.compressedTokenEstimate,
      savingsRatio: result.savingsRatio,
      compressionSkipped: Boolean(result.compressionSkipped),
      skipReason: result.skipReason,
      deduplicated: Boolean(result.deduplicated),
      matchKind: result.matchKind,
      budgetTokens: result.budgetTokens,
      withinBudget: result.withinBudget
    };
  }
  if (name === "shapelex_context") {
    return {
      sessionId: result.sessionId,
      query: result.query,
      detail: result.detail,
      searchComplete: result.searchComplete,
      results: result.results,
      contextText: result.contextText,
      tokenEstimate: result.tokenEstimate,
      guidance: result.guidance
    };
  }
  if (name === "shapelex_expand") {
    return {
      handle: result.handle,
      metadata: result.metadata
    };
  }
  return result;
}

function compactRisk(risk: any) {
  if (!risk || typeof risk !== "object") {
    return risk;
  }
  return {
    level: risk.level,
    mustExpand: Boolean(risk.mustExpand),
    shouldExpand: Boolean(risk.shouldExpand),
    reasons: risk.reasons
  };
}

function inspectShapeLex(targetEngine: ShapeLexEngine, args: any): any {
  switch (args.action) {
    case "search":
      return targetEngine.search(args);
    case "retrieve":
      return targetEngine.retrieve(args);
    case "explain":
      return targetEngine.explain(args);
    case "risk":
      return targetEngine.riskAssessment(args);
    case "stats":
      return targetEngine.stats(args);
    default:
      throw new TypeError("shapelex_inspect action must be search, retrieve, explain, risk, or stats");
  }
}

function errorResponse(id: any, error: any): any {
  const code = error instanceof JsonRpcError
    ? error.rpcCode
    : error instanceof TypeError
      ? -32602
      : ["STORE_BUSY", "STORE_REVISION_CONFLICT"].includes(error?.code)
        ? -32001
        : error?.code === "STALE_SOURCE"
          ? -32002
          : -32000;
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message: publicErrorMessage(code, error)
    }
  };
}

function publicErrorMessage(code: number, error: unknown): string {
  if (code === -32001) {
    return "ShapeLex memory is busy; retry the operation.";
  }
  if (code === -32002) {
    return "ShapeLex exact source is stale or unavailable.";
  }
  if (code === -32000) {
    return "ShapeLex could not complete the operation.";
  }
  return error instanceof Error ? error.message : String(error);
}

class JsonRpcError extends Error {
  rpcCode: number;

  constructor(rpcCode: number, message: string) {
    super(message);
    this.name = "JsonRpcError";
    this.rpcCode = rpcCode;
  }
}

function validateSchemaValue(value: any, schema: any, pathLabel: string): void {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`${pathLabel} must be an object`);
    }
    for (const required of schema.required ?? []) {
      if (!(required in value)) {
        throw new TypeError(`${pathLabel}.${required} is required`);
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      const unknown = Object.keys(value).find((key) => !allowed.has(key));
      if (unknown) {
        throw new TypeError(`${pathLabel}.${unknown} is not allowed`);
      }
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value) {
        validateSchemaValue(value[key], child, `${pathLabel}.${key}`);
      }
    }
    if (Array.isArray(schema.oneOf)) {
      const matches = schema.oneOf.filter((candidate: any) => (
        (candidate.required ?? []).every((required: string) => required in value)
      )).length;
      if (matches !== 1) {
        throw new TypeError(`${pathLabel} must match exactly one allowed input form`);
      }
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      throw new TypeError(`${pathLabel} must be an array`);
    }
    value.forEach((item, index) => validateSchemaValue(item, schema.items ?? {}, `${pathLabel}[${index}]`));
    return;
  }
  if (schema.type === "integer") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${pathLabel} must be an integer`);
    }
  } else if (schema.type && typeof value !== schema.type) {
    throw new TypeError(`${pathLabel} must be a ${schema.type}`);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${pathLabel} must be finite`);
    }
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      throw new TypeError(`${pathLabel} must be greater than or equal to ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      throw new TypeError(`${pathLabel} must be less than or equal to ${schema.maximum}`);
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw new TypeError(`${pathLabel} must be one of: ${schema.enum.join(", ")}`);
  }
}

function maxStoreBytesFromEnv(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_MAX_STORE_BYTES;
  }
  const megabytes = Number(value);
  if (!Number.isFinite(megabytes) || megabytes < 1) {
    throw new TypeError("SHAPELEX_MAX_STORE_MB must be a number greater than or equal to 1");
  }
  return Math.floor(megabytes * 1024 * 1024);
}

function normalizeToolset(value: any) {
  const toolset = String(value ?? "lean").trim().toLowerCase();
  if (!["full", "lean"].includes(toolset)) {
    throw new TypeError("SHAPELEX_TOOLSET must be either full or lean");
  }
  return toolset;
}

function normalizeResponseMode(value: any) {
  const responseMode = String(value ?? "content-only").trim().toLowerCase();
  if (!["compatible", "content-only"].includes(responseMode)) {
    throw new TypeError("SHAPELEX_RESPONSE_MODE must be either compatible or content-only");
  }
  return responseMode;
}

function toolsForToolset(toolset: string) {
  if (toolset === "lean") {
    return tools.filter((tool) => leanToolNames.has(tool.name));
  }
  return tools;
}
