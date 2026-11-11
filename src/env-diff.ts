import { parse as parseTomlSource } from "smol-toml";

export const FORMATS = ["env", "json", "toml", "ini"] as const;

export type Format = (typeof FORMATS)[number];

export type FlatMap = Record<string, string>;

export type DiffKind = "left_only" | "right_only" | "changed";

export type DiffEntry = {
  kind: DiffKind;
  key: string;
  left?: string;
  right?: string;
};

export const COMPARE_MODES = ["diff", "template"] as const;

export type CompareMode = (typeof COMPARE_MODES)[number];

export type CompareOptions = {
  trimValues: boolean;
};

export const REDACTED = "[REDACTED]";

const SECRET_KEY_RE = /password|secret|token|key|api_key|passwd|pwd|passw/i;
const SECRET_KEY_CONN_RE = /dsn|database_url|connection_string|jdbc/i;
const JWT_RE = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/;
const URL_CREDENTIALS_RE = /:\/\/[^/:\s]+:[^@\s]+@/;
const CONN_PASSWORD_RE = /(?:^|[;\s&?,])(?:password|pwd)\s*=\s*[^;&\s]/i;
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const PATH_RE = /^(?:\.{0,2}\/|[A-Za-z]:[\\/])/;
const HEX_RE = /^[0-9a-f]+$/i;
const ENTROPY_MIN_LENGTH = 20;
const ENTROPY_MIN_BITS = 4.0;
const HEX_MIN_LENGTH = 40;

export class ParseError extends Error {
  readonly line?: number;

  constructor(message: string, line?: number) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = "ParseError";
    this.line = line;
  }
}

export function isFormat(value: string): value is Format {
  return (FORMATS as readonly string[]).includes(value);
}

export function isCompareMode(value: string): value is CompareMode {
  return (COMPARE_MODES as readonly string[]).includes(value);
}

function emptyMap(): FlatMap {
  return Object.create(null) as FlatMap;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function splitLines(text: string): string[] {
  return stripBom(text).split(/\r\n|\r|\n/);
}

const ENV_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  '"': '"',
  "\\": "\\",
};

function readDoubleQuoted(
  lines: string[],
  start: number,
  from: number,
): { value: string; end: number; pos: number } {
  let out = "";
  let i = start;
  let pos = from;
  for (;;) {
    const line = lines[i] ?? "";
    while (pos < line.length) {
      const ch = line[pos]!;
      if (ch === "\\" && pos + 1 < line.length) {
        const next = line[pos + 1]!;
        out += ENV_ESCAPES[next] ?? `\\${next}`;
        pos += 2;
        continue;
      }
      if (ch === '"') return { value: out, end: i, pos: pos + 1 };
      out += ch;
      pos += 1;
    }
    i += 1;
    if (i >= lines.length) throw new ParseError("unterminated double quote", start + 1);
    out += "\n";
    pos = 0;
  }
}

function readSingleQuoted(
  lines: string[],
  start: number,
  from: number,
): { value: string; end: number; pos: number } {
  let out = "";
  let i = start;
  let pos = from;
  for (;;) {
    const line = lines[i] ?? "";
    const close = line.indexOf("'", pos);
    if (close >= 0) return { value: out + line.slice(pos, close), end: i, pos: close + 1 };
    out += line.slice(pos);
    i += 1;
    if (i >= lines.length) throw new ParseError("unterminated single quote", start + 1);
    out += "\n";
    pos = 0;
  }
}

function stripInlineComment(value: string): string {
  const match = /\s#/.exec(value);
  return (match ? value.slice(0, match.index) : value).trim();
}

export type EnvAssignment = {
  key: string;
  value: string;
  start: number;
  end: number;
  head: string;
  quote: "" | '"' | "'";
  trail: string;
};

export function splitTextLines(text: string): string[] {
  return splitLines(text);
}

export function scanEnv(lines: string[]): EnvAssignment[] {
  const out: EnvAssignment[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const source = lines[i]!;
    let line = source.trim();
    if (!line || line.startsWith("#")) continue;
    line = line.replace(/^export\s+/, "");
    const eq = line.indexOf("=");
    const key = (eq < 0 ? line : line.slice(0, eq)).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) {
      throw new ParseError(`invalid key "${key}"`, i + 1);
    }
    if (eq < 0) {
      out.push({ key, value: "", start: i, end: i, head: `${source.trimEnd()}=`, quote: "", trail: "" });
      continue;
    }
    const sourceEq = source.indexOf("=");
    const raw = line.slice(eq + 1).trimStart();
    if (raw.startsWith('"') || raw.startsWith("'")) {
      const quote = raw[0] as '"' | "'";
      const lead = source.indexOf(quote, sourceEq + 1);
      const read =
        quote === '"' ? readDoubleQuoted(lines, i, lead + 1) : readSingleQuoted(lines, i, lead + 1);
      out.push({
        key,
        value: read.value,
        start: i,
        end: read.end,
        head: source.slice(0, lead),
        quote,
        trail: (lines[read.end] ?? "").slice(read.pos),
      });
      i = read.end;
    } else {
      const comment = /\s+#/.exec(raw);
      const valueStart = source.length - source.slice(sourceEq + 1).trimStart().length;
      out.push({
        key,
        value: stripInlineComment(raw),
        start: i,
        end: i,
        head: source.slice(0, valueStart),
        quote: "",
        trail: comment ? raw.slice(comment.index) : "",
      });
    }
  }
  return out;
}

