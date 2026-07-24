import process from "node:process";
import readline from "node:readline";
import { DEFAULT_MAX_STORE_BYTES, ShapeLexEngine } from "./shapelex.js";

const engine = new ShapeLexEngine({
  storageDir: process.env.SHAPELEX_STORE_DIR ?? ".shapelex",
  persistent: process.env.SHAPELEX_PERSIST !== "0",
  maxStoreBytes: maxStoreBytesFromEnv(process.env.SHAPELEX_MAX_STORE_MB)
});

const defaultToolset = normalizeToolset(process.env.SHAPELEX_TOOLSET);
const serverInstructions = [
  "ShapeLex is agent-driven compressed navigable memory.",
  "Use ShapeLex proactively for long pasted context, repeated project notes, older conversation history, large docs, logs, or code snippets; do not wait for the user to say \"use ShapeLex\".",
  "Briefly tell the user the first time you compress context in a session, and when switching or cleaning memory.",
  "Use shapelex_context before loading old memory into the prompt.",
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
    description: "Agent-driven: compress older chat messages into sx:// handles when conversation history gets long or repeated.",
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
        budgetTokens: { type: "number" }
      },
      required: ["messages"],
      additionalProperties: false
    }
  },
  {
    name: "shapelex_compress_text",
    description: "Agent-driven: compress long text, code, docs, logs, or project notes into sx:// handles.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        text: { type: "string" },
        label: { type: "string" },
        mode: { type: "string", enum: ["text", "doc", "message", "code"] },
        budgetTokens: { type: "number" }
      },
      required: ["text"],
      additionalProperties: false
    }
  },
  {
    name: "shapelex_expand",
    description: "Expand an sx:// handle to exact text before relying on details that require precision.",
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
    description: "Agent-driven: return compact task-ready memory before reloading old context into the prompt.",
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
    description: "Full mode only: search/retrieve/explain/risk/stats.",
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
    description: "Show active sessions and cleanup suggestions when starting, switching, or cleaning project memory.",
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
    description: "Clear one session or all memory.",
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
    description: "Preview/remove old sessions.",
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

export function startMcpServer({ input = process.stdin, output = process.stdout }: any = {}) {
  const rl = readline.createInterface({ input });
  const handle = createJsonRpcHandler(engine, { toolset: defaultToolset });

  rl.on("line", async (line) => {
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
      output.write(`${JSON.stringify(errorResponse(id, error))}\n`);
    }
  });
}

export const handleJsonRpc = createJsonRpcHandler(engine);

export function createJsonRpcHandler(targetEngine: ShapeLexEngine, { toolset = "lean" }: any = {}) {
  const activeTools = toolsForToolset(normalizeToolset(toolset));

  return async function handle(request: any): Promise<any> {
    if (request.jsonrpc !== "2.0") {
      return errorResponse(request.id ?? null, new Error("Expected JSON-RPC 2.0 request"));
    }

    if (request.method?.startsWith("notifications/")) {
      return undefined;
    }

    try {
      const result = await dispatch(targetEngine, activeTools, request.method, request.params ?? {});
      return {
        jsonrpc: "2.0",
        id: request.id,
        result
      };
    } catch (error) {
      return errorResponse(request.id, error);
    }
  };
}

async function dispatch(targetEngine: ShapeLexEngine, activeTools: any[], method: any, params: any): Promise<any> {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params.protocolVersion ?? "2025-06-18",
        capabilities: {
          tools: {},
          resources: {
            listChanged: true
          }
        },
        serverInfo: {
          name: "shapelex-mcp",
          version: "0.4.0"
        },
        instructions: serverInstructions
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: activeTools };
    case "tools/call":
      return callTool(targetEngine, activeTools, params);
    case "resources/list":
      return targetEngine.listResources(params);
    case "resources/read":
      return targetEngine.readResource(params);
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

function callTool(targetEngine: ShapeLexEngine, activeTools: any[], params: any): any {
  if (!params || typeof params !== "object") {
    throw new TypeError("tools/call params must be an object");
  }
  const { name, arguments: args = {} } = params;
  if (typeof name !== "string") {
    throw new TypeError("tools/call params.name must be a string");
  }
  if (!activeTools.some((tool) => tool.name === name)) {
    throw new Error(`Tool is not available in the active ShapeLex toolset: ${name}`);
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new TypeError("tools/call params.arguments must be an object");
  }
  let result;

  switch (name) {
    case "shapelex_compress_messages":
      result = targetEngine.compressMessages(args);
      break;
    case "shapelex_compress_text":
      result = targetEngine.compressText(args);
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

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ],
    structuredContent: result
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
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error)
    }
  };
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

function toolsForToolset(toolset: string) {
  if (toolset === "lean") {
    return tools.filter((tool) => leanToolNames.has(tool.name));
  }
  return tools;
}
