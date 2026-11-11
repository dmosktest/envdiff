import "./style.css";
import {
  EXAMPLES,
  ParseError,
  TEMPLATE_EXAMPLES,
  compareMaps,
  filterIgnored,
  isCompareMode,
  isFormat,
  isSecretKey,
  isSecretValue,
  maskEntry,
  normalizeMap,
  parseFormat,
  parseIgnoreKeys,
  type CompareMode,
  type DiffEntry,
  type DiffKind,
  type FlatMap,
  type Format,
} from "./env-diff";
import { detectLocale, t, type MessageKey } from "./i18n";
import { applyKeyChange, buildTemplate } from "./patch";
import { registerServiceWorker } from "./register-sw";
import { buildJsonReport, buildMarkdownReport, type ReportMeta } from "./report";
import type { Locale } from "./site-config";

const APP_VERSION = "1.0.0";
const appVersionEl = document.getElementById("app-version");
if (appVersionEl) appVersionEl.textContent = APP_VERSION;

const FILE_ACCEPT: Record<Format, string> = {
  env: ".env,.txt,text/plain",
  json: ".json,application/json",
  toml: ".toml,text/plain",
  ini: ".ini,.cfg,.conf,.properties,text/plain",
};

const KIND_LABEL: Record<CompareMode, Record<DiffKind, MessageKey>> = {
  diff: {
    left_only: "kindLeftOnly",
    right_only: "kindRightOnly",
    changed: "kindChanged",
  },
  template: {
    left_only: "kindMissing",
    right_only: "kindExtra",
    changed: "kindChanged",
  },
};

const KINDS: DiffKind[] = ["left_only", "right_only", "changed"];

type Side = "left" | "right";

const SIDE_INPUT: Record<Side, string> = { left: "left-input", right: "right-input" };

type KindFilter = "all" | DiffKind;

type CompareMeta = Pick<ReportMeta, "format" | "trimValues" | "ignoreKeys">;

const state: {
  locale: Locale;
  entries: DiffEntry[] | null;
  filter: KindFilter;
  meta: CompareMeta | null;
} = {
  locale: "ru",
  entries: null,
  filter: "all",
  meta: null,
};

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function format(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? "");
}

function currentFormat(): Format {
  const value = byId<HTMLSelectElement>("format").value;
  return isFormat(value) ? value : "env";
}

function currentMode(): CompareMode {
  const value = byId<HTMLSelectElement>("mode").value;
  return isCompareMode(value) ? value : "diff";
}

function kindLabel(kind: DiffKind): string {
  return t(state.locale, KIND_LABEL[currentMode()][kind]);
}

function sideLabelKeys(): { left: MessageKey; right: MessageKey } {
  return currentMode() === "template"
    ? { left: "templateLabel", right: "realLabel" }
    : { left: "leftLabel", right: "rightLabel" };
}

function applyModeLabels(): void {
  const keys = sideLabelKeys();
  byId("left-label").textContent = t(state.locale, keys.left);
  byId("right-label").textContent = t(state.locale, keys.right);
}

function setStatus(message: string): void {
  byId("status").textContent = message;
}

function setError(message: string): void {
  byId("error").textContent = message;
}

function clearMessages(): void {
  setStatus("");
  setError("");
}

function hideResults(): void {
  state.entries = null;
  state.meta = null;
  state.filter = "all";
  byId("results").hidden = true;
  byId("summary").replaceChildren();
  byId("diff-list").replaceChildren();
  byId("no-diff").hidden = true;
}

function valueLine(label: string | null, value: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "diff-side";
  if (label) {
    const name = document.createElement("span");
    name.className = "diff-side-label";
    name.textContent = label;
    row.append(name);
  }
  const text = document.createElement("span");
  text.className = "diff-value";
  text.textContent = value;
  row.append(text);
  return row;
}

function sideLabel(side: Side): string {
  return t(state.locale, sideLabelKeys()[side]);
}

function mergeButton(entry: DiffEntry, target: Side): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "merge-btn";
  const toRight = target === "right";
  const rtl = document.documentElement.dir === "rtl";
  button.textContent = toRight !== rtl ? "→" : "←";
  const title = format(t(state.locale, toRight ? "applyToRight" : "applyToLeft"), {
    side: sideLabel(target),
  });
  button.title = `${title}: ${entry.key}`;
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", () => applyEntry(entry, target));
  return button;
}

