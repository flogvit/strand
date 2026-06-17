/** Base for all Strand-level errors, so callers can distinguish a user/program
 *  error from an internal bug. */
export class StrandError extends Error {}

export class StrandSyntaxError extends StrandError {
  constructor(message: string, public pos: number) {
    super(`syntax error: ${message} (at ${pos})`);
    this.name = "StrandSyntaxError";
  }
}

export class StrandResolveError extends StrandError {
  constructor(message: string) {
    super(`resolve error: ${message}`);
    this.name = "StrandResolveError";
  }
}

export class StrandTypeError extends StrandError {
  constructor(message: string) {
    super(`type error: ${message}`);
    this.name = "StrandTypeError";
  }
}

export class StrandEvalError extends StrandError {
  constructor(message: string) {
    super(`eval error: ${message}`);
    this.name = "StrandEvalError";
  }
}
