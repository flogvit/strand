import { test } from "node:test";
import assert from "node:assert/strict";
import { TsStore } from "../src/ts/store.ts";
import { submit, GreenGateError } from "../src/ts/engine.ts";
import { mergeTs } from "../src/ts/merge.ts";
import { assemble } from "../src/ts/assemble.ts";
import { typecheckModule } from "../src/ts/typecheck.ts";
import type { RepoState } from "../src/ts/model.ts";

function state(): RepoState {
  return { store: new TsStore(), namespace: new Map(), pending: [], conflicts: [] };
}

test("a green submission can be merged into the namespace", () => {
  const s = state();
  submit(s, "alice", "adder", "export function add(a: number, b: number): number { return a + b; }");
  const r = mergeTs(s.namespace, s.store, s.pending);
  assert.ok(r.applied.includes("add"));
  assert.equal(r.conflicts.length, 0);
});

test("the green-gate rejects a real type error", () => {
  const s = state();
  assert.throws(() => submit(s, "x", "bad", "export const n: number = true;"), GreenGateError);
});

test("the green-gate rejects a dangling reference", () => {
  const s = state();
  assert.throws(() => submit(s, "x", "bad", "export const y = (): number => missing(1);"), GreenGateError);
});

test("parallel: same name different body parks; independent name merges", () => {
  const s = state();
  submit(s, "a1", "v1", "export const signup = (): number => 1;\nexport const login = (): number => 9;");
  submit(s, "a2", "v2", "export const signup = (): number => 2;");
  const r = mergeTs(s.namespace, s.store, s.pending);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].name, "signup");
  assert.ok(r.applied.includes("login"));
});

test("a dependency must be in the namespace before a dependent can be submitted", () => {
  const s = state();
  // `double` needs `add`, which has not been merged yet -> green-gate rejects it
  assert.throws(
    () => submit(s, "b", "doubler", "export const double = (n: number): number => add(n, n);"),
    GreenGateError,
  );
});

test("whole-namespace gate at merge catches a cross-file break between two green submissions", () => {
  const s = state();
  submit(s, "a", "f", "export function f(): number { return 1; }");
  s.namespace = mergeTs(s.namespace, s.store, s.pending).namespace;
  s.pending = [];
  // both of the next two are green on their own against the base {f: number}...
  submit(s, "b", "g uses f as number", "export const g = (): number => f() + 1;");
  submit(s, "c", "rebind f to string", 'export function f(): string { return "x"; }');
  // ...but together they are red: g now adds 1 to a string and returns it as number
  const r = mergeTs(s.namespace, s.store, s.pending);
  const diags = typecheckModule(assemble(r.namespace, s.store));
  assert.ok(diags.length > 0, "whole-namespace check should flag the cross-file break");
});

test("the merged namespace assembles into a module that type-checks green", () => {
  const s = state();
  submit(s, "a", "adder", "export function add(a: number, b: number): number { return a + b; }");
  // merge `add` so it is in the namespace the next agent works against
  s.namespace = mergeTs(s.namespace, s.store, s.pending).namespace;
  s.pending = [];
  submit(s, "b", "doubler", "export const double = (n: number): number => add(n, n);");
  const r = mergeTs(s.namespace, s.store, s.pending);
  const module = assemble(r.namespace, s.store);
  assert.deepEqual(typecheckModule(module), []);
  assert.ok(module.indexOf("function add") < module.indexOf("double")); // dependency order
});