function renderEntry(entry: DiffEntry, source: DiffEntry): HTMLLIElement {
  const li = document.createElement("li");
  li.className = `diff diff-${entry.kind}`;

  const head = document.createElement("div");
  head.className = "diff-head";
  const kind = document.createElement("span");
  kind.className = "diff-kind";
  kind.textContent = kindLabel(entry.kind);
  const key = document.createElement("code");
  key.className = "diff-key";
  key.textContent = entry.key;
  head.append(kind, key);

  const actions = document.createElement("div");
  actions.className = "diff-actions";
  if (entry.kind !== "right_only") actions.append(mergeButton(source, "right"));
  if (entry.kind !== "left_only") actions.append(mergeButton(source, "left"));
  head.append(actions);

  const keys = sideLabelKeys();
  const values = document.createElement("div");
  values.className = "diff-values";
  if (entry.kind === "changed") {
    values.append(
      valueLine(t(state.locale, keys.left), entry.left ?? ""),
      valueLine(t(state.locale, keys.right), entry.right ?? ""),
    );
  } else {
    values.append(valueLine(null, (entry.kind === "left_only" ? entry.left : entry.right) ?? ""));
  }

  li.append(head, values);
  return li;
}

function maskedEntries(entries: DiffEntry[]): DiffEntry[] {
  return byId<HTMLInputElement>("mask").checked ? entries.map(maskEntry) : entries;
}

function renderFilters(): void {
  const root = byId("filters");
  root.querySelectorAll("button").forEach((button) => button.remove());
  const options: Array<[KindFilter, string]> = [
    ["all", t(state.locale, "filterAll")],
    ...KINDS.map((kind): [KindFilter, string] => [kind, kindLabel(kind)]),
  ];
  for (const [value, label] of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-btn";
    button.dataset.filter = value;
    button.setAttribute("aria-pressed", String(state.filter === value));
    button.textContent = label;
    button.addEventListener("click", () => {
      state.filter = value;
      renderResults();
    });
    root.append(button);
  }
}

function renderResults(): void {
  const entries = state.entries;
  if (!entries) return;
  const shown = maskedEntries(entries);
  const indexes = entries.flatMap((entry, index) =>
    state.filter === "all" || entry.kind === state.filter ? [index] : [],
  );

  const summary = byId("summary");
  summary.replaceChildren();
  for (const kind of KINDS) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const count = document.createElement("strong");
    count.textContent = String(entries.filter((e) => e.kind === kind).length);
    chip.append(`${kindLabel(kind)}: `, count);
    summary.append(chip);
  }

  renderFilters();
  renderSideTools();
  byId("no-diff").hidden = indexes.length > 0;
  byId("diff-list").replaceChildren(...indexes.map((i) => renderEntry(shown[i]!, entries[i]!)));
  byId("results").hidden = false;
}

function currentIgnoreKeys(): string[] {
  return parseIgnoreKeys(byId<HTMLTextAreaElement>("ignore-keys").value);
}

function syncHash(): void {
  const left = byId<HTMLTextAreaElement>("left-input").value;
  const right = byId<HTMLTextAreaElement>("right-input").value;
  if (!left.trim() && !right.trim()) {
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    return;
  }
  const params = new URLSearchParams();
  params.set("format", currentFormat());
  if (currentMode() !== "diff") params.set("mode", currentMode());
  params.set("left", left);
  params.set("right", right);
  if (byId<HTMLInputElement>("mask").checked) params.set("mask", "1");
  if (!byId<HTMLInputElement>("trim").checked) params.set("trim", "0");
  for (const key of currentIgnoreKeys()) params.append("ignore", key);
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}#${params.toString()}`,
  );
}

function readHash(): void {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return;
  const params = new URLSearchParams(hash);
  const fmt = params.get("format");
  if (fmt && isFormat(fmt)) byId<HTMLSelectElement>("format").value = fmt;
  const mode = params.get("mode");
  byId<HTMLSelectElement>("mode").value = mode && isCompareMode(mode) ? mode : "diff";
  byId<HTMLTextAreaElement>("left-input").value = params.get("left") ?? "";
  byId<HTMLTextAreaElement>("right-input").value = params.get("right") ?? "";
  byId<HTMLInputElement>("mask").checked = params.get("mask") === "1";
  byId<HTMLInputElement>("trim").checked = params.get("trim") !== "0";
  byId<HTMLTextAreaElement>("ignore-keys").value = params.getAll("ignore").join("\n");
}

