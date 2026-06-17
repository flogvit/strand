import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDefs } from "../src/ts/extract.ts";

test("extracts functions and consts with their dependencies", () => {
  const defs = extractDefs(
    "export function add(a: number, b: number): number { return a + b; }\n" +
      "export const double = (n: number): number => add(n, n);",
  );
  const byName = new Map(defs.map((d) => [d.name, d]));
  assert.deepEqual([...byName.keys()].sort(), ["add", "double"]);
  assert.deepEqual(byName.get("add")!.deps, []);
  assert.deepEqual(byName.get("double")!.deps, ["add"]);
  assert.equal(byName.get("double")!.kind, "const");
});

test("normalizes formatting so whitespace differences hash-equal", () => {
  const a = extractDefs("export const x = (n: number): number => n+1;")[0];
  const b = extractDefs("export const x = (n: number): number =>    n + 1 ;")[0];
  assert.equal(a.text, b.text);
});

test("property names are not treated as top-level references", () => {
  const defs = extractDefs(
    "export const obj = { add: 1 };\nexport const add = (n: number): number => n;\n" +
      "export const use = (): number => obj.add + add(1);",
  );
  const use = defs.find((d) => d.name === "use")!;
  assert.ok(use.deps.includes("add"));
  assert.ok(use.deps.includes("obj"));
  // the `.add` property access must not double-count as a ref beyond the real `add` call
  assert.equal(use.deps.filter((d) => d === "add").length, 1);
});

test("extracts type aliases", () => {
  const defs = extractDefs("export type Id = number;\nexport const mk = (n: Id): Id => n;");
  assert.ok(defs.some((d) => d.name === "Id" && d.kind === "type"));
});
