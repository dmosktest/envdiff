import type { MessageKey } from "./i18n-keys";
import type { Locale } from "./site-config";
import { UI_A } from "./ui-a";
import { UI_B } from "./ui-b";
import { UI_C } from "./ui-c";

export const UI_MESSAGES: Record<Locale, Record<MessageKey, string>> = {
  ...UI_A,
  ...UI_B,
  ...UI_C,
};
