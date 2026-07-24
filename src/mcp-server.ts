import process from "node:process";
import readline from "node:readline";
import { DEFAULT_MAX_STORE_BYTES, ShapeLexEngine } from "./shapelex.js";

const engine = new ShapeLexEngine({
  storageDir: process.env.SHAPELEX_STORE_DIR ?? ".shapelex",
  persistent: process.env.SHAPELEX_PERSIST !== "0",
  maxStoreBytes: maxStoreBytesFromEnv(process.env.SHAPELEX_MAX_STORE_MB)
});

const tools = [
  {
    name: "shapelex_compress",
    title: "Compress into navigable ShapeLex memory",
    description: "Compress text, code, or conversation into hierarchical navigable memory with risk assessment.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        mode: { type: "string", enum: ["text", "code", "conversation"] },
        label: { type: "string" },
        text: { type: "string" },
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
        budgetTokens: { type: "number" }
      },
      anyOf: [
        { required: ["text"] },
        { required: ["messages"] }
      ],
      additionalProperties: false
    }
  },
  {
    name: "shapelex_compress_messages",
    description: "Compress conversation messages into compact ShapeLex handles with token-savings estimates.",
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
    description: "Compress text, docs, or pasted content into expandable ShapeLex handles.",
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
    description: "Expand an sx:// handle back to exact original text while the session is alive.",
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
    name: "shapelex_search",
    title: "Search ShapeLex memory",
    description: "Search compressed ShapeLex memory without expanding full text.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        query: { type: "string" },
        mode: { type: "string", enum: ["text", "code", "conversation"] },
        limit: { type: "number" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "shapelex_retrieve",
    title: "Retrieve ShapeLex levels",
    description: "Retrieve navigable ShapeLex levels for a document or expand a span URI.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        uri: { type: "string" },
        level: { type: "number" },
        query: { type: "string" }
      },
      required: ["uri"],
      additionalProperties: false
    }
  },
  {
    name: "shapelex_explain",
    title: "Explain ShapeLex memory",
    description: "Explain how to use a ShapeLex URI, its levels, and risk policy.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        uri: { type: "string" }
      },
      required: ["uri"],
      additionalProperties: false
    }
  },
  {
    name: "shapelex_risk_assessment",
    title: "Assess ShapeLex risk",
    description: "Assess semantic loss, ambiguity, and expansion need for text or an existing ShapeLex URI.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        uri: { type: "string" },
        text: { type: "string" }
      },
      anyOf: [
        { required: ["uri"] },
        { required: ["text"] }
      ],
      additionalProperties: false
    }
  },
  {
    name: "shapelex_stats",
    description: "Return active in-memory ShapeLex session and handle statistics.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "shapelex_memory_overview",
    description: "Explain ShapeLex sessions in plain language and suggest cleanup actions.",
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
    description: "Clear one ShapeLex session or all ephemeral in-memory sessions.",
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
    description: "Preview or remove old ShapeLex sessions by last access time or maximum session count.",
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

  rl.on("line", async (line) => {
    if (!line.trim()) {
      return;
    }

    let request;
    try {
      request = JSON.parse(line);
      const response = await handleJsonRpc(request);
      if (response) {
        output.write(`${JSON.stringify(response)}\n`);
      }
    } catch (error) {
      const id = request?.id ?? null;
      output.write(`${JSON.stringify(errorResponse(id, error))}\n`);
    }
  });
}

export async function handleJsonRpc(request: any): Promise<any> {
  if (request.jsonrpc !== "2.0") {
    return errorResponse(request.id ?? null, new Error("Expected JSON-RPC 2.0 request"));
  }

  if (request.method?.startsWith("notifications/")) {
    return undefined;
  }

  try {
    const result = await dispatch(request.method, request.params ?? {});
    return {
      jsonrpc: "2.0",
      id: request.id,
      result
    };
  } catch (error) {
    return errorResponse(request.id, error);
  }
}

async function dispatch(method: any, params: any): Promise<any> {
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
        instructions: "ShapeLex exposes compressed navigable memory. Use risk assessment before relying on compressed levels and expand sx:// handles for exact wording."
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools };
    case "tools/call":
      return callTool(params);
    case "resources/list":
      return engine.listResources(params);
    case "resources/read":
      return engine.readResource(params);
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

function callTool(params: any): any {
  if (!params || typeof params !== "object") {
    throw new TypeError("tools/call params must be an object");
  }
  const { name, arguments: args = {} } = params;
  if (typeof name !== "string") {
    throw new TypeError("tools/call params.name must be a string");
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new TypeError("tools/call params.arguments must be an object");
  }
  let result;

  switch (name) {
    case "shapelex_compress":
      result = engine.compress(args);
      break;
    case "shapelex_compress_messages":
      result = engine.compressMessages(args);
      break;
    case "shapelex_compress_text":
      result = engine.compressText(args);
      break;
    case "shapelex_expand":
      result = engine.expand(args);
      break;
    case "shapelex_search":
      result = engine.search(args);
      break;
    case "shapelex_retrieve":
      result = engine.retrieve(args);
      break;
    case "shapelex_explain":
      result = engine.explain(args);
      break;
    case "shapelex_risk_assessment":
      result = engine.riskAssessment(args);
      break;
    case "shapelex_stats":
      result = engine.stats(args);
      break;
    case "shapelex_memory_overview":
      result = engine.memoryOverview(args);
      break;
    case "shapelex_clear":
      result = engine.clear(args);
      break;
    case "shapelex_prune":
      result = engine.prune(args);
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
