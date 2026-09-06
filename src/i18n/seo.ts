import type { SupportedLang } from './index'
import { professionalServiceJsonLd, homeFaqJsonLd, servicesOfferJsonLd } from '@/lib/jsonld'

const SITE = 'https://stanimeros.com'

export interface HreflangAlternate {
  hreflang: string
  href: string
}

export interface PageSeo {
  title: string
  description: string
  keywords?: string
  canonical: string
  noindex?: boolean
  preloadImage?: string
  hreflangAlternates?: HreflangAlternate[]
  jsonLd?: Record<string, unknown>[]
}

/** Builds the standard en/el/x-default hreflang triple for a route, given its path on each locale. */
function hreflang(pathEn: string, pathEl: string): HreflangAlternate[] {
  return [
    { hreflang: 'en', href: `${SITE}${pathEn}` },
    { hreflang: 'el', href: `${SITE}${pathEl}` },
    { hreflang: 'x-default', href: `${SITE}${pathEn}` },
  ]
}

type SeoMap = Record<SupportedLang, PageSeo>

/**
 * Per-route SEO metadata (title/description/keywords/canonical/hreflang/jsonLd) for both locales.
 * Each `src/pages/**` route file just picks its entry here and passes it to BaseLayout —
 * this is the single place to edit copy instead of two page files.
 */
export const seo: Record<string, SeoMap> = {
  home: {
    en: {
      title: 'Websites & Apps From €350 | Pantelis Stanimeros',
      description:
        'Software engineering studio in Thessaloniki, Greece. Websites from €350, apps from €950, AI automation on custom quote. We respond within 2 hours.',
      keywords:
        'AI automation Greece, software engineering studio Thessaloniki, mobile app development Greece, custom web app developer, website development Greece, Pantelis Stanimeros',
      canonical: `${SITE}/`,
      preloadImage: '/images/logo-glass.webp',
      hreflangAlternates: hreflang('/', '/el'),
      jsonLd: [professionalServiceJsonLd, homeFaqJsonLd],
    },
    el: {
      title: 'Ιστοσελίδες & Εφαρμογές από €350 | Pantelis Stanimeros',
      description:
        'Μηχανικός λογισμικού στη Θεσσαλονίκη. Ιστοσελίδες από €350, εφαρμογές από €950, AI αυτοματισμοί με προσαρμοσμένη προσφορά. Απαντάμε εντός 2 ωρών.',
      keywords:
        'κατασκευή ιστοσελίδων Θεσσαλονίκη, κατασκευή εφαρμογών Θεσσαλονίκη, AI αυτοματισμοί επιχειρήσεων, ανάπτυξη mobile εφαρμογών Ελλάδα, κατασκευή eshop, μηχανικός λογισμικού Ελλάδα',
      canonical: `${SITE}/el`,
      preloadImage: '/images/logo-glass.webp',
      hreflangAlternates: hreflang('/', '/el'),
      jsonLd: [professionalServiceJsonLd, homeFaqJsonLd],
    },
  },

  about: {
    en: {
      title: 'About | Pantelis Stanimeros',
      description:
        'Software engineer in Thessaloniki, Greece, with a background in Computer Science and an MSc in AI & Data Analytics. Building AI automation, apps, and optimization systems.',
      canonical: `${SITE}/about`,
      preloadImage: '/images/pantelis.webp',
      hreflangAlternates: hreflang('/about', '/el/about'),
    },
    el: {
      title: 'Σχετικά με εμένα | Pantelis Stanimeros',
      description:
        'Μηχανικός λογισμικού στη Θεσσαλονίκη, με πτυχίο Επιστήμης Υπολογιστών και MSc στην Τεχνητή Νοημοσύνη & Ανάλυση Δεδομένων. AI αυτοματισμοί, εφαρμογές και συστήματα βελτιστοποίησης.',
      canonical: `${SITE}/el/about`,
      preloadImage: '/images/pantelis.webp',
      hreflangAlternates: hreflang('/about', '/el/about'),
    },
  },

  contact: {
    en: {
      title: 'Contact | Pantelis Stanimeros',
      description:
        'Book a free strategy call to discuss your app, AI automation, or business problem. Based in Thessaloniki, Greece. Response within 2 hours.',
      canonical: `${SITE}/contact`,
      hreflangAlternates: hreflang('/contact', '/el/contact'),
    },
    el: {
      title: 'Επικοινωνία | Pantelis Stanimeros',
      description:
        'Κλείσε μια δωρεάν αρχική συνάντηση για να συζητήσουμε την εφαρμογή ή τον αυτοματισμό που χρειάζεσαι. Απαντάμε εντός 2 ωρών.',
      canonical: `${SITE}/el/contact`,
      hreflangAlternates: hreflang('/contact', '/el/contact'),
    },
  },

  services: {
    en: {
      title: 'Services & Pricing | Websites From €350, Apps From €950',
      description:
        'Websites, apps & dashboards, and AI automation & optimization systems. Clear pricing from €350, custom quotes for AI work. Based in Thessaloniki, Greece.',
      canonical: `${SITE}/services`,
      hreflangAlternates: hreflang('/services', '/el/services'),
      jsonLd: [servicesOfferJsonLd],
    },
    el: {
      title: 'Υπηρεσίες & Τιμές | Ιστοσελίδες από €350, Εφαρμογές από €950',
      description:
        'Ιστοσελίδες, εφαρμογές & dashboards, και AI αυτοματισμοί & συστήματα βελτιστοποίησης. Ξεκάθαρη τιμολόγηση από €350, προσαρμοσμένη προσφορά για AI. Έδρα η Θεσσαλονίκη.',
      canonical: `${SITE}/el/services`,
      hreflangAlternates: hreflang('/services', '/el/services'),
      jsonLd: [servicesOfferJsonLd],
    },
  },

  projects: {
    en: {
      title: 'Projects | Websites, Apps & Dashboards | Pantelis Stanimeros',
      description:
        "Browse all the websites, mobile apps, and dashboards I've built for real businesses, from e-commerce and travel to AI-powered tools.",
      canonical: `${SITE}/projects`,
      hreflangAlternates: hreflang('/projects', '/el/projects'),
    },
    el: {
      title: 'Projects | Ιστοσελίδες, Εφαρμογές & Dashboards | Παντελής Στανήμερος',
      description:
        'Δες όλες τις ιστοσελίδες, εφαρμογές κινητών και dashboards που έχω φτιάξει για πραγματικές επιχειρήσεις, από e-commerce και ταξίδια έως εργαλεία με AI.',
      canonical: `${SITE}/el/projects`,
      hreflangAlternates: hreflang('/projects', '/el/projects'),
    },
  },

  privacyPolicy: {
    en: {
      title: 'Privacy Policy | Pantelis Stanimeros',
      description: 'Privacy policy for apps and services by Pantelis Stanimeros.',
      canonical: `${SITE}/privacy-policy`,
      noindex: true,
    },
    el: {
      title: 'Πολιτική Απορρήτου | Pantelis Stanimeros',
      description: 'Πολιτική απορρήτου για εφαρμογές και υπηρεσίες του Pantelis Stanimeros.',
      canonical: `${SITE}/el/privacy-policy`,
      noindex: true,
    },
  },

  dataDeletion: {
    en: {
      title: 'Data Deletion | Pantelis Stanimeros',
      description: 'Request deletion of your data from apps and services by Pantelis Stanimeros.',
      canonical: `${SITE}/data-deletion`,
      noindex: true,
    },
    el: {
      title: 'Διαγραφή Δεδομένων | Pantelis Stanimeros',
      description: 'Ζητήστε διαγραφή των δεδομένων σας από εφαρμογές και υπηρεσίες του Pantelis Stanimeros.',
      canonical: `${SITE}/el/data-deletion`,
      noindex: true,
    },
  },
}