function runCompare(resetFilter = true): void {
  clearMessages();
  const left = byId<HTMLTextAreaElement>("left-input").value.trim();
  const right = byId<HTMLTextAreaElement>("right-input").value.trim();
  if (!left || !right) {
    hideResults();
    setError(t(state.locale, "needBoth"));
    return;
  }
  const fmt = currentFormat();
  const keys = sideLabelKeys();
  const sides: Array<[MessageKey, string]> = [
    [keys.left, left],
    [keys.right, right],
  ];
  const maps: FlatMap[] = [];
  for (const [label, text] of sides) {
    try {
      maps.push(parseFormat(fmt, text));
    } catch (error) {
      hideResults();
      const detail = error instanceof ParseError ? error.message : String(error);
      setError(
        format(t(state.locale, "parseError"), {
          side: t(state.locale, label),
          format: fmt,
          detail,
        }),
      );
      return;
    }
  }
  const trimValues = byId<HTMLInputElement>("trim").checked;
  const ignoreKeys = currentIgnoreKeys();
  const [leftMap, rightMap] = maps.map((map) =>
    filterIgnored(normalizeMap(map, { trimValues }), ignoreKeys),
  ) as [FlatMap, FlatMap];
  state.entries = compareMaps(leftMap, rightMap);
  state.meta = { format: fmt, trimValues, ignoreKeys };
  if (resetFilter) state.filter = "all";
  renderResults();
  syncHash();
}

function textarea(side: Side): HTMLTextAreaElement {
  return byId<HTMLTextAreaElement>(SIDE_INPUT[side]);
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function applyEntry(entry: DiffEntry, target: Side): void {
  const value = target === "right" ? entry.left : entry.right;
  if (value === undefined) return;
  const area = textarea(target);
  try {
    area.value = applyKeyChange(currentFormat(), area.value, {
      action: "set",
      key: entry.key,
      value,
    });
  } catch (error) {
    clearMessages();
    setError(
      format(t(state.locale, "patchError"), {
        side: sideLabel(target),
        detail: errorDetail(error),
      }),
    );
    return;
  }
  runCompare(false);
  if (state.entries) {
    setStatus(
      format(t(state.locale, "mergeApplied"), { key: entry.key, side: sideLabel(target) }),
    );
  }
}

function downloadName(side: Side): string {
  const fmt = currentFormat();
  const template = currentMode() === "template";
  if (fmt === "env") return template && side === "left" ? ".env.example" : ".env";
  if (template) return side === "left" ? `template.${fmt}` : `config.${fmt}`;
  return `${side}.${fmt}`;
}

function saveFile(name: string, body: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadSide(side: Side): void {
  const text = textarea(side).value;
  if (!text.trim()) return;
  const name = downloadName(side);
  saveFile(name, text, "text/plain;charset=utf-8");
  clearMessages();
  setStatus(format(t(state.locale, "downloadDone"), { name }));
}

function makeTemplateFrom(side: Side): void {
  const from = sideLabel(side);
  let template: string;
  try {
    template = buildTemplate(currentFormat(), textarea(side).value);
  } catch (error) {
    clearMessages();
    setError(format(t(state.locale, "patchError"), { side: from, detail: errorDetail(error) }));
    return;
  }
  textarea("left").value = template;
  if (currentMode() !== "template") {
    byId<HTMLSelectElement>("mode").value = "template";
    applyModeLabels();
  }
  runCompare(false);
  if (state.entries) setStatus(format(t(state.locale, "makeTemplateDone"), { side: from }));
}

function sideToolButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-small";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderSideTools(): void {
  const sides: Side[] = ["left", "right"];
  const downloads = sides.map((side) =>
    sideToolButton(
      format(t(state.locale, side === "left" ? "downloadLeft" : "downloadRight"), {
        side: sideLabel(side),
      }),
      () => downloadSide(side),
    ),
  );
  const templates = sides.map((side) =>
    sideToolButton(
      format(t(state.locale, "makeTemplate"), { side: sideLabel(side) }),
      () => makeTemplateFrom(side),
    ),
  );
  byId("side-tools").replaceChildren(...downloads, ...templates);
}

function recompare(): void {
  if (state.entries) runCompare(false);
  else if (window.location.hash) syncHash();
}

function applyAccept(): void {
  const accept = FILE_ACCEPT[currentFormat()];
  byId<HTMLInputElement>("left-file").accept = accept;
  byId<HTMLInputElement>("right-file").accept = accept;
}

async function loadFile(input: HTMLInputElement, target: HTMLTextAreaElement): Promise<void> {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    target.value = await file.text();
    hideResults();
    clearMessages();
  } catch {
    setError(t(state.locale, "fileError"));
  }
}

