import { t } from "./i18n";
import type { MessageKey } from "./i18n-keys";
import { NOT_FOUND_COPY } from "./notfound-messages";
import {
  buildAppJsonLd,
  buildFaqJsonLd,
  getSeoCopy,
  renderSeoHtml,
} from "./seo-content";
import {
  ALLOW_INDEX,
  LOCALES,
  localeFlagHtml,
  LOCALE_NATIVE_NAME,
  ROBOTS_META,
  SITE_ORIGIN,
  X_DEFAULT_LOCALE,
  type Locale,
  isRtlLocale,
  localePath,
  localeUrl,
  ogLocale,
  ogLocaleAlternates,
} from "./site-config";

function replaceTagContent(
  html: string,
  tag: string,
  id: string | null,
  content: string,
): string {
  const idAttr = id ? `[^>]*\\bid=["']${id}["'][^>]*` : "";
  const re = new RegExp(`(<${tag}${idAttr}>)([\\s\\S]*?)(</${tag}>)`, "i");
  return html.replace(re, `$1${content}$3`);
}

function replaceMetaByName(html: string, name: string, content: string): string {
  const re = new RegExp(
    `(<meta\\s+[^>]*name=["']${name}["'][^>]*content=)(["'])(.*?)\\2`,
    "i",
  );
  if (re.test(html)) return html.replace(re, `$1$2${content}$2`);
  const re2 = new RegExp(
    `(<meta\\s+[^>]*content=)(["'])(.*?)\\2([^>]*name=["']${name}["'])`,
    "i",
  );
  return html.replace(re2, `$1$2${content}$2$4`);
}

function replaceMetaByProperty(
  html: string,
  property: string,
  content: string,
): string {
  const re = new RegExp(
    `(<meta\\s+[^>]*property=["']${property}["'][^>]*content=)(["'])(.*?)\\2`,
    "i",
  );
  if (re.test(html)) return html.replace(re, `$1$2${content}$2`);
  const re2 = new RegExp(
    `(<meta\\s+[^>]*content=)(["'])(.*?)\\2([^>]*property=["']${property}["'])`,
    "i",
  );
  return html.replace(re2, `$1$2${content}$2$4`);
}

function hreflangBlock(): string {
  const links = LOCALES.map(
    (loc) =>
      `    <link rel="alternate" hreflang="${loc}" href="${localeUrl(loc)}" />`,
  );
  links.push(
    `    <link rel="alternate" hreflang="x-default" href="${localeUrl(X_DEFAULT_LOCALE)}" />`,
  );
  return links.join("\n");
}

function langOptionHtml(loc: Locale, current: Locale): string {
  const active = loc === current ? " active" : "";
  const aria =
    loc === current ? ' aria-current="page"' : ' aria-current="false"';
  return `<a href="${localePath(loc)}" class="lang-option${active}" id="lang-${loc}" data-locale="${loc}" hreflang="${loc}" lang="${loc}"${aria}>${localeFlagHtml(loc)}<span class="lang-name">${LOCALE_NATIVE_NAME[loc]}</span></a>`;
}

function langSwitcherHtml(current: Locale, ariaLabel: string): string {
  const options = LOCALES.map((loc) => langOptionHtml(loc, current)).join(
    "\n            ",
  );
  return `<details class="lang">
          <summary class="lang-summary" aria-label="${ariaLabel}">
            ${localeFlagHtml(current)}
            <span class="lang-current-name">${LOCALE_NATIVE_NAME[current]}</span>
          </summary>
          <div class="lang-menu" role="list">
            ${options}
          </div>
        </details>`;
}

function applyHtmlLangDir(html: string, locale: Locale): string {
  const dir = isRtlLocale(locale) ? "rtl" : "ltr";
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, `<html lang="${locale}" dir="${dir}">`);
  }
  return html;
}

function applyDataI18n(html: string, locale: Locale): string {
  return html.replace(
    /<(\w+)(\s[^>]*?\bdata-i18n="(\w+)"[^>]*)>[\s\S]*?<\/\1>/g,
    (_m, tag: string, attrs: string, key: string) =>
      `<${tag}${attrs}>${t(locale, key as MessageKey)}</${tag}>`,
  );
}

