import type { Locale } from "./i18n";
import { SEO_COPY, type SeoCopy } from "./seo-messages";
import { SITE_ORIGIN, localeUrl } from "./site-config";

export const SITE_URL = `${SITE_ORIGIN}/`;

export type { SeoCopy };

function listHtml(items: string[], ordered = false): string {
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`;
}

export function getSeoCopy(locale: Locale): SeoCopy {
  return SEO_COPY[locale] ?? SEO_COPY.en;
}

export function renderSeoHtml(locale: Locale): string {
  const c = getSeoCopy(locale);
  const faq = c.faq
    .map(
      (item) => `
        <details class="faq-item">
          <summary>${item.q}</summary>
          <p>${item.a}</p>
        </details>`,
    )
    .join("");

  return `
    <section class="seo-block" aria-labelledby="seo-benefits">
      <h2 id="seo-benefits">${c.benefitsTitle}</h2>
      ${listHtml(c.benefits)}
    </section>
    <section class="seo-block" aria-labelledby="seo-how">
      <h2 id="seo-how">${c.howTitle}</h2>
      ${listHtml(c.howSteps, true)}
    </section>
    <section class="seo-block" aria-labelledby="seo-strong">
      <h2 id="seo-strong">${c.strongTitle}</h2>
      <p>${c.strongLead}</p>
      <p class="seo-label">${c.tipsLabel}</p>
      ${listHtml(c.strongTips)}
    </section>
    <section class="seo-block" aria-labelledby="seo-uses">
      <h2 id="seo-uses">${c.usesTitle}</h2>
      ${listHtml(c.uses)}
    </section>
    <section class="seo-block" aria-labelledby="seo-faq">
      <h2 id="seo-faq">${c.faqTitle}</h2>
      <div class="faq-list">${faq}</div>
    </section>
  `;
}

export function buildFaqJsonLd(locale: Locale): object {
  const c = getSeoCopy(locale);
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: c.faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}

export function buildAppJsonLd(locale: Locale): object {
  const c = getSeoCopy(locale);
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: c.appName,
    url: localeUrl(locale),
    description: c.description,
    applicationCategory: "UtilityApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript",
    inLanguage: locale,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: locale === "ru" ? "RUB" : "USD",
    },
  };
}
