import { UI_MESSAGES } from "./i18n-messages";
import type { MessageKey } from "./i18n-keys";
import {
  DEFAULT_LOCALE,
  type Locale,
  localeFromPathname,
} from "./site-config";

export type { Locale, MessageKey };

export function t(locale: Locale, key: MessageKey): string {
  return UI_MESSAGES[locale][key] ?? UI_MESSAGES.en[key] ?? key;
}

export function detectLocale(pathname = window.location.pathname): Locale {
  return localeFromPathname(pathname) || DEFAULT_LOCALE;
}
