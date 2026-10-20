// Minimal JMESPath subset — no dependencies, so the CLI runs on a fresh install.
//
// Supported: identifier paths (`a.b.c`), array index (`a[0]`, `a[-1]`), bracketed
// key (`a["b"]`), flatten-splat (`a[*]`) with correct projection semantics,
// multi-select hash (`{x: a, y: b.c}`), pipe (`a | b`), identity (`@`), and
// `length()`. Anything else is rejected with a clear message rather than silently
// returning wrong data.

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;
const FUNCTIONS = new Set(["length"]);

function tokenize(expression) {
  const tokens = [];
  let i = 0;
  while (i < expression.length) {
    const rest = expression.slice(i);
    if (/^\s/.test(rest)) {
      i += 1;
      continue;
    }
    const ident = rest.match(IDENT);
    if (ident) {
      tokens.push({ type: "ident", value: ident[0] });
      i += ident[0].length;
      continue;
    }
    const quoted = rest.match(/^"((?:[^"\\]|\\.)*)"/);
    if (quoted) {
      tokens.push({ type: "ident", value: quoted[1].replace(/\\(.)/g, "$1") });
      i += quoted[0].length;
      continue;
    }
    const number = rest.match(/^-?\d+/);
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    if (".[]{}:,*@|()".includes(rest[0])) {
      tokens.push({ type: rest[0] });
      i += 1;
      continue;
    }
    throw new Error(`Unsupported character in projection: '${rest[0]}'`);
  }
  return tokens;
}

// A bare name is a field lookup except at the root of an expression, where it may
// be a function name instead. Inside a hash the name is always a field, so
// `obj.{n: length}` reads the field called `length`.
const inNameMode = (node) => (node.type === "field" ? { ...node, namePosition: true } : node);

class Parser {
  constructor(expression) {
    this.tokens = tokenize(expression);
    this.pos = 0;
  }

  peek() {
    return this.tokens[this.pos];
  }

  eat(type) {
    const token = this.peek();
    if (token && token.type === type) {
      this.pos += 1;
      return token;
    }
    return null;
  }

  expect(type, what) {
    const token = this.eat(type);
    if (!token) {
      throw new Error(`Invalid projection: expected ${what}`);
    }
    return token;
  }

  parse() {
    const node = this.parsePipe();
    if (this.pos < this.tokens.length) {
      throw new Error("Invalid projection: unexpected trailing input");
    }
    return node;
  }

  parsePipe() {
    let left = this.parsePath();
    while (this.eat("|")) {
      left = { type: "pipe", left, right: this.parsePath() };
    }
    return left;
  }

  parsePath() {
    // A bare name at the root may be a function name, hence `parseTerm`.
    return this.extendPath(this.parseTerm());
  }

  // Continues a path whose first segment is already known, so hash values can
  // share the same segment and projection handling.
  extendPath(root) {
    let segments = root.segments ?? [root];
    let projecting = false;

    for (;;) {
      if (this.eat(".")) {
        if (!this.peek()) {
          throw new Error("Invalid projection: expression ends after '.'");
        }
        const next = this.parseTermNode();
        if (next.type === "splat") {
          if (projecting) {
            throw new Error("Invalid projection: nested [*] is not supported");
          }
          // The splat terminates the root; the rest of the path is projected onto
          // each element, so nothing is appended for the splat itself.
          projecting = true;
        } else {
          segments = segments.concat(next.segments ?? [next]);
        }
        continue;
      }
      if (this.peek()?.type === "[") {
        if (projecting) {
          // Inside a projection only a further `[*]` would be valid, which the
          // branch above rejects. Anything else ([0], ["k"]) is out of scope.
          throw new Error(
            "Invalid projection: only [*] may follow a splat; put indexes and filters before it",
          );
        }
        const next = this.parseBracket();
        if (next.type === "splat") {
          if (projecting) {
            throw new Error("Invalid projection: nested [*] is not supported");
          }
          projecting = true;
        } else {
          segments.push(next);
        }
        continue;
      }
      break;
    }

    return projecting
      ? { type: "projection", root: segments[0], segments: segments.slice(1) }
      : segments.length === 1
        ? segments[0]
        : { type: "walk", segments };
  }

  parseTerm() {
    // The leading name of a path is in name position (see `inNameMode`).
    return inNameMode(this.parseTermNode());
  }

  parseTermNode() {
    if (this.eat("@")) {
      return { type: "identity" };
    }
    if (this.peek()?.type === "{") {
      return this.parseHash();
    }    const ident = this.eat("ident");
    if (ident) {
      if (this.eat("(")) {
        return this.parseFunction(ident.value);
      }
      // A bare name, not a call. `inNameMode` tags it when position applies.
      return { type: "field", name: ident.value };
    }    if (this.peek()?.type === "[") {
      return this.parseBracket();
    }
    throw new Error(
      `Invalid projection: unexpected ${this.peek()?.type ?? "end of expression"}`,
    );
  }

