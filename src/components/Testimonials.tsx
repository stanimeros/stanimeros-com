import { useRef } from "react"
import { motion, type HTMLMotionProps } from "framer-motion"
import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useScrollAnimation } from "@/lib/hooks"
import { ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline"
import { StarIcon } from "@heroicons/react/24/solid"

const quoteKeys = ["first", "second", "third"] as const

export default function Testimonials() {
  const { t } = useTranslation()
  const sectionRef = useRef<HTMLElement>(null)
  const animation = useScrollAnimation(sectionRef)

  return (
    <motion.section
      ref={sectionRef}
      id="testimonials"
      className="py-20 bg-card/70 scroll-mt-10 overflow-hidden"
      {...(animation as HTMLMotionProps<"section">)}>
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4 text-center">
            <ChatBubbleLeftRightIcon className="inline-block size-8 text-primary align-middle mr-2 -mt-1" />
            {t("testimonials.title")}
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">{t("testimonials.subtitle")}</p>
          <Separator className="w-24 mx-auto mt-4" />
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {quoteKeys.map((key) => {
            const rating = Number(t(`testimonials.quotes.${key}.rating`))
            const name = t(`testimonials.quotes.${key}.attribution`)
            return (
              <Card
                key={key}
                className="h-full flex flex-col bg-card/70 hover:bg-card/70 border-primary/10 shadow-sm">
                <CardContent className="flex-grow pt-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center justify-center size-11 rounded-full bg-primary/10 text-primary font-semibold text-lg shrink-0">
                      {name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-foreground leading-tight">{name}</p>
                      <div className="flex gap-0.5 mt-1" aria-label={`${rating} out of 5 stars`}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <StarIcon
                            key={i}
                            className={`size-4 ${i < rating ? "text-yellow-400" : "text-muted-foreground/30"}`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="font-semibold mb-2">{t(`testimonials.quotes.${key}.title`)}</p>
                  <p className="text-muted-foreground leading-relaxed text-sm">
                    {t(`testimonials.quotes.${key}.quote`)}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </motion.section>
  )
}