function textLooksSecret(): boolean {
  for (const side of ["left", "right"] as const) {
    try {
      const map = parseFormat(currentFormat(), textarea(side).value);
      for (const key of Object.keys(map)) {
        if (isSecretKey(key) || isSecretValue(map[key]!)) return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function shareLink(): Promise<void> {
  if (
    !byId<HTMLInputElement>("mask").checked &&
    textLooksSecret() &&
    !window.confirm(t(state.locale, "shareSecretWarn"))
  ) {
    return;
  }
  clearMessages();
  syncHash();
  try {
    await navigator.clipboard.writeText(window.location.href);
    setStatus(t(state.locale, "shareCopied"));
  } catch {
    setError(t(state.locale, "copyError"));
  }
}

function downloadReport(kind: "md" | "json"): void {
  const entries = state.entries;
  const meta = state.meta;
  if (!entries || !meta) return;
  const masked = byId<HTMLInputElement>("mask").checked;
  const reportMeta: ReportMeta = { ...meta, version: APP_VERSION, mode: currentMode(), masked };
  const shown = maskedEntries(entries);
  const body =
    kind === "md" ? buildMarkdownReport(shown, reportMeta) : buildJsonReport(shown, reportMeta);
  const type = kind === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8";
  saveFile(`envdiff-report.${kind}`, body, type);
  clearMessages();
  setStatus(t(state.locale, "exportDone"));
}

function bindLangMenu(): void {
  const langRoot = document.querySelector<HTMLDetailsElement>(".lang");
  if (!langRoot) return;
  document.addEventListener("click", (event) => {
    if (!langRoot.open) return;
    const target = event.target;
    if (target instanceof Node && !langRoot.contains(target)) {
      langRoot.open = false;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && langRoot.open) langRoot.open = false;
  });
}

function bindUi(): void {
  const formatSelect = byId<HTMLSelectElement>("format");
  const modeSelect = byId<HTMLSelectElement>("mode");
  const leftInput = byId<HTMLTextAreaElement>("left-input");
  const rightInput = byId<HTMLTextAreaElement>("right-input");

  formatSelect.addEventListener("change", () => {
    applyAccept();
    hideResults();
    clearMessages();
  });
  modeSelect.addEventListener("change", () => {
    applyModeLabels();
    clearMessages();
    renderResults();
    if (window.location.hash) syncHash();
  });
  for (const input of [leftInput, rightInput]) {
    input.addEventListener("input", () => {
      hideResults();
      setError("");
    });
    input.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        runCompare();
      }
    });
  }
  byId<HTMLInputElement>("left-file").addEventListener("change", (event) => {
    void loadFile(event.target as HTMLInputElement, leftInput);
  });
  byId<HTMLInputElement>("right-file").addEventListener("change", (event) => {
    void loadFile(event.target as HTMLInputElement, rightInput);
  });
  byId<HTMLInputElement>("mask").addEventListener("change", () => {
    renderResults();
    if (window.location.hash) syncHash();
  });
  byId<HTMLInputElement>("trim").addEventListener("change", recompare);
  byId<HTMLTextAreaElement>("ignore-keys").addEventListener("input", recompare);
  byId("compare").addEventListener("click", () => runCompare());
  byId("example").addEventListener("click", () => {
    const examples = currentMode() === "template" ? TEMPLATE_EXAMPLES : EXAMPLES;
    const example = examples[currentFormat()];
    leftInput.value = example.left;
    rightInput.value = example.right;
    runCompare();
  });
  byId("share").addEventListener("click", () => {
    void shareLink();
  });
  byId("clear").addEventListener("click", () => {
    leftInput.value = "";
    rightInput.value = "";
    hideResults();
    clearMessages();
    syncHash();
  });
  byId("export-md").addEventListener("click", () => downloadReport("md"));
  byId("export-json").addEventListener("click", () => downloadReport("json"));
}

function boot(): void {
  state.locale = detectLocale();
  readHash();
  applyModeLabels();
  applyAccept();
  bindLangMenu();
  bindUi();
  const hasBoth =
    byId<HTMLTextAreaElement>("left-input").value.trim() &&
    byId<HTMLTextAreaElement>("right-input").value.trim();
  if (hasBoth) runCompare();
  void registerServiceWorker();
}

boot();
