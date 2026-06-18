import { StrandSyntaxError } from "../errors.ts";
import { tBool, tCon, tInt, tText, tFun, tVar, type Ty } from "../core/types.ts";
import type { BinOp } from "../core/term.ts";
import { lex, type Token } from "./lexer.ts";
import type { SurfaceArm, SurfaceDataDecl, SurfaceDef, SurfaceForeign, SurfaceItem, SurfaceParam, SurfaceTerm } from "./ast.ts";

const RESERVED = new Set(["def", "data", "foreign", "if", "then", "else", "match", "let", "in", "fn"]);

const isUpper = (s: string): boolean => /^[A-Z]/.test(s);

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
  private isAnySym(...ss: string[]): boolean {
    const t = this.peek();
    return t.kind === "sym" && ss.includes(t.value);
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

  // --- programs & items ---

  parseProgram(): SurfaceItem[] {
    const items: SurfaceItem[] = [];
    while (!this.atEof()) {
      if (this.isKw("data")) items.push(this.parseData());
      else if (this.isKw("foreign")) items.push(this.parseForeign());
      else items.push(this.parseDef());
    }
    return items;
  }

  private parseForeign(): SurfaceForeign {
    this.eatKw("foreign");
    const name = this.eatIdent();
    const params: SurfaceParam[] = [];
    while (this.isSym("(")) params.push(this.parseParam());
    this.eatSym("->");
    const ret = this.parseType();
    this.eatSym("=");
    const t = this.next();
    if (t.kind !== "text") throw new StrandSyntaxError("foreign body must be a string of TypeScript", t.pos);
    return { kind: "foreign", name, params, ret, code: t.value };
  }

  private parseDef(): SurfaceDef {
    this.eatKw("def");
    const name = this.eatIdent();
    const params: SurfaceParam[] = [];
    while (this.isSym("(")) params.push(this.parseParam());
    this.eatSym("->");
    const ret = this.parseType();
    this.eatSym("=");
    return { kind: "def", name, params, ret, body: this.parseExpr() };
  }

  private parseParam(): SurfaceParam {
    this.eatSym("(");
    const name = this.eatIdent();
    this.eatSym(":");
    const ty = this.parseType();
    this.eatSym(")");
    return { name, ty };
  }

  private parseData(): SurfaceDataDecl {
    this.eatKw("data");
    const name = this.eatIdent();
    const params: string[] = [];
    while (this.peek().kind === "ident" && !RESERVED.has(this.peek().value)) params.push(this.eatIdent());
    this.eatSym("=");
    const ctors = [this.parseCtor()];
    while (this.isSym("|")) {
      this.next();
      ctors.push(this.parseCtor());
    }
    return { kind: "data", name, params, ctors };
  }

  private parseCtor(): { name: string; fields: Ty[] } {
    const name = this.eatIdent();
    const fields: Ty[] = [];
    while (this.canStartAtomicType()) fields.push(this.parseAtomicType());
    return { name, fields };
  }

  // --- types ---

  parseType(): Ty {
    const head = this.parseTypeApp();
    if (this.isSym("->")) {
      this.next();
      return tFun(head, this.parseType());
    }
    return head;
  }

  private parseTypeApp(): Ty {
    const head = this.parseAtomicType();
    const args: Ty[] = [];
    while (this.canStartAtomicType()) args.push(this.parseAtomicType());
    if (args.length === 0) return head;
    if (head.tag !== "Con" || head.args.length > 0) {
      throw new StrandSyntaxError(`only a type constructor can be applied to arguments`, this.peek().pos);
    }
    return tCon(head.name, args);
  }

  private canStartAtomicType(): boolean {
    const t = this.peek();
    if (t.kind === "ident") return !RESERVED.has(t.value);
    return t.kind === "sym" && t.value === "(";
  }

  private parseAtomicType(): Ty {
    const t = this.peek();
    if (t.kind === "ident") {
      this.next();
      if (t.value === "Int") return tInt;
      if (t.value === "Bool") return tBool;
      if (t.value === "Text") return tText;
      return isUpper(t.value) ? tCon(t.value, []) : tVar(t.value);
    }
    if (t.kind === "sym" && t.value === "(") {
      this.next();
      const ty = this.parseType();
      this.eatSym(")");
      return ty;
    }
    throw new StrandSyntaxError(`expected a type, got '${t.value || t.kind}'`, t.pos);
  }

  // --- expressions ---
  // precedence: if/match/let/fn > || > && > cmp > +/-/++ > * / % > application > atom

  parseExpr(): SurfaceTerm {
    if (this.isKw("if")) {
      this.next();
      const cond = this.parseExpr();
      this.eatKw("then");
      const then = this.parseExpr();
      this.eatKw("else");
      return { tag: "If", cond, then, else: this.parseExpr() };
    }
    if (this.isKw("match")) return this.parseMatch();
    if (this.isKw("let")) return this.parseLet();
    if (this.isKw("fn")) return this.parseLam();
    return this.parseOr();
  }

  private parseLet(): SurfaceTerm {
    this.eatKw("let");
    const name = this.eatIdent();
    this.eatSym("=");
    const value = this.parseExpr();
    this.eatKw("in");
    return { tag: "Let", name, value, body: this.parseExpr() };
  }

  private parseLam(): SurfaceTerm {
    this.eatKw("fn");
    const params: SurfaceParam[] = [];
    while (this.isSym("(")) params.push(this.parseParam());
    if (params.length === 0) throw new StrandSyntaxError("fn needs at least one parameter", this.peek().pos);
    this.eatSym("->");
    let body = this.parseExpr();
    for (let i = params.length - 1; i >= 0; i--) {
      body = { tag: "Lam", param: params[i].name, paramTy: params[i].ty, body };
    }
    return body;
  }

  private parseMatch(): SurfaceTerm {
    this.eatKw("match");
    const scrutinee = this.parseExpr();
    this.eatSym("{");
    const arms: SurfaceArm[] = [this.parseArm()];
    while (this.isSym("|")) {
      this.next();
      arms.push(this.parseArm());
    }
    this.eatSym("}");
    return { tag: "Match", scrutinee, arms };
  }

  private parseArm(): SurfaceArm {
    const ctor = this.eatIdent();
    const vars: string[] = [];
    while (this.peek().kind === "ident" && !RESERVED.has(this.peek().value)) vars.push(this.eatIdent());
    this.eatSym("->");
    return { ctor, vars, body: this.parseExpr() };
  }

  private parseOr(): SurfaceTerm {
    let left = this.parseAnd();
    while (this.isSym("||")) {
      this.next();
      left = { tag: "BinOp", op: "||", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): SurfaceTerm {
    let left = this.parseCmp();
    while (this.isSym("&&")) {
      this.next();
      left = { tag: "BinOp", op: "&&", left, right: this.parseCmp() };
    }
    return left;
  }

  private parseCmp(): SurfaceTerm {
    const left = this.parseAdd();
    if (this.isAnySym("==", "<", ">", "<=", ">=")) {
      const op = this.next().value as BinOp;
      return { tag: "BinOp", op, left, right: this.parseAdd() };
    }
    return left;
  }

  private parseAdd(): SurfaceTerm {
    let left = this.parseMul();
    while (this.isAnySym("+", "-", "++")) {
      const op = this.next().value as BinOp;
      left = { tag: "BinOp", op, left, right: this.parseMul() };
    }
    return left;
  }

  private parseMul(): SurfaceTerm {
    let left = this.parseUnary();
    while (this.isAnySym("*", "/", "%")) {
      const op = this.next().value as BinOp;
      left = { tag: "BinOp", op, left, right: this.parseUnary() };
    }
    return left;
  }

  // prefix minus: `-e` desugars to `0 - e`
  private parseUnary(): SurfaceTerm {
    if (this.isSym("-")) {
      this.next();
      return { tag: "BinOp", op: "-", left: { tag: "IntLit", value: 0 }, right: this.parseUnary() };
    }
    return this.parseApp();
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

export function parseProgram(src: string): SurfaceItem[] {
  return new Parser(lex(src)).parseProgram();
}

export function parseExpr(src: string): SurfaceTerm {
  const p = new Parser(lex(src));
  const e = p.parseExpr();
  p.ensureEof();
  return e;
}
