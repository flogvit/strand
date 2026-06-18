import { Store } from "./core/store.ts";
import { compileProgram } from "./pipeline.ts";
import { parseProgram } from "./syntax/parser.ts";
import { printProgram } from "./syntax/print.ts";
import { StrandError, StrandSyntaxError } from "./errors.ts";

// A minimal Language Server for Strand over stdio JSON-RPC. It provides
// diagnostics (from the type checker) and whole-document formatting — the two
// pieces that already exist as `strand check` and `strand fmt`.

interface Position {
  line: number;
  character: number;
}

function posToLineChar(text: string, offset: number): Position {
  let line = 0;
  let character = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { line, character };
}

function diagnostics(text: string): unknown[] {
  try {
    compileProgram(text, new Store(), new Map(), []);
    return [];
  } catch (e) {
    if (e instanceof StrandSyntaxError) {
      const start = posToLineChar(text, e.pos);
      return [{ range: { start, end: { line: start.line, character: start.character + 1 } }, severity: 1, source: "strand", message: e.message }];
    }
    if (e instanceof StrandError) {
      // type/resolve errors carry no position yet — report at the top of the file
      return [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, source: "strand", message: e.message }];
    }
    throw e;
  }
}

function send(msg: unknown): void {
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}

function publishDiagnostics(uri: string, text: string): void {
  send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: diagnostics(text) } });
}

const docs = new Map<string, string>();

function handle(msg: { id?: number; method?: string; params?: any }): void {
  switch (msg.method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: { capabilities: { textDocumentSync: 1, documentFormattingProvider: true } },
      });
      return;
    case "initialized":
      return;
    case "textDocument/didOpen": {
      const { uri, text } = msg.params.textDocument;
      docs.set(uri, text);
      publishDiagnostics(uri, text);
      return;
    }
    case "textDocument/didChange": {
      const uri = msg.params.textDocument.uri;
      const text = msg.params.contentChanges[msg.params.contentChanges.length - 1].text;
      docs.set(uri, text);
      publishDiagnostics(uri, text);
      return;
    }
    case "textDocument/formatting": {
      const uri = msg.params.textDocument.uri;
      const text = docs.get(uri) ?? "";
      try {
        const formatted = printProgram(parseProgram(text));
        const lines = text.split("\n");
        const end = { line: lines.length, character: 0 };
        send({ jsonrpc: "2.0", id: msg.id, result: [{ range: { start: { line: 0, character: 0 }, end }, newText: formatted }] });
      } catch {
        send({ jsonrpc: "2.0", id: msg.id, result: [] }); // unparseable -> no edit
      }
      return;
    }
    case "shutdown":
      send({ jsonrpc: "2.0", id: msg.id, result: null });
      return;
    case "exit":
      process.exit(0);
      return;
    default:
      if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, result: null });
  }
}

// Read Content-Length framed JSON-RPC messages from stdin.
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length: (\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    try {
      handle(JSON.parse(body));
    } catch {
      // ignore malformed messages
    }
  }
});
