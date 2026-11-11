function readViteEnv(key: "VITE_SITE_ORIGIN" | "VITE_ALLOW_INDEX"): string | undefined {
  const fromMeta = import.meta.env?.[key];
  if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta;
  if (typeof process !== "undefined" && typeof process.env?.[key] === "string") {
    const fromProcess = process.env[key];
    if (fromProcess && fromProcess.length > 0) return fromProcess;
  }
  return undefined;
}

export const SITE_ORIGIN =
  readViteEnv("VITE_SITE_ORIGIN")?.replace(/\/$/, "") || "https://envdiff.dmosk.net";

export const ALLOW_INDEX = String(readViteEnv("VITE_ALLOW_INDEX") ?? "false") === "true";

export const ROBOTS_META = ALLOW_INDEX ? "index, follow" : "noindex, nofollow";

export const DEFAULT_LOCALE = "ru" as const;

export const X_DEFAULT_LOCALE = "en" as const;

export const LOCALES = [
  "ru",
  "en",
  "zh",
  "es",
  "hi",
  "ar",
  "bn",
  "pt",
  "fr",
  "de",
  "ja",
  "id",
  "pa",
  "jv",
  "te",
  "tr",
  "ko",
  "mr",
  "vi",
  "ta",
  "it",
  "fa",
  "tlh",
] as const;

export type Locale = (typeof LOCALES)[number];

export const LOCALE_NATIVE_NAME: Record<Locale, string> = {
  ru: "Русский",
  en: "English",
  zh: "中文",
  es: "Español",
  hi: "हिन्दी",
  ar: "العربية",
  bn: "বাংলা",
  pt: "Português",
  fr: "Français",
  de: "Deutsch",
  ja: "日本語",
  id: "Indonesia",
  pa: "ਪੰਜਾਬੀ",
  jv: "Basa Jawa",
  te: "తెలుగు",
  tr: "Türkçe",
  ko: "한국어",
  mr: "मराठी",
  vi: "Tiếng Việt",
  ta: "தமிழ்",
  it: "Italiano",
  fa: "فارسی",
  tlh: "tlhIngan Hol",
};

export const LOCALE_FLAG: Record<Locale, string> = {
  ru: "🇷🇺",
  en: "🇬🇧",
  zh: "🇨🇳",
  es: "🇪🇸",
  hi: "🇮🇳",
  ar: "🇸🇦",
  bn: "🇧🇩",
  pt: "🇵🇹",
  fr: "🇫🇷",
  de: "🇩🇪",
  ja: "🇯🇵",
  id: "🇮🇩",
  pa: "🇮🇳",
  jv: "🇮🇩",
  te: "🇮🇳",
  tr: "🇹🇷",
  ko: "🇰🇷",
  mr: "🇮🇳",
  vi: "🇻🇳",
  ta: "🇮🇳",
  it: "🇮🇹",
  fa: "🇮🇷",
  tlh: "🖖",
};

export function localeFlagCode(locale: Locale): string {
  return [...LOCALE_FLAG[locale]]
    .map((ch) => ch.codePointAt(0)!.toString(16))
    .filter((hex) => hex !== "fe0f")
    .join("-");
}

export function localeFlagUrl(locale: Locale): string {
  return `/flags/${localeFlagCode(locale)}.png`;
}

export function localeFlagHtml(locale: Locale): string {
  return `<img class="lang-flag" src="${localeFlagUrl(locale)}" alt="" width="20" height="20" decoding="async" aria-hidden="true" />`;
}

export const RTL_LOCALES = new Set<Locale>(["ar", "fa"]);

const OG_LOCALE: Partial<Record<Locale, string>> = {
  ru: "ru_RU",
  en: "en_US",
  zh: "zh_CN",
  es: "es_ES",
  hi: "hi_IN",
  ar: "ar_AR",
  bn: "bn_BD",
  pt: "pt_PT",
  fr: "fr_FR",
  de: "de_DE",
  ja: "ja_JP",
  id: "id_ID",
  pa: "pa_IN",
  jv: "jv_ID",
  te: "te_IN",
  tr: "tr_TR",
  ko: "ko_KR",
  mr: "mr_IN",
  vi: "vi_VN",
  ta: "ta_IN",
  it: "it_IT",
  fa: "fa_IR",
};

export const LOCALE_PATH_RE = LOCALES.join("|");

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function isRtlLocale(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

export function localePath(locale: Locale): string {
  return `/${locale}/`;
}

export function localeUrl(locale: Locale): string {
  return `${SITE_ORIGIN}${localePath(locale)}`;
}

export function localeFromPathname(pathname: string): Locale {
  const seg = pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  return isLocale(seg) ? seg : DEFAULT_LOCALE;
}

export function ogLocale(locale: Locale): string {
  return OG_LOCALE[locale] ?? OG_LOCALE[X_DEFAULT_LOCALE]!;
}

export function ogLocaleAlternates(locale: Locale): string[] {
  return LOCALES.filter((l) => l !== locale)
    .map((l) => OG_LOCALE[l])
    .filter((v): v is string => Boolean(v));
}

export function localeRecord<T>(
  fill: (locale: Locale) => T,
): Record<Locale, T> {
  const out = {} as Record<Locale, T>;
  for (const locale of LOCALES) out[locale] = fill(locale);
  return out;
}

export function localeNames(
  table: Partial<Record<Locale, string>> & { en: string },
): Record<Locale, string> {
  return localeRecord((locale) => table[locale] ?? table.en);
}
