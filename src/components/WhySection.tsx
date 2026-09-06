import { useRef } from "react"
import { motion } from "framer-motion"
import { useTranslation } from "react-i18next"
import { Section, SectionHeading } from "@/components/ui/section"
import { useScrollAnimation, useMobileCardAnimation } from "@/lib/hooks"
import UnderlineHighlight from "@/components/UnderlineHighlight"
import {
  ArrowPathIcon,
  GlobeAltIcon,
  CalendarDaysIcon,
  PresentationChartLineIcon,
  HandRaisedIcon,
  BoltIcon,
} from "@heroicons/react/24/outline"

const painPoints = [
  { key: "presence",   icon: GlobeAltIcon },
  { key: "repetitive", icon: ArrowPathIcon },
  { key: "scheduling", icon: CalendarDaysIcon },
  { key: "visibility", icon: PresentationChartLineIcon },
] as const

export default function WhySection() {
  const { t, i18n } = useTranslation()
  const sectionRef = useRef<HTMLElement>(null)
  const animation = useScrollAnimation(sectionRef)

  // Refs for card animations
  const painPointCardRefs = Array(painPoints.length).fill(null).map(() => useRef<HTMLDivElement>(null))

  return (
    <Section ref={sectionRef} id="why" className="relative" {...animation}>

      <HandRaisedIcon className="absolute left-8 top-1/2 -translate-y-1/2 size-40 text-red-400/5 pointer-events-none hidden xl:block" />
      <BoltIcon className="absolute right-8 top-1/2 -translate-y-1/2 size-40 text-primary/5 pointer-events-none hidden xl:block" />

      <div className="container mx-auto px-4">
        <SectionHeading
          icon={HandRaisedIcon}
          title={t('why.title')}
          subtitle={<p className="text-muted-foreground max-w-2xl mx-auto">{t('why.subtitle')}</p>}
        />

        <div className="max-w-3xl mx-auto">
          {painPoints.map(({ key, icon: Icon }, index) => (
            <motion.div
              key={key}
              ref={painPointCardRefs[index]}
              {...useMobileCardAnimation(painPointCardRefs[index], index)}
              className="md:transform-none w-full flex gap-6 mb-12 last:mb-0 group"
            >
              <div className="flex flex-col items-center gap-2 shrink-0">
                <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors duration-300">
                  <Icon className="size-6 text-primary" />
                </div>
                {index < painPoints.length - 1 && (
                  <div className="w-px flex-1 bg-border/40 mt-1" />
                )}
              </div>
              <div className="pb-12 last:pb-0">
                <h3 className="text-xl font-semibold mb-2 group-hover:text-primary transition-colors duration-300">
                  {t(`why.items.${key}.title`)}
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  {t(`why.items.${key}.description`)}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="text-center mt-16">
          <p className="text-xl font-semibold tracking-wide leading-loose">
            {t('why.ctaBefore')} <UnderlineHighlight key={i18n.language} type="circle">{t('why.ctaHighlight')}</UnderlineHighlight> {t('why.ctaAfter')}
          </p>
        </div>
      </div>
    </Section>
  )
}