export function parseEnv(text: string): FlatMap {
  const out = emptyMap();
  for (const item of scanEnv(splitLines(text))) out[item.key] = item.value;
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function scalarToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (value === null) return "null";
  return String(value);
}

function flatten(value: unknown, path: string, out: FlatMap): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out[path] = "[]";
      return;
    }
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, out));
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      out[path] = "{}";
      return;
    }
    for (const key of keys) flatten(value[key], path ? `${path}.${key}` : key, out);
    return;
  }
  out[path] = scalarToString(value);
}

function flattenRoot(root: unknown): FlatMap {
  if (!isPlainObject(root) && !Array.isArray(root)) {
    throw new ParseError("root must be an object or array");
  }
  const out = emptyMap();
  if (Array.isArray(root)) {
    root.forEach((item, index) => flatten(item, `[${index}]`, out));
  } else {
    for (const key of Object.keys(root)) flatten(root[key], key, out);
  }
  return out;
}

export function parseJson(text: string): FlatMap {
  let root: unknown;
  try {
    root = JSON.parse(stripBom(text));
  } catch (error) {
    throw new ParseError(error instanceof Error ? error.message : "invalid JSON");
  }
  return flattenRoot(root);
}

export function parseToml(text: string): FlatMap {
  let root: unknown;
  try {
    root = parseTomlSource(stripBom(text));
  } catch (error) {
    const line = (error as { line?: number }).line;
    const message = error instanceof Error ? error.message.split("\n")[0]! : "invalid TOML";
    throw new ParseError(message, typeof line === "number" ? line : undefined);
  }
  return flattenRoot(root);
}

export function parseIni(text: string): FlatMap {
  const lines = splitLines(text);
  const out = emptyMap();
  let section = "";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[")) {
      const close = line.indexOf("]");
      if (close < 0) throw new ParseError("unterminated section header", i + 1);
      section = line.slice(1, close).trim();
      continue;
    }
    const match = /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(line);
    const key = (match ? match[1]! : line).trim();
    if (!key) throw new ParseError("empty key", i + 1);
    let value = match ? match[2]!.trim() : "";
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0]!;
      const close = value.indexOf(quote, 1);
      value = close > 0 ? value.slice(1, close) : value;
    } else {
      value = stripInlineComment(value).replace(/\s;.*$/, "").trim();
    }
    out[section ? `${section}.${key}` : key] = value;
  }
  return out;
}

export function parseFormat(format: Format, text: string): FlatMap {
  switch (format) {
    case "env":
      return parseEnv(text);
    case "json":
      return parseJson(text);
    case "toml":
      return parseToml(text);
    case "ini":
      return parseIni(text);
  }
}

export function compareMaps(left: FlatMap, right: FlatMap): DiffEntry[] {
  const keys = new Set<string>([...Object.keys(left), ...Object.keys(right)]);
  const out: DiffEntry[] = [];
  for (const key of [...keys].sort()) {
    const inLeft = key in left;
    const inRight = key in right;
    if (inLeft && !inRight) out.push({ kind: "left_only", key, left: left[key] });
    else if (!inLeft && inRight) out.push({ kind: "right_only", key, right: right[key] });
    else if (left[key] !== right[key]) {
      out.push({ kind: "changed", key, left: left[key], right: right[key] });
    }
  }
  return out;
}

export function normalizeMap(map: FlatMap, options: CompareOptions): FlatMap {
  const out = emptyMap();
  for (const key of Object.keys(map)) {
    out[key] = options.trimValues ? map[key]!.trim() : map[key]!;
  }
  return out;
}

export function parseIgnoreKeys(text: string): string[] {
  const keys = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return [...new Set(keys)];
}

export function filterIgnored(map: FlatMap, ignoreKeys: string[]): FlatMap;
export function filterIgnored(entries: DiffEntry[], ignoreKeys: string[]): DiffEntry[];
export function filterIgnored(
  source: FlatMap | DiffEntry[],
  ignoreKeys: string[],
): FlatMap | DiffEntry[] {
  const ignored = new Set(ignoreKeys);
  if (Array.isArray(source)) return source.filter((entry) => !ignored.has(entry.key));
  const out = emptyMap();
  for (const key of Object.keys(source)) {
    if (!ignored.has(key)) out[key] = source[key]!;
  }
  return out;
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key) || SECRET_KEY_CONN_RE.test(key);
}

