import type { Locale } from "./site-config";
import { SEO_A } from "./seo-a";
import { SEO_B } from "./seo-b";
import { SEO_C } from "./seo-c";

export type SeoFaq = {
  q: string;
  a: string;
};

export type SeoCopy = {
  title: string;
  description: string;
  heading: string;
  leadHtml: string;
  benefitsTitle: string;
  benefits: string[];
  howTitle: string;
  howSteps: string[];
  strongTitle: string;
  strongLead: string;
  strongTips: string[];
  usesTitle: string;
  uses: string[];
  faqTitle: string;
  faq: SeoFaq[];
  appName: string;
  tipsLabel: string;
};

export const SEO_COPY: Record<Locale, SeoCopy> = {
  ...SEO_A,
  ...SEO_B,
  ...SEO_C,
};
