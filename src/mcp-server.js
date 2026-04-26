import process from "node:process";
import readline from "node:readline";
import { ShapeLexEngine } from "./shapelex.js";

const engine = new ShapeLexEngine();

const tools = [
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
        budgetTokens: { type: "number" }
      },
      required: ["messages"]
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
        mode: { type: "string", enum: ["message", "doc", "code"] }
      },
      required: ["text"]
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
      required: ["handle"]
    }
  },
  {
    name: "shapelex_stats",
    description: "Return active in-memory ShapeLex session and handle statistics.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" }
      }
    }
  },
  {
    name: "shapelex_clear",
    description: "Clear one ShapeLex session or all ephemeral in-memory sessions.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" }
      }
    }
  }
];

export function startMcpServer({ input = process.stdin, output = process.stdout } = {}) {
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

export async function handleJsonRpc(request) {
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

async function dispatch(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params.protocolVersion ?? "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "shapelex-mcp",
          version: "0.1.0"
        }
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools };
    case "tools/call":
      return callTool(params);
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

function callTool(params) {
  const { name, arguments: args = {} } = params;
  let result;

  switch (name) {
    case "shapelex_compress_messages":
      result = engine.compressMessages(args);
      break;
    case "shapelex_compress_text":
      result = engine.compressText(args);
      break;
    case "shapelex_expand":
      result = engine.expand(args);
      break;
    case "shapelex_stats":
      result = engine.stats(args);
      break;
    case "shapelex_clear":
      result = engine.clear(args);
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

function errorResponse(id, error) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error)
    }
  };
}