export function localizeIndexHtml(html: string, locale: Locale): string {
  const copy = getSeoCopy(locale);
  const pageUrl = localeUrl(locale);
  let out = applyHtmlLangDir(html, locale);

  out = replaceTagContent(out, "title", null, copy.title);
  out = out.replace(
    /<link\s+rel=["']manifest["'][^>]*>/i,
    `<link rel="manifest" href="${localePath(locale)}manifest.webmanifest" />`,
  );
  out = replaceMetaByName(out, "robots", ROBOTS_META);
  out = replaceMetaByName(out, "description", copy.description);
  out = out.replace(/\s*<meta\s+[^>]*name=["']keywords["'][^>]*>/i, "");
  out = out.replace(
    /<link\s+rel=["']canonical["'][^>]*>/i,
    `<link rel="canonical" href="${pageUrl}" />`,
  );
  out = out.replace(
    /(?:\s*<link\s+rel=["']alternate["']\s+hreflang=["'][^"']+["'][^>]*>)+/i,
    `\n${hreflangBlock()}`,
  );
  out = replaceMetaByProperty(out, "og:url", pageUrl);
  out = replaceMetaByProperty(out, "og:title", copy.title);
  out = replaceMetaByProperty(out, "og:description", copy.description);
  out = replaceMetaByProperty(out, "og:locale", ogLocale(locale));
  out = out.replace(
    /(?:\s*<meta\s+property=["']og:locale:alternate["'][^>]*>)+/i,
    ogLocaleAlternates(locale)
      .map(
        (alt) =>
          `\n    <meta property="og:locale:alternate" content="${alt}" />`,
      )
      .join(""),
  );

  out = replaceTagContent(out, "h1", "heading", copy.heading);
  out = replaceTagContent(out, "p", "lead", copy.leadHtml);
  out = replaceTagContent(out, "article", "seo-root", renderSeoHtml(locale));
  out = replaceTagContent(out, "p", "rl-tip", t(locale, "tipHtml"));

  out = out.replace(
    /(<textarea\b[^>]*\bid=["'](?:left|right)-input["'][^>]*\bplaceholder=)(["'])(.*?)\2/gi,
    `$1$2${t(locale, "inputPlaceholder")}$2`,
  );
  out = out.replace(
    /(<textarea\b[^>]*\bid=["']ignore-keys["'][^>]*\bplaceholder=)(["'])(.*?)\2/i,
    `$1$2${t(locale, "ignoreKeysPlaceholder")}$2`,
  );
  out = out.replace(
    /<(?:div|details)[^>]*class=["'][^"']*\blang\b[^"']*["'][^>]*>[\s\S]*?<\/(?:div|details)>/i,
    langSwitcherHtml(locale, t(locale, "langSwitch")),
  );

  out = out.replace(
    /<script type=["']application\/ld\+json["'] id=["']ld-app["']>[\s\S]*?<\/script>/i,
    `<script type="application/ld+json" id="ld-app">${JSON.stringify(buildAppJsonLd(locale))}</script>`,
  );
  out = out.replace(
    /<script type=["']application\/ld\+json["'] id=["']ld-faq["']>[\s\S]*?<\/script>/i,
    `<script type="application/ld+json" id="ld-faq">${JSON.stringify(buildFaqJsonLd(locale))}</script>`,
  );

  out = applyDataI18n(out, locale);

  return out;
}

export function renderNotFoundHtml(locale: Locale): string {
  const copy = NOT_FOUND_COPY[locale] ?? NOT_FOUND_COPY.en;
  const dir = isRtlLocale(locale) ? "rtl" : "ltr";
  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>${copy.title}</title>
    <meta name="robots" content="noindex, nofollow" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: "Segoe UI", sans-serif;
        background: #17110c;
        color: #f6eee6;
      }
      main {
        text-align: center;
        padding: 2rem;
      }
      a {
        color: #f0852a;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>404</h1>
      <p>${copy.message}</p>
      <p><a href="${localePath(locale)}">${copy.home}</a></p>
    </main>
  </body>
</html>
`;
}

export function renderSitemapXml(): string {
  const alts = [
    ...LOCALES.map(
      (loc) =>
        `    <xhtml:link rel="alternate" hreflang="${loc}" href="${localeUrl(loc)}"/>`,
    ),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${localeUrl(X_DEFAULT_LOCALE)}"/>`,
  ].join("\n");

  const urls = LOCALES.map(
    (loc) => `  <url>
    <loc>${localeUrl(loc)}</loc>
${alts}
  </url>`,
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
}

export function renderRobotsTxt(): string {
  const disallow = ALLOW_INDEX ? "" : "Disallow: /";
  return `User-agent: *
${disallow}
Sitemap: ${SITE_ORIGIN}/sitemap.xml
`.replace(/\n{3,}/g, "\n\n");
}
