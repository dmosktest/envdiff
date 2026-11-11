import type { CompareMode, DiffEntry, DiffKind, Format } from "./env-diff";

export type ReportMeta = {
  version: string;
  mode: CompareMode;
  format: Format;
  trimValues: boolean;
  ignoreKeys: string[];
  masked: boolean;
};

const KINDS: DiffKind[] = ["left_only", "right_only", "changed"];

const KIND_TITLE: Record<CompareMode, Record<DiffKind, string>> = {
  diff: {
    left_only: "Left only",
    right_only: "Right only",
    changed: "Changed",
  },
  template: {
    left_only: "Missing in real (present in template)",
    right_only: "Extra in real (absent in template)",
    changed: "Changed",
  },
};

function summarize(entries: DiffEntry[]): Record<DiffKind | "total", number> {
  const counts = { left_only: 0, right_only: 0, changed: 0, total: entries.length };
  for (const entry of entries) counts[entry.kind] += 1;
  return counts;
}

function codeSpan(value: string): string {
  const text = value.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  if (text === "") return "(empty)";
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function markdownEntry(entry: DiffEntry): string {
  const key = codeSpan(entry.key);
  if (entry.kind === "changed") {
    return `- ${key}: ${codeSpan(entry.left ?? "")} → ${codeSpan(entry.right ?? "")}`;
  }
  const value = entry.kind === "left_only" ? entry.left : entry.right;
  return `- ${key} = ${codeSpan(value ?? "")}`;
}

export function buildMarkdownReport(entries: DiffEntry[], meta: ReportMeta): string {
  const counts = summarize(entries);
  const lines = [
    "# envdiff report",
    "",
    `- Version: ${meta.version}`,
    `- Mode: ${meta.mode}`,
    `- Format: ${meta.format}`,
    `- Trim values: ${meta.trimValues ? "yes" : "no"}`,
    `- Ignored keys: ${meta.ignoreKeys.length ? meta.ignoreKeys.map(codeSpan).join(", ") : "none"}`,
    `- Secrets masked: ${meta.masked ? "yes" : "no"}`,
    "",
    "## Summary",
    "",
    ...KINDS.map((kind) => `- ${KIND_TITLE[meta.mode][kind]}: ${counts[kind]}`),
    `- Total: ${counts.total}`,
  ];
  if (entries.length === 0) {
    lines.push("", "No differences.");
  }
  for (const kind of KINDS) {
    const group = entries.filter((entry) => entry.kind === kind);
    if (group.length === 0) continue;
    lines.push("", `## ${KIND_TITLE[meta.mode][kind]}`, "", ...group.map(markdownEntry));
  }
  return `${lines.join("\n")}\n`;
}

export function buildJsonReport(entries: DiffEntry[], meta: ReportMeta): string {
  const report = {
    tool: "envdiff",
    version: meta.version,
    mode: meta.mode,
    format: meta.format,
    options: {
      trimValues: meta.trimValues,
      ignoreKeys: meta.ignoreKeys,
      masked: meta.masked,
    },
    summary: summarize(entries),
    entries: entries.map((entry) => ({
      kind: entry.kind,
      key: entry.key,
      ...(entry.left === undefined ? {} : { left: entry.left }),
      ...(entry.right === undefined ? {} : { right: entry.right }),
    })),
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}
