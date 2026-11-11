import { parse as parseTomlSource, stringify as stringifyToml } from "smol-toml";
import {
  isSecretKey,
  isSecretValue,
  scanEnv,
  splitTextLines,
  type EnvAssignment,
  type Format,
} from "./env-diff";

export type PatchOp = {
  action: "set" | "delete";
  key: string;
  value?: string;
};

export const PLACEHOLDER = "<YOUR_VALUE>";

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

type Token = string | number;
type Container = Record<string | number, unknown>;
type Quote = "" | '"' | "'";

function detectEol(text: string): string {
  if (text.includes("\r\n")) return "\r\n";
  if (text.includes("\n")) return "\n";
  return text.includes("\r") ? "\r" : "\n";
}

function bomOf(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? "\ufeff" : "";
}

function trimTrailingBlank(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim() === "") end -= 1;
  return lines.slice(0, end);
}

function appendBlock(lines: string[], block: string[]): string[] {
  const kept = trimTrailingBlank(lines);
  if (kept.length > 0) kept.push("");
  return [...kept, ...block, ""];
}

function formatEnvValue(value: string, prefer: Quote): string {
  if (prefer === "'" && !value.includes("'")) return `'${value}'`;
  if (prefer === "" && (value === "" || /^[^\s"'\\#]+$/.test(value))) return value;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

function envLine(item: EnvAssignment, value: string, keepQuote: boolean): string {
  return `${item.head}${formatEnvValue(value, keepQuote ? item.quote : "")}${item.trail}`;
}

function replaceEnvItem(lines: string[], item: EnvAssignment, line: string): void {
  lines.splice(item.start, item.end - item.start + 1, line);
}

function applyEnv(text: string, op: PatchOp): string {
  const lines = splitTextLines(text);
  const items = scanEnv(lines);
  const matches = items.filter((item) => item.key === op.key);
  let next = lines;
  if (op.action === "delete") {
    for (const item of [...matches].reverse()) next.splice(item.start, item.end - item.start + 1);
  } else {
    const value = op.value ?? "";
    const last = matches[matches.length - 1];
    if (last) replaceEnvItem(next, last, envLine(last, value, true));
    else next = appendBlock(lines, [`${op.key}=${formatEnvValue(value, "")}`]);
  }
  return bomOf(text) + next.join(detectEol(text));
}

function templateEnv(text: string): string {
  const lines = splitTextLines(text);
  const items = scanEnv(lines);
  for (const item of [...items].reverse()) {
    const secret = isSecretKey(item.key) || isSecretValue(item.value);
    replaceEnvItem(lines, item, envLine(item, secret ? PLACEHOLDER : "", false));
  }
  return bomOf(text) + lines.join(detectEol(text));
}

type IniLine =
  | { type: "header"; name: string }
  | { type: "kv"; section: string; key: string; full: string }
  | null;

const INI_KV_RE = /^(\s*[^=:]+?\s*[=:]\s*)(.*)$/;

function scanIni(lines: string[]): IniLine[] {
  let section = "";
  return lines.map((raw): IniLine => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) return null;
    if (line.startsWith("[")) {
      const close = line.indexOf("]");
      if (close < 0) throw new PatchError("unterminated section header");
      section = line.slice(1, close).trim();
      return { type: "header", name: section };
    }
    const match = /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(line);
    const key = (match ? match[1]! : line).trim();
    return { type: "kv", section, key, full: section ? `${section}.${key}` : key };
  });
}

function splitIniValue(rest: string): { quote: Quote; value: string; trail: string } {
  const first = rest[0];
  if (first === '"' || first === "'") {
    const close = rest.indexOf(first, 1);
    if (close > 0) return { quote: first, value: rest.slice(1, close), trail: rest.slice(close + 1) };
  }
  const comment = /\s+[#;]/.exec(rest);
  const cut = comment ? comment.index : rest.length;
  return { quote: "", value: rest.slice(0, cut).trim(), trail: rest.slice(cut) };
}

function formatIniValue(raw: string, prefer: Quote): string {
  const value = raw.replace(/\r\n|\r|\n/g, " ");
  const needsQuote = value !== value.trim() || /^["']/.test(value) || /\s[#;]/.test(value);
  if (!prefer && !needsQuote) return value;
  const order: Quote[] = prefer === "'" ? ["'", '"'] : ['"', "'"];
  const quote = order.find((q) => !value.includes(q));
  return quote ? `${quote}${value}${quote}` : value;
}

function iniLine(line: string, value: string, keepQuote: boolean): string {
  const match = INI_KV_RE.exec(line);
  if (!match) return `${line.trimEnd()} = ${formatIniValue(value, "")}`;
  const { quote, trail } = splitIniValue(match[2]!);
  return `${match[1]}${formatIniValue(value, keepQuote ? quote : "")}${trail}`;
}

function iniSeparator(lines: string[], info: IniLine[], section: string): string {
  for (let i = 0; i < lines.length; i += 1) {
    const entry = info[i];
    if (entry?.type !== "kv" || entry.section !== section) continue;
    const match = /^\s*[^=:]+?(\s*[=:]\s*)/.exec(lines[i]!);
    if (match) return match[1]!;
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (info[i]?.type !== "kv") continue;
    const match = /^\s*[^=:]+?(\s*[=:]\s*)/.exec(lines[i]!);
    if (match) return match[1]!;
  }
  return " = ";
}

function pickIniSection(key: string, sections: Set<string>): { section: string; name: string } {
  let best = "";
  for (const section of sections) {
    if (section && key.startsWith(`${section}.`) && key.length > section.length + 1) {
      if (section.length > best.length) best = section;
    }
  }
  if (best) return { section: best, name: key.slice(best.length + 1) };
  const dot = key.lastIndexOf(".");
  if (dot > 0 && dot < key.length - 1) {
    return { section: key.slice(0, dot), name: key.slice(dot + 1) };
  }
  return { section: "", name: key };
}

function insertIniKey(lines: string[], info: IniLine[], key: string, value: string): string[] {
  const sections = new Set<string>();
  for (const entry of info) if (entry?.type === "header") sections.add(entry.name);
  const { section, name } = pickIniSection(key, sections);
  const sep = iniSeparator(lines, info, section);
  const newLine = `${name}${sep}${formatIniValue(value, "")}`;

  if (section && !sections.has(section)) {
    return appendBlock(lines, [`[${section}]`, newLine]);
  }

  let from = 0;
  if (section) {
    for (let i = 0; i < lines.length; i += 1) {
      const entry = info[i];
      if (entry?.type === "header" && entry.name === section) from = i + 1;
    }
  }
  let to = lines.length;
  for (let i = from; i < lines.length; i += 1) {
    if (info[i]?.type === "header") {
      to = i;
      break;
    }
  }
  let at = from;
  for (let i = to - 1; i >= from; i -= 1) {
    if (lines[i]!.trim() !== "") {
      at = i + 1;
      break;
    }
  }
  const out = [...lines];
  const hasHeaderAfter = to < lines.length;
  if (!section && hasHeaderAfter && at === from) out.splice(at, 0, newLine, "");
  else out.splice(at, 0, newLine);
  return out;
}

function applyIni(text: string, op: PatchOp): string {
  let lines = splitTextLines(text);
  const info = scanIni(lines);
  const hits: number[] = [];
  info.forEach((entry, index) => {
    if (entry?.type === "kv" && entry.full === op.key) hits.push(index);
  });
  if (op.action === "delete") {
    for (const index of [...hits].reverse()) lines.splice(index, 1);
  } else {
    const value = op.value ?? "";
    const last = hits[hits.length - 1];
    if (last !== undefined) lines[last] = iniLine(lines[last]!, value, true);
    else lines = insertIniKey(lines, info, op.key, value);
  }
  return bomOf(text) + lines.join(detectEol(text));
}

function templateIni(text: string): string {
  const lines = splitTextLines(text);
  const info = scanIni(lines);
  info.forEach((entry, index) => {
    if (entry?.type !== "kv") return;
    const match = INI_KV_RE.exec(lines[index]!);
    const value = match ? splitIniValue(match[2]!).value : "";
    const secret = isSecretKey(entry.full) || isSecretValue(value);
    lines[index] = iniLine(lines[index]!, secret ? PLACEHOLDER : "", false);
  });
  return bomOf(text) + lines.join(detectEol(text));
}

function parsePath(path: string): Token[] {
  const tokens: Token[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  for (let match = re.exec(path); match; match = re.exec(path)) {
    tokens.push(match[1] !== undefined ? match[1] : Number(match[2]));
  }
  if (tokens.length === 0) throw new PatchError(`invalid key "${path}"`);
  return tokens;
}

function isContainer(value: unknown): value is Container {
  return typeof value === "object" && value !== null && !(value instanceof Date);
}

function readPath(root: unknown, tokens: Token[]): unknown {
  let node: unknown = root;
  for (const token of tokens) {
    if (!isContainer(node)) return undefined;
    node = node[token];
  }
  return node;
}

function setPath(root: Container, tokens: Token[], value: unknown): void {
  let node = root;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const next = tokens[i + 1]!;
    let child = node[tokens[i]!];
    if (!isContainer(child)) {
      child = typeof next === "number" ? [] : {};
      node[tokens[i]!] = child;
    }
    node = child as Container;
  }
  node[tokens[tokens.length - 1]!] = value;
}

function deletePath(root: Container, tokens: Token[]): void {
  const parent = readPath(root, tokens.slice(0, -1));
  const last = tokens[tokens.length - 1]!;
  if (!isContainer(parent)) return;
  if (Array.isArray(parent) && typeof last === "number") parent.splice(last, 1);
  else delete parent[last];
}

function inferScalar(value: string, allowNull: boolean): unknown {
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    const num = Number(value);
    if (Number.isFinite(num) && String(num) === value) return num;
    return value;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (allowNull && value === "null") return null;
  if (value === "[]") return [];
  if (value === "{}") return {};
  return value;
}

function typedValue(existing: unknown, value: string, allowNull: boolean): unknown {
  if (typeof existing === "string") return value;
  if (existing instanceof Date) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date;
  }
  return inferScalar(value, allowNull);
}

function applyTree(
  root: Container,
  op: PatchOp,
  allowNull: boolean,
): void {
  const tokens = parsePath(op.key);
  if (op.action === "delete") {
    deletePath(root, tokens);
    return;
  }
  const existing = readPath(root, tokens);
  setPath(root, tokens, typedValue(existing, op.value ?? "", allowNull));
}

function parseTree(format: "json" | "toml", text: string): Container {
  try {
    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const root = format === "json" ? JSON.parse(source) : parseTomlSource(source);
    if (!isContainer(root)) throw new PatchError("root must be an object or array");
    return root;
  } catch (error) {
    if (error instanceof PatchError) throw error;
    const message = error instanceof Error ? error.message.split("\n")[0]! : `invalid ${format}`;
    throw new PatchError(message);
  }
}

function dumpTree(format: "json" | "toml", root: Container, original: string): string {
  if (format === "toml") return stringifyToml(root as Record<string, unknown>);
  const body = JSON.stringify(root, null, 2);
  return /\n\s*$/.test(original) ? `${body}\n` : body;
}

function templateTree(node: unknown, path: string): unknown {
  if (Array.isArray(node)) return node.map((item, index) => templateTree(item, `${path}[${index}]`));
  if (node instanceof Date) return isSecretKey(path) ? PLACEHOLDER : "";
  if (isContainer(node)) {
    const out: Container = {};
    for (const key of Object.keys(node)) {
      out[key] = templateTree(node[key], path ? `${path}.${key}` : key);
    }
    return out;
  }
  const text = node === null ? "null" : String(node);
  return isSecretKey(path) || isSecretValue(text) ? PLACEHOLDER : "";
}

export function applyKeyChange(format: Format, text: string, op: PatchOp): string {
  switch (format) {
    case "env":
      return applyEnv(text, op);
    case "ini":
      return applyIni(text, op);
    case "json":
    case "toml": {
      const root = parseTree(format, text);
      applyTree(root, op, format === "json");
      return dumpTree(format, root, text);
    }
  }
}

export function buildTemplate(format: Format, text: string): string {
  switch (format) {
    case "env":
      return templateEnv(text);
    case "ini":
      return templateIni(text);
    case "json":
    case "toml": {
      const root = parseTree(format, text);
      const out = (Array.isArray(root) ? [] : {}) as Container;
      for (const key of Object.keys(root)) {
        const path = Array.isArray(root) ? `[${key}]` : key;
        out[key] = templateTree(root[key], path);
      }
      return dumpTree(format, out, text);
    }
  }
}
