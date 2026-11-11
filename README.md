# envdiff

Logical key/value comparison for `.env`, JSON, TOML, and ini. Two panels (paste text or upload a file) show keys that are left-only, right-only, or have different values; a template mode checks `.env.example` against the real file; interactive merge buttons (→ / ←) patch the panel text directly; either side downloads as a file and can be turned into a template with secrets blanked; reports download as Markdown or JSON. Parsing and comparison run entirely in the browser — no API, nothing is sent to a server.

## Features

- One format for both sides: `env` | `json` | `toml` | `ini` (formats are never mixed)
- Compare by keys, not lines: comments, blank lines, and order are ignored
- Flat keys for `.env` and ini (`section.key`); dotted paths and indexes for nested JSON/TOML (`db.host`, `servers[0]`)
- Results appear only after Compare: left only, right only, changed; filter chips (All / left only / right only / changed) while totals stay in the summary
- Modes: `diff` (two sides, default) and `template` (left = `.env.example` / schema, right = real file): left only = missing in real, right only = extra in real
- Options: trim values (on by default) and an ignore-keys list (one key/path per line, exact match)
- Optional `[REDACTED]` masking by key name (`password|secret|token|key|api_key|passwd|pwd|passw|dsn|database_url|connection_string|jdbc`) and by value (JWT, URLs/DSNs with `user:password@`, connection strings with `password=`/`PWD=`, high-entropy strings, pure hex from length ≥ 40); heuristic, not a guarantee
- Interactive merge on every result card: `left only` → copy into the right panel, `right only` ← copy into the left panel, `changed` → either direction; the textarea source text is edited and the comparison re-runs
- Format-preserving patch (`src/patch.ts`, `applyKeyChange`, best-effort): `.env` and ini lines are edited in place (comments and unrelated lines stay, new keys are appended after a blank line); JSON is re-serialized with 2-space indent (pretty-printed, original formatting is not kept); TOML is re-serialized with `smol-toml` (comments are lost, table order may change)
- Download the left/right (or template/real) panel as a file (`.env` / `.env.example`, `left.json`, `config.json`, …)
- Make a template from a side: values are blanked, secret-like ones become `<YOUR_VALUE>`; the result goes into the left panel and switches to template mode
- Sharing asks for confirmation when masking is off and either side contains secret-like keys or values
- Export the result as Markdown or JSON (`envdiff-report.md` / `.json`), honoring the mask toggle
- Shareable URL `#` fragment (format, mode, both texts, mask, trim, ignored keys); multi-locale UI

Current version: **1.0.0**.

## Scope

Practical helper for everyday DevOps files. Values are compared as text. YAML, mixed-format comparison, multi-environment matrices, a CLI/API, and server-side parsing are out of scope. Parsing, patching, and templates all run in the browser.

## Develop

```bash
npm install
npm run dev
```

```bash
npm run build
```

## License

MIT © dmosk
