import { test } from "node:test";
import assert from "node:assert/strict";
import { freshFlex, instantiate, Unifier } from "../src/core/unify.ts";
import { tBool, tCon, tFun, tInt, tVar, tyToString } from "../src/core/types.ts";
import { StrandTypeError } from "../src/errors.ts";

test("unifies a flex var with a concrete type", () => {
  const u = new Unifier();
  const f = freshFlex();
  u.unify(f, tInt);
  assert.equal(tyToString(u.zonk(f)), "Int");
});

test("unifies List a with List Int, solving the variable", () => {
  const u = new Unifier();
  const a = instantiate(tCon("List", [tVar("a")]));
  u.unify(a, tCon("List", [tInt]));
  assert.equal(tyToString(u.zonk(a)), "List Int");
});

test("rejects unifying Int with Bool", () => {
  const u = new Unifier();
  assert.throws(() => u.unify(tInt, tBool), StrandTypeError);
});

test("rejects unifying constructors of different arity/name", () => {
  const u = new Unifier();
  assert.throws(() => u.unify(tCon("List", [tInt]), tCon("Option", [tInt])), StrandTypeError);
});

test("occurs check rejects infinite types", () => {
  const u = new Unifier();
  const f = freshFlex();
  assert.throws(() => u.unify(f, tFun(f, tInt)), StrandTypeError);
});

test("instantiate replaces rigid vars with fresh flex vars", () => {
  const scheme = tFun(tVar("a"), tVar("a"));
  const inst = instantiate(scheme);
  // a -> a became ?n -> ?n; unifying the argument side fixes the result side
  const u = new Unifier();
  assert.equal(inst.tag, "Fun");
  if (inst.tag !== "Fun") return;
  u.unify(inst.from, tInt);
  assert.equal(tyToString(u.zonk(inst.to)), "Int");
});
