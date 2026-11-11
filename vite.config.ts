import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import {
  localizeIndexHtml,
  renderNotFoundHtml,
  renderRobotsTxt,
  renderSitemapXml,
} from "./src/localize-html";
import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  isRtlLocale,
  localePath,
  type Locale,
} from "./src/site-config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
) as { version: string };

function renderLocaleManifest(locale: Locale): string {
  const rootManifestPath = path.join(rootDir, "public", "manifest.webmanifest");
  const base = JSON.parse(fs.readFileSync(rootManifestPath, "utf8")) as Record<
    string,
    unknown
  >;
  return `${JSON.stringify(
    {
      ...base,
      id: localePath(locale),
      lang: locale,
      dir: isRtlLocale(locale) ? "rtl" : "ltr",
      start_url: localePath(locale),
    },
    null,
    2,
  )}\n`;
}

function emitLocaleManifests(dist: string): void {
  for (const locale of LOCALES) {
    const dir = path.join(dist, locale);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "manifest.webmanifest"),
      renderLocaleManifest(locale),
      "utf8",
    );
  }
}

function collectPrecacheUrls(dist: string): string[] {
  const urls = new Set<string>([
    "/manifest.webmanifest",
    "/icon.png",
    "/icon-192.png",
    "/favicon-32.png",
    "/apple-touch-icon.png",
  ]);

  for (const locale of LOCALES) {
    urls.add(localePath(locale));
    urls.add(`${localePath(locale)}manifest.webmanifest`);
  }

  const walk = (dir: string, prefix: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = `${prefix}/${name}`.replace(/\\/g, "/");
      if (fs.statSync(full).isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (name === "sw.js") continue;
      if (/\.(html|txt|xml)$/i.test(name)) continue;
      urls.add(rel);
    }
  };

  walk(path.join(dist, "assets"), "/assets");
  walk(path.join(dist, "flags"), "/flags");
  return [...urls].sort();
}

function emitServiceWorker(dist: string): void {
  const templatePath = path.join(rootDir, "sw.template.js");
  if (!fs.existsSync(templatePath)) return;
  const precache = collectPrecacheUrls(dist);
  const source = fs
    .readFileSync(templatePath, "utf8")
    .replaceAll("__VERSION__", pkg.version)
    .replaceAll("__DEFAULT_LOCALE__", DEFAULT_LOCALE)
    .replace("__PRECACHE__", JSON.stringify(precache, null, 2))
    .replace("__LOCALES__", JSON.stringify(LOCALES));
  fs.writeFileSync(path.join(dist, "sw.js"), source, "utf8");
}

function stripLangParam(searchParams: URLSearchParams): string {
  searchParams.delete("lang");
  const qs = searchParams.toString();
  return qs ? `?${qs}` : "";
}

function rootRedirectTarget(url: URL): { status: number; location: string } {
  const lang = url.searchParams.get("lang");
  if (lang && isLocale(lang.toLowerCase())) {
    const locale = lang.toLowerCase() as Locale;
    const params = new URLSearchParams(url.searchParams);
    const qs = stripLangParam(params);
    return { status: 301, location: `${localePath(locale)}${qs}` };
  }
  const params = new URLSearchParams(url.searchParams);
  const qs = stripLangParam(params);
  return { status: 302, location: `${localePath(DEFAULT_LOCALE)}${qs}` };
}

function langDevMiddleware(
  setLocale: (locale: Locale) => void,
): (
  req: { url?: string },
  res: {
    statusCode: number;
    setHeader: (k: string, v: string) => void;
    end: (b?: string) => void;
  },
  next: () => void,
) => void {
  return (req, res, next) => {
    if (!req.url) {
      next();
      return;
    }
    const url = new URL(req.url, "http://localhost");
    const { pathname } = url;
    const seg = pathname.split("/").filter(Boolean)[0] ?? "";
    const segLower = seg.toLowerCase();

    if (pathname === "/" || pathname === "/index.html") {
      const target = rootRedirectTarget(url);
      res.statusCode = target.status;
      res.setHeader("Location", target.location);
      res.end();
      return;
    }

    if (seg && seg !== segLower && isLocale(segLower)) {
      const rest = pathname.slice(seg.length + 1);
      res.statusCode = 301;
      res.setHeader("Location", `/${segLower}${rest || "/"}${url.search}`);
      res.end();
      return;
    }

    if (isLocale(segLower) && pathname === `/${segLower}`) {
      res.statusCode = 301;
      res.setHeader("Location", `/${segLower}/${url.search}`);
      res.end();
      return;
    }

    if (isLocale(segLower) && pathname === `/${segLower}/`) {
      setLocale(segLower);
      req.url = `/index.html${url.search}`;
      next();
      return;
    }

    if (/^\/[a-z]{2,3}(\/|$)/i.test(pathname) && !isLocale(segLower)) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(renderNotFoundHtml(DEFAULT_LOCALE));
      return;
    }

    next();
  };
}

function emitLangPages(): Plugin {
  let devLocale: Locale = DEFAULT_LOCALE;

  return {
    name: "emit-lang-pages",
    configureServer(server) {
      server.middlewares.use(
        langDevMiddleware((locale) => {
          devLocale = locale;
        }),
      );
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) {
          next();
          return;
        }
        const url = new URL(req.url, "http://localhost");
        if (url.pathname === "/" || url.pathname === "/index.html") {
          const target = rootRedirectTarget(url);
          res.statusCode = target.status;
          res.setHeader("Location", target.location);
          res.end();
          return;
        }
        const seg = url.pathname.split("/").filter(Boolean)[0] ?? "";
        if (isLocale(seg.toLowerCase()) && url.pathname === `/${seg}`) {
          res.statusCode = 301;
          res.setHeader("Location", `/${seg.toLowerCase()}/${url.search}`);
          res.end();
          return;
        }
        next();
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return localizeIndexHtml(html, devLocale);
      },
    },
    closeBundle() {
      const dist = path.resolve(rootDir, "dist");
      const indexPath = path.join(dist, "index.html");
      if (!fs.existsSync(indexPath)) return;

      const template = fs.readFileSync(indexPath, "utf8");
      for (const locale of LOCALES) {
        const dir = path.join(dist, locale);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, "index.html"),
          localizeIndexHtml(template, locale),
          "utf8",
        );
        fs.writeFileSync(
          path.join(dir, "404.html"),
          renderNotFoundHtml(locale),
          "utf8",
        );
      }

      fs.unlinkSync(indexPath);
      const root404 = path.join(dist, "404.html");
      if (fs.existsSync(root404)) {
        fs.writeFileSync(root404, renderNotFoundHtml(DEFAULT_LOCALE), "utf8");
      }

      fs.writeFileSync(path.join(dist, "sitemap.xml"), renderSitemapXml(), "utf8");
      fs.writeFileSync(path.join(dist, "robots.txt"), renderRobotsTxt(), "utf8");
      emitLocaleManifests(dist);
      emitServiceWorker(dist);
    },
  };
}

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  plugins: [emitLangPages()],
});
