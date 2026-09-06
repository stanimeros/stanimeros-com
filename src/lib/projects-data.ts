export interface StoreLinks {
  /** App Store link, or TestFlight join link while still in beta */
  apple?: string
  /** Google Play link - used on Android devices */
  android?: string
  /** Google Play testing opt-in link - used on desktop/web (non-Android) while still in open testing */
  androidWeb?: string
}

export interface ProjectItem {
  key: string
  technologies: string[]
  bgColor: string
  textColor: string
  bgImage?: string
  logo?: string
  logoBg?: string
  url?: string
  storeLinks?: StoreLinks
  /** Show on /{slug} download page with coming-soon store buttons (no live links yet) */
  storeComingSoon?: boolean
}

export const projectItems: ProjectItem[] = [
  {
    key: 'statwise',
    technologies: ["iOS", "Android", "Analytics", "GA4", "AI", "Dashboard"],
    bgColor: "bg-emerald-900/30",
    textColor: "text-emerald-200",
    bgImage: "/assets/portfolio/statwise.jpg",
    logo: "/assets/logos/statwise.png",
    logoBg: "bg-white",
    storeLinks: {
      apple: "https://testflight.apple.com/join/EGWvbHwb",
      android: "https://play.google.com/store/apps/details?id=com.stanimeros.applytics"
    }
  },
  {
    key: 'party',
    technologies: ["iOS", "Android", "Party Games", "Offline", "Multiplayer", "Local"],
    bgColor: "bg-fuchsia-900/30",
    textColor: "text-fuchsia-200",
    bgImage: "/assets/portfolio/party.jpg",
    logo: "/assets/logos/party.png",
    logoBg: "bg-[#FFF8E7]",
    storeLinks: {
      apple: "https://apps.apple.com/us/app/party-παιχνίδια-παρέας/id6799648046",
      android: "https://play.google.com/store/apps/details?id=com.stanimeros.party"
    }
  },
  {
    key: 'nourea',
    technologies: ["iOS", "Android", "Nutrition", "AI", "Meal Planning", "Health"],
    bgColor: "bg-rose-900/30",
    textColor: "text-rose-200",
    bgImage: "/assets/portfolio/nourea.jpg",
    logo: "/assets/logos/nourea.png"
  },
  {
    key: 'chronal',
    technologies: ["iOS", "Android", "Travel", "Trip Planning", "Currency Rates", "Bookings"],
    bgColor: "bg-teal-900/30",
    textColor: "text-teal-200",
    bgImage: "/assets/portfolio/chronal.jpg",
    logo: "/assets/logos/chronal.png",
    logoBg: "bg-[#FAFAF8]",
    storeLinks: {
      apple: "https://apps.apple.com/app/chronal/id6797291496",
      android: "https://play.google.com/store/apps/details?id=com.stanimeros.chronal"
    }
  },
  {
    key: 'irisdrop',
    technologies: ["SaaS", "Web App", "Print Shops", "File Upload", "Queue", "Admin"],
    bgColor: "bg-cyan-900/30",
    textColor: "text-cyan-200",
    bgImage: "/assets/portfolio/irisdrop.jpg",
    logo: "/assets/logos/irisdrop.png",
    url: "https://irisdrop.web.app"
  },
  {
    key: 'athensMytransfer',
    technologies: ["Landing Page", "Transfers", "Athens", "Tourism", "Bookings", "Transport"],
    bgColor: "bg-sky-900/30",
    textColor: "text-sky-200",
    bgImage: "/assets/portfolio/athens-mytransfer.jpg",
    logo: "/assets/logos/athens-mytransfer.png",
    url: "https://athens-mytransfer.com"
  },
  {
    key: 'veridictum',
    technologies: ["Website", "AI", "LLM", "Legal Tech", "Document Analysis", "Automation"],
    bgColor: "bg-indigo-900/30",
    textColor: "text-indigo-200",
    bgImage: "/assets/portfolio/veridictum.jpg",
    url: "https://veridictum.ai/"
  },
  {
    key: 'process',
    technologies: ["Website", "Production Monitoring", "Manufacturing", "Real-time", "Dashboard", "Analytics"],
    bgColor: "bg-amber-900/30",
    textColor: "text-amber-200",
    bgImage: "/assets/portfolio/process.jpg",
    url: "https://process-a7a0f.web.app/"
  },
  {
    key: 'skiGreece',
    technologies: ["Website", "Ski Centers", "Travel", "Winter Sports", "Resort Info", "Maps"],
    bgColor: "bg-slate-900/30",
    textColor: "text-slate-200",
    bgImage: "/assets/portfolio/ski-greece.jpg",
    logo: "/assets/logos/ski-greece.png",
    url: "https://ski-greece.gr/",
    storeLinks: {
      apple: "https://apps.apple.com/app/ski-greece/id6759574238",
      android: "https://play.google.com/store/apps/details?id=com.stanimeros.poudra"
    }
  },
  {
    key: 'nikiMargariti',
    technologies: ["Website", "AI", "Chatbot", "Education", "Students", "Academic"],
    bgColor: "bg-violet-900/30",
    textColor: "text-violet-200",
    bgImage: "/assets/portfolio/niki-margariti.jpg",
    url: "https://ai.nikimargariti.gr/chats"
  },
  {
    key: 'fireMessage',
    technologies: ["iOS", "Android", "Mobile App", "Push Notifications", "Monetization"],
    bgColor: "bg-red-900/30",
    textColor: "text-red-200",
    bgImage: "/assets/portfolio/fire-message.jpg",
    logo: "/assets/logos/fire-message.png",
    storeLinks: {
      apple: "https://apps.apple.com/app/fire-message/id6756577964",
      android: "https://play.google.com/store/apps/details?id=com.stanimeros.firemessage"
    }
  },
  {
    key: 'tattooHealer',
    technologies: ["Web App", "iOS", "Android", "Push Notifications", "Admin Panel", "Education"],
    bgColor: "bg-purple-900/30",
    textColor: "text-purple-200",
    bgImage: "/assets/portfolio/tattoo-healer.jpg",
    logo: "/assets/logos/tattoo-healer.png",
    url: "https://tattoo-healer.com",
    storeLinks: {
      apple: "https://apps.apple.com/app/tattoo-healer/id6749210555",
      android: "https://play.google.com/store/apps/details?id=com.tattoohealer.app"
    }
  },
  {
    key: 'transHellas',
    technologies: ["Web App", "Parcel Management", "Admin Panel", "Tracking System", "Logistics", "Germany-Greece"],
    bgColor: "bg-blue-900/30",
    textColor: "text-blue-200",
    bgImage: "/assets/portfolio/trans-hellas.jpg",
    logo: "/assets/logos/trans-hellas.jpg",
    url: "https://thr.topaketo.de"
  },
  {
    key: 'etui',
    technologies: ["Website", "E-commerce", "Luxury Packaging", "Jewelry", "Customization", "B2B"],
    bgColor: "bg-amber-900/30",
    textColor: "text-amber-200",
    bgImage: "/assets/portfolio/etui.jpg",
    logo: "/assets/logos/etui.png",
    logoBg: "bg-[#faf9f7]",
    url: "https://etuicreations.de/"
  },
  {
    key: 'ridefast',
    technologies: ["Web App", "Maps", "Payments", "Bookings", "Real-time", "Taxi & Transfers"],
    bgColor: "bg-gray-900/30",
    textColor: "text-gray-200",
    bgImage: "/assets/portfolio/ridefast.jpg",
    logo: "/assets/logos/ridefast.png"
  },
  {
    key: 'atproPartner',
    technologies: ["iOS", "Android", "Web App", "Push Notifications", "Bookings", "Transport"],
    bgColor: "bg-sky-900/30",
    textColor: "text-sky-200",
    bgImage: "/assets/portfolio/atpro-partner.jpg",
    logo: "/assets/logos/atpro-partner.png",
    storeLinks: {
      apple: "https://apps.apple.com/app/atpro-partner/id6743795030",
      android: "https://play.google.com/store/apps/details?id=com.stanimeros.transfer"
    }
  },
  {
    key: 'mealAi',
    technologies: ["iOS", "Android", "AI", "Computer Vision", "Mobile App", "Nutrition"],
    bgColor: "bg-blue-900/30",
    textColor: "text-blue-200",
    bgImage: "/assets/portfolio/meal-ai.jpg",
    logo: "/assets/logos/meal-ai.png"
  },
  {
    key: 'near',
    technologies: ["iOS", "Android", "Mobile App", "Maps", "AI", "Privacy-focused"],
    bgColor: "bg-orange-900/30",
    textColor: "text-orange-200",
    bgImage: "/assets/portfolio/near.jpg",
    logo: "/assets/logos/near.png"
  },
  {
    key: 'hedeos',
    technologies: ["iOS", "Android", "Education", "Quizzes", "Mobile App", "Language Learning"],
    bgColor: "bg-yellow-900/30",
    textColor: "text-yellow-200",
    bgImage: "/assets/portfolio/hedeos.jpg",
    logo: "/assets/logos/hedeos.png",
    url: "https://hedeos.gr",
    storeLinks: {
      apple: "https://apps.apple.com/app/%CE%B7%CE%B4%CE%AD%CF%89%CF%82/id6503709023",
      android: "https://play.google.com/store/apps/details?id=com.stanimeros.hedeos"
    }
  },
  {
    key: 'ekarotsi',
    technologies: ["Website", "E-commerce", "Supermarket", "Online Ordering", "Delivery", "Inventory"],
    bgColor: "bg-green-900/30",
    textColor: "text-green-200",
    bgImage: "/assets/portfolio/ekarotsi.jpg",
    logo: "/assets/logos/e-karotsi.png",
  }
]

/** Converts a camelCase project key (e.g. 'athensMytransfer') to a URL slug ('athens-mytransfer') */
export function keyToSlug(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

export function getProjectBySlug(slug: string): ProjectItem | undefined {
  return projectItems.find((item) => keyToSlug(item.key) === slug)
}