  parseFunction(name) {
    if (!FUNCTIONS.has(name)) {
      throw new Error(`Unsupported projection function: ${name}()`);
    }
    const args = [];
    if (!this.eat(")")) {
      do {
        args.push(this.parsePipe());
      } while (this.eat(","));
      this.expect(")", "')'");
    }
    return { type: "function", name, args };
  }

  // A hash value whose name is a plain field: `obj.{n: length}` reads the field
  // called `length`, unlike a bare `length` at the root of a path.
  parseHashValue() {
    const ident = this.eat("ident");
    if (!ident) {
      return this.parsePipe();
    }
    return this.extendPath({ type: "field", name: ident.value });
  }

  parseBracket() {
    this.expect("[", "'['");
    if (this.eat("*")) {
      this.expect("]", "']'");
      return { type: "splat" };
    }
    const number = this.eat("number");
    if (number) {
      this.expect("]", "']'");
      return { type: "index", index: number.value };
    }
    const key = this.eat("ident");
    if (key) {
      this.expect("]", "']'");
      return { type: "key", name: key.value };
    }
    throw new Error("Invalid projection: only [n], [*] and [key] are supported");
  }

  parseHash() {
    this.expect("{", "'{'");
    const entries = [];
    if (!this.eat("}")) {
      do {
        const key = this.eat("ident");
        if (!key) {
          throw new Error("Invalid projection: hash key must be a name");
        }
        this.expect(":", "':' after hash key");
        // A hash value is always a field lookup, never a bare function name.
        entries.push([key.value, this.parseHashValue()]);
      } while (this.eat(","));
      this.expect("}", "'}'");
    }
    if (entries.length === 0) {
      throw new Error("Invalid projection: empty hash is not supported");
    }
    return { type: "hash", entries };
  }
}

const nullish = (value) => value === undefined || value === null;

// Field access only reads plain objects: arrays yield null, so `list.length`
// cannot leak the built-in array length.
const isProjection = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function runSegment(segment, value) {
  switch (segment.type) {
    case "identity":
      return value;
    case "field":
    case "key": {
      if (!isProjection(value)) {
        return null;
      }
      // A bare function name at the root is not a field (see `inNameMode`).
      if (segment.namePosition && FUNCTIONS.has(segment.name)) {
        return null;
      }
      return Object.hasOwn(value, segment.name)
        ? value[segment.name] ?? null
        : null;
    }
    case "index": {
      if (!Array.isArray(value)) {
        return null;
      }
      const at = segment.index < 0 ? value.length + segment.index : segment.index;
      return value[at] ?? null;
    }
    case "hash":
      return Object.fromEntries(
        segment.entries.map(([key, node]) => [key, evaluate(node, value)]),
      );
    case "function": {
      const args = segment.args.map((arg) => evaluate(arg, value));
      if (segment.name === "length") {
        if (typeof args[0] === "string") {
          return args[0].length;
        }
        return Array.isArray(args[0]) ? args[0].length : null;
      }
      throw new Error(`Unsupported projection function: ${segment.name}()`);
    }
    default:
      throw new Error(`Unsupported projection segment: ${segment.type}`);
  }
}

function evaluate(node, value) {
  switch (node.type) {
    case "identity":
    case "field":
    case "key":
    case "index":
    case "hash":
    case "function":
      return runSegment(node, value);
    case "pipe":
      return evaluate(node.right, evaluate(node.left, value));
    case "walk": {
      let current = value;
      for (const segment of node.segments) {
        current = runSegment(segment, current);
        if (current === null) {
          return null;
        }
      }
      return current;
    }
    case "projection": {
      const root = runSegment(node.root, value);
      if (!Array.isArray(root)) {
        return null;
      }
      // JMESPath flattens one level after a splat, so `a[*].b` on nested arrays
      // yields a flat list rather than a list of lists.
      const out = [];
      const append = (item) => {
        if (Array.isArray(item)) {
          out.push(...item);
        } else {
          out.push(item);
        }
      };
      for (const item of root) {
        let current = item;
        let dropped = false;
        for (const segment of node.segments) {
          current = runSegment(segment, current);
          // An element whose projection evaluates to null is omitted.
          if (current === null) {
            dropped = true;
            break;
          }
        }
        if (!dropped) {
          append(current);
        }
      }
      return out;
    }
    default:
      throw new Error(`Unsupported projection node: ${node.type}`);
  }
}

export function project(value, expression) {
  if (!expression) {
    return value;
  }
  return evaluate(new Parser(expression).parse(), value);
}
