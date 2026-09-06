import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { CakeIcon, CheckIcon, XMarkIcon } from "@heroicons/react/24/outline"
import { initAnalytics } from "@/lib/firebase"
import { initPixel } from "@/lib/pixel"

const CONSENT_KEY = "cookie_consent"

export default function CookieBanner() {
  const { t, i18n } = useTranslation()
  const [visible, setVisible] = useState(false)
  const prefix = i18n.language === 'el' ? '/el' : ''

  useEffect(() => {
    const consent = localStorage.getItem(CONSENT_KEY)
    if (!consent) {
      setVisible(true)
    } else if (consent === "accepted") {
      initAnalytics()
      initPixel()
    }
  }, [])

  const accept = () => {
    localStorage.setItem(CONSENT_KEY, "accepted")
    initAnalytics()
    initPixel()
    setVisible(false)
    window.dispatchEvent(new Event("cookie-consent-updated"))
  }

  const decline = () => {
    localStorage.setItem(CONSENT_KEY, "declined")
    setVisible(false)
    window.dispatchEvent(new Event("cookie-consent-updated"))
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-banner-title"
      className="fixed bottom-10 sm:bottom-14 md:bottom-16 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-xl pointer-events-none"
    >
      <div className="bg-card border border-border/80 rounded-2xl shadow-floating p-6 sm:p-8 pointer-events-auto">
        <div className="flex items-center gap-3 sm:gap-4 mb-4">
          <CakeIcon className="size-8 text-primary shrink-0" />
          <h2 id="cookie-banner-title" className="font-semibold text-lg sm:text-xl">
            {t("cookieBanner.title")}
          </h2>
        </div>
        <p className="text-base text-muted-foreground mb-6 sm:mb-8 leading-relaxed">
          {t("cookieBanner.message")}{" "}
          <a href={`${prefix}/privacy-policy`} className="text-primary hover:underline font-medium">
            {t("cookieBanner.learnMoreLabel")}
          </a>
        </p>
        <div className="flex flex-col-reverse sm:flex-row gap-3 sm:gap-4">
          <Button variant="outline" size="lg" className="w-full sm:flex-1" onClick={decline}>
            <XMarkIcon className="size-5 mr-2 stroke-[1.5]" />
            {t("cookieBanner.decline")}
          </Button>
          <Button size="lg" className="w-full sm:flex-1" onClick={accept}>
            <CheckIcon className="size-5 mr-2 stroke-[1.5]" />
            {t("cookieBanner.accept")}
          </Button>
        </div>
      </div>
    </div>
  )
}
