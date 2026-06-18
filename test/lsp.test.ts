import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

const SERVER = join(process.cwd(), "src", "lsp.ts");

function frame(msg: unknown): string {
  const j = JSON.stringify(msg);
  return `Content-Length: ${Buffer.byteLength(j, "utf8")}\r\n\r\n${j}`;
}

function session(messages: unknown[], expected: number): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const p = spawn("npx", ["tsx", SERVER]);
    let buf = Buffer.alloc(0);
    const out: any[] = [];
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error(`timed out with ${out.length}/${expected} messages`));
    }, 15000);
    p.stdout.on("data", (c: Buffer) => {
      buf = Buffer.concat([buf, c]);
      for (;;) {
        const he = buf.indexOf("\r\n\r\n");
        if (he < 0) break;
        const m = /Content-Length: (\d+)/i.exec(buf.subarray(0, he).toString());
        if (!m) {
          buf = buf.subarray(he + 4);
          continue;
        }
        const len = Number(m[1]);
        const start = he + 4;
        if (buf.length < start + len) break;
        out.push(JSON.parse(buf.subarray(start, start + len).toString("utf8")));
        buf = buf.subarray(start + len);
        if (out.length >= expected) {
          clearTimeout(timer);
          p.kill();
          resolve(out);
        }
      }
    });
    for (const msg of messages) p.stdin.write(frame(msg));
  });
}

test("LSP: initialize returns capabilities; didOpen publishes a type-error diagnostic", async () => {
  const out = await session(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: "file:///t.strand", text: "def f -> Int = true" } } },
    ],
    2,
  );
  const init = out.find((m) => m.id === 1);
  assert.ok(init.result.capabilities.documentFormattingProvider);
  const diag = out.find((m) => m.method === "textDocument/publishDiagnostics");
  assert.equal(diag.params.diagnostics.length, 1);
  assert.match(diag.params.diagnostics[0].message, /type error/);
});

test("LSP: clean code publishes no diagnostics", async () => {
  const out = await session(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: "file:///ok.strand", text: "def f -> Int = 1" } } },
    ],
    2,
  );
  const diag = out.find((m) => m.method === "textDocument/publishDiagnostics");
  assert.equal(diag.params.diagnostics.length, 0);
});