/** SEO for the per-app `/privacy-policy/[appSlug]` and `/el/privacy-policy/[appSlug]` routes. */
export function privacyPolicyAppSeo(lang: SupportedLang, appSlug: string): PageSeo {
  const path = lang === 'el' ? `/el/privacy-policy/${appSlug}` : `/privacy-policy/${appSlug}`
  const title =
    lang === 'el'
      ? `Πολιτική Απορρήτου – ${appSlug} | Pantelis Stanimeros`
      : `Privacy Policy – ${appSlug} | Pantelis Stanimeros`
  return {
    title,
    description: seo.privacyPolicy[lang].description,
    canonical: `${SITE}${path}`,
    noindex: true,
  }
}

/** SEO for the per-app `/data-deletion/[appSlug]` and `/el/data-deletion/[appSlug]` routes. */
export function dataDeletionAppSeo(lang: SupportedLang, appSlug: string): PageSeo {
  const path = lang === 'el' ? `/el/data-deletion/${appSlug}` : `/data-deletion/${appSlug}`
  const title =
    lang === 'el'
      ? `Διαγραφή Δεδομένων – ${appSlug} | Pantelis Stanimeros`
      : `Data Deletion – ${appSlug} | Pantelis Stanimeros`
  return {
    title,
    description: seo.dataDeletion[lang].description,
    canonical: `${SITE}${path}`,
    noindex: true,
  }
}

/** SEO for the per-project `/projects/[slug]` and `/el/projects/[slug]` detail routes. */
export function projectDetailSeo(lang: SupportedLang, slug: string, title: string, description: string): PageSeo {
  const path = lang === 'el' ? `/el/projects/${slug}` : `/projects/${slug}`
  return {
    title: `${title} | Pantelis Stanimeros`,
    description,
    canonical: `${SITE}${path}`,
    hreflangAlternates: hreflang(`/projects/${slug}`, `/el/projects/${slug}`),
  }
}
