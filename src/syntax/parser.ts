import { StrandSyntaxError } from "../errors.ts";
import { tBool, tInt, tText, tFun, type Ty } from "../core/types.ts";
import type { BinOp } from "../core/term.ts";
import { lex, type Token } from "./lexer.ts";
import type { SurfaceDef, SurfaceParam, SurfaceTerm } from "./ast.ts";

// Keywords that may NOT be used as a plain name in an expression — they
// terminate juxtaposition-based application.
const RESERVED = new Set(["def", "if", "then", "else"]);

class Parser {
  private i = 0;
  constructor(private readonly toks: Token[]) {}

  private peek(): Token {
    return this.toks[this.i];
  }
  private next(): Token {
    return this.toks[this.i++];
  }
  private atEof(): boolean {
    return this.peek().kind === "eof";
  }
  private isSym(s: string): boolean {
    const t = this.peek();
    return t.kind === "sym" && t.value === s;
  }
  private isKw(s: string): boolean {
    const t = this.peek();
    return t.kind === "ident" && t.value === s;
  }
  private eatSym(s: string): void {
    const t = this.next();
    if (!(t.kind === "sym" && t.value === s)) {
      throw new StrandSyntaxError(`expected '${s}', got '${t.value || t.kind}'`, t.pos);
    }
  }
  private eatKw(s: string): void {
    const t = this.next();
    if (!(t.kind === "ident" && t.value === s)) {
      throw new StrandSyntaxError(`expected '${s}', got '${t.value || t.kind}'`, t.pos);
    }
  }
  private eatIdent(): string {
    const t = this.next();
    if (t.kind !== "ident") throw new StrandSyntaxError(`expected an identifier, got '${t.value || t.kind}'`, t.pos);
    return t.value;
  }

  // --- programs & definitions ---

  parseProgram(): SurfaceDef[] {
    const defs: SurfaceDef[] = [];
    while (!this.atEof()) defs.push(this.parseDef());
    return defs;
  }

  private parseDef(): SurfaceDef {
    this.eatKw("def");
    const name = this.eatIdent();
    const params: SurfaceParam[] = [];
    while (this.isSym("(")) params.push(this.parseParam());
    this.eatSym("->");
    const ret = this.parseType();
    this.eatSym("=");
    const body = this.parseExpr();
    return { name, params, ret, body };
  }

  private parseParam(): SurfaceParam {
    this.eatSym("(");
    const name = this.eatIdent();
    this.eatSym(":");
    const ty = this.parseType();
    this.eatSym(")");
    return { name, ty };
  }

  // --- types (function arrow is right-associative) ---

  parseType(): Ty {
    const left = this.parseAType();
    if (this.isSym("->")) {
      this.next();
      return tFun(left, this.parseType());
    }
    return left;
  }

  private parseAType(): Ty {
    if (this.isKw("Int")) {
      this.next();
      return tInt;
    }
    if (this.isKw("Bool")) {
      this.next();
      return tBool;
    }
    if (this.isKw("Text")) {
      this.next();
      return tText;
    }
    if (this.isSym("(")) {
      this.next();
      const t = this.parseType();
      this.eatSym(")");
      return t;
    }
    const t = this.peek();
    throw new StrandSyntaxError(`expected a type, got '${t.value || t.kind}'`, t.pos);
  }

  // --- expressions (precedence: if > cmp > +/- > * > application > atom) ---

  parseExpr(): SurfaceTerm {
    if (this.isKw("if")) {
      this.next();
      const cond = this.parseExpr();
      this.eatKw("then");
      const then = this.parseExpr();
      this.eatKw("else");
      const els = this.parseExpr();
      return { tag: "If", cond, then, else: els };
    }
    return this.parseCmp();
  }

  private parseCmp(): SurfaceTerm {
    const left = this.parseAdd();
    if (this.isSym("==") || this.isSym("<") || this.isSym(">")) {
      const op = this.next().value as BinOp;
      return { tag: "BinOp", op, left, right: this.parseAdd() };
    }
    return left;
  }

  private parseAdd(): SurfaceTerm {
    let left = this.parseMul();
    while (this.isSym("+") || this.isSym("-")) {
      const op = this.next().value as BinOp;
      left = { tag: "BinOp", op, left, right: this.parseMul() };
    }
    return left;
  }

  private parseMul(): SurfaceTerm {
    let left = this.parseApp();
    while (this.isSym("*")) {
      const op = this.next().value as BinOp;
      left = { tag: "BinOp", op, left, right: this.parseApp() };
    }
    return left;
  }

  private parseApp(): SurfaceTerm {
    let fn = this.parseAtom();
    while (this.canStartAtom()) fn = { tag: "App", fn, arg: this.parseAtom() };
    return fn;
  }

  private canStartAtom(): boolean {
    const t = this.peek();
    if (t.kind === "int" || t.kind === "text") return true;
    if (t.kind === "ident") return !RESERVED.has(t.value);
    return t.kind === "sym" && t.value === "(";
  }

  private parseAtom(): SurfaceTerm {
    const t = this.peek();
    if (t.kind === "int") {
      this.next();
      return { tag: "IntLit", value: Number(t.value) };
    }
    if (t.kind === "text") {
      this.next();
      return { tag: "TextLit", value: t.value };
    }
    if (t.kind === "ident") {
      if (RESERVED.has(t.value)) throw new StrandSyntaxError(`unexpected keyword '${t.value}'`, t.pos);
      this.next();
      if (t.value === "true") return { tag: "BoolLit", value: true };
      if (t.value === "false") return { tag: "BoolLit", value: false };
      return { tag: "Name", name: t.value };
    }
    if (t.kind === "sym" && t.value === "(") {
      this.next();
      const e = this.parseExpr();
      this.eatSym(")");
      return e;
    }
    throw new StrandSyntaxError(`unexpected '${t.value || t.kind}'`, t.pos);
  }

  ensureEof(): void {
    if (!this.atEof()) {
      const t = this.peek();
      throw new StrandSyntaxError(`unexpected trailing '${t.value || t.kind}'`, t.pos);
    }
  }
}

/** Parse a whole program (zero or more `def`s). */
export function parseProgram(src: string): SurfaceDef[] {
  const p = new Parser(lex(src));
  const defs = p.parseProgram();
  return defs;
}

/** Parse a single expression — used to evaluate ad-hoc queries. */
export function parseExpr(src: string): SurfaceTerm {
  const p = new Parser(lex(src));
  const e = p.parseExpr();
  p.ensureEof();
  return e;
}
