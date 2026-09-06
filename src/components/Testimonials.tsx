import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Section, SectionHeading } from "@/components/ui/section"
import { useScrollAnimation } from "@/lib/hooks"
import { ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline"
import { StarIcon, CheckBadgeIcon } from "@heroicons/react/24/solid"
import GoogleLogo from "@/components/icons/GoogleLogo"

const quoteKeys = ["first", "second", "third", "fourth", "fifth", "sixth"] as const

export default function Testimonials() {
  const { t } = useTranslation()
  const sectionRef = useRef<HTMLElement>(null)
  const animation = useScrollAnimation(sectionRef)

  const cards = quoteKeys.map((key) => {
    const rating = Number(t(`testimonials.quotes.${key}.rating`))
    const name = t(`testimonials.quotes.${key}.attribution`)
    return (
      <Card
        key={key}
        className="h-[350px] w-80 shrink-0 flex flex-col bg-card/70 border-primary/10 shadow-sm py-4">
        <CardContent className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-12 rounded-full bg-primary/10 text-primary font-semibold text-lg shrink-0">
              {name.charAt(0)}
            </div>
            <div className="flex flex-col items-start">
              <p className="font-medium text-foreground">{name}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm font-medium text-muted-foreground">{rating.toFixed(1)}</span>
                <div className="flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <StarIcon
                      key={i}
                      className={`size-4 ${i < rating ? "text-yellow-400" : "text-muted-foreground/30"}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="w-full text-left flex-1 min-h-0 overflow-hidden mt-4">
            <p className="font-semibold mb-1 line-clamp-2">{t(`testimonials.quotes.${key}.title`)}</p>
            <p className="text-muted-foreground leading-relaxed text-sm line-clamp-8">
              {t(`testimonials.quotes.${key}.quote`)}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  })

  return (
    <Section ref={sectionRef} id="testimonials" shaded {...animation}>
      <div className="container mx-auto px-4">
        <SectionHeading
          icon={ChatBubbleLeftRightIcon}
          title={t("testimonials.title")}
          subtitle={<p className="text-muted-foreground max-w-2xl mx-auto">{t("testimonials.subtitle")}</p>}
        />

        <div className="group relative w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
          <div className="flex w-max gap-6 animate-testimonial-marquee group-hover:[animation-play-state:paused]">
            {cards}
            {cards.map((card, i) => (
              <div key={i} aria-hidden="true">{card}</div>
            ))}
          </div>
        </div>

        <div
          aria-label={t("hero.googleReviews")}
          className="mt-12 flex flex-col items-center gap-3"
        >
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
            <div className="flex items-center gap-4">
              <GoogleLogo className="size-14 shrink-0" />
              <span className="text-5xl font-bold text-foreground">5.0</span>
            </div>
            <div className="flex gap-1.5" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <StarIcon key={i} className="size-7 text-yellow-400" />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground uppercase tracking-wide">
            <CheckBadgeIcon className="size-4 text-green-500" />
            {t("hero.verifiedReviews")}
          </div>
        </div>
      </div>
    </Section>
  )
}