export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const length = [...value].length;
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function charClasses(value: string): number {
  let classes = 0;
  if (/[a-z]/.test(value)) classes += 1;
  if (/[A-Z]/.test(value)) classes += 1;
  if (/\d/.test(value)) classes += 1;
  if (/[^A-Za-z0-9]/.test(value)) classes += 1;
  return classes;
}

export function isHighEntropyValue(value: string): boolean {
  const text = value.trim();
  if (text.length < ENTROPY_MIN_LENGTH || /\s/.test(text)) return false;
  if (URL_RE.test(text) || PATH_RE.test(text)) return false;
  if (HEX_RE.test(text)) return text.length >= HEX_MIN_LENGTH;
  if (charClasses(text) < 2) return false;
  return shannonEntropy(text) >= ENTROPY_MIN_BITS;
}

export function isSecretValue(value: string): boolean {
  return (
    JWT_RE.test(value) ||
    URL_CREDENTIALS_RE.test(value) ||
    CONN_PASSWORD_RE.test(value) ||
    isHighEntropyValue(value)
  );
}

export function maskEntry(entry: DiffEntry): DiffEntry {
  const secret =
    isSecretKey(entry.key) ||
    (entry.left !== undefined && isSecretValue(entry.left)) ||
    (entry.right !== undefined && isSecretValue(entry.right));
  if (!secret) return entry;
  return {
    ...entry,
    left: entry.left === undefined ? undefined : REDACTED,
    right: entry.right === undefined ? undefined : REDACTED,
  };
}

export const EXAMPLES: Record<Format, { left: string; right: string }> = {
  env: {
    left: `# app
APP_ENV=production
DB_HOST=db.internal
DB_PORT=5432
DB_PASSWORD=s3cret-old
API_TOKEN="abc123"
LOG_LEVEL=info
`,
    right: `# app
export APP_ENV=staging
DB_HOST=db.internal
DB_PORT=5433
DB_PASSWORD=s3cret-new
API_TOKEN="abc123"
CACHE_TTL=300
`,
  },
  json: {
    left: `{
  "name": "shop",
  "db": { "host": "db.internal", "port": 5432, "password": "old" },
  "features": ["cart", "search"],
  "debug": false
}
`,
    right: `{
  "name": "shop",
  "db": { "host": "db.internal", "port": 5433, "password": "new" },
  "features": ["cart", "search", "chat"],
  "cache": { "ttl": 300 }
}
`,
  },
  toml: {
    left: `title = "shop"

[database]
host = "db.internal"
port = 5432
password = "old"

[server]
workers = 4
`,
    right: `title = "shop"

[database]
host = "db.internal"
port = 5433
password = "new"

[cache]
ttl = 300
`,
  },
  ini: {
    left: `[app]
env = production
debug = false

[database]
host = db.internal
port = 5432
password = old
`,
    right: `[app]
env = staging
debug = false

[database]
host = db.internal
port = 5433
password = new

[cache]
ttl = 300
`,
  },
};

export const TEMPLATE_EXAMPLES: Record<Format, { left: string; right: string }> = {
  env: {
    left: `# .env.example
APP_ENV=
DB_HOST=localhost
DB_PORT=5432
DB_PASSWORD=change-me
API_TOKEN=
SENTRY_DSN=
LOG_LEVEL=info
`,
    right: `APP_ENV=production
DB_HOST=db.internal
DB_PORT=5432
DB_PASSWORD=Zx9fQ2mTb7LpW4vK
API_TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJl
DATABASE_URL=postgres://app:hunter2@db.internal:5432/shop
LOG_LEVEL=debug
`,
  },
  json: {
    left: `{
  "name": "",
  "db": { "host": "localhost", "port": 5432, "password": "change-me" },
  "features": [],
  "sentryDsn": ""
}
`,
    right: `{
  "name": "shop",
  "db": { "host": "db.internal", "port": 5432, "password": "Zx9fQ2mTb7LpW4vK" },
  "features": [],
  "cache": { "ttl": 300 }
}
`,
  },
  toml: {
    left: `title = ""

[database]
host = "localhost"
port = 5432
password = "change-me"

[server]
workers = 2
`,
    right: `title = "shop"

[database]
host = "db.internal"
port = 5432
password = "Zx9fQ2mTb7LpW4vK"

[cache]
ttl = 300
`,
  },
  ini: {
    left: `[app]
env =
debug = false

[database]
host = localhost
port = 5432
password = change-me
`,
    right: `[app]
env = production
debug = false

[database]
host = db.internal
port = 5432
password = Zx9fQ2mTb7LpW4vK

[cache]
ttl = 300
`,
  },
};
