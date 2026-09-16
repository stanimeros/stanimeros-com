import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { XMarkIcon } from "@heroicons/react/24/outline"

const DISMISS_KEY = "langBannerDismissed"
const PREFERRED_KEY = "preferredLang"

// Bilingual by design (not run through the i18n translation pipeline): the
// visitor's browser language and the page's language disagree here, so we
// can't assume which one they read.
const MESSAGES: Record<"en" | "el", string> = {
  en: "View this page in English? · Δες τη σελίδα στα Αγγλικά;",
  el: "View this page in Greek? · Δες τη σελίδα στα Ελληνικά;",
}

interface LanguageBannerProps {
  lang: "en" | "el"
}

export default function LanguageBanner({ lang }: LanguageBannerProps) {
  const [target, setTarget] = useState<"en" | "el" | null>(null)

  useEffect(() => {
    const path = window.location.pathname
    if (path !== "/" && path !== "/el") return

    try {
      if (localStorage.getItem(PREFERRED_KEY)) return
      if (localStorage.getItem(DISMISS_KEY)) return
    } catch {
      return
    }

    const browserLang = navigator.language?.toLowerCase().startsWith("el") ? "el" : "en"

    if (lang === "en" && browserLang === "el") {
      setTarget("el")
    } else if (lang === "el" && browserLang === "en") {
      setTarget("en")
    }
  }, [lang])

  if (!target) return null

  const switchLang = () => {
    try {
      localStorage.setItem(PREFERRED_KEY, target)
    } catch {
      // localStorage unavailable, proceed with navigation anyway
    }
    window.location.href = target === "el" ? "/el" : "/"
  }

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "true")
    } catch {
      // localStorage unavailable, proceed anyway
    }
    setTarget(null)
  }

  const message = MESSAGES[target]
  const switchLabel = target === "el" ? "🇬🇷 Ελληνικά" : "🇬🇧 English"

  return (
    <div className="fixed top-24 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto bg-card border border-border/80 rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 max-w-md w-full sm:w-auto">
        <span className="text-sm text-muted-foreground flex-1">{message}</span>
        <Button size="sm" onClick={switchLang} className="shrink-0">
          {switchLabel}
        </Button>
        <button
          type="button"
          aria-label="Dismiss · Απόρριψη"
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
    </div>
  )
}
