import { useRef } from "react"
import { motion, type HTMLMotionProps } from "framer-motion"
import { useTranslation } from "react-i18next"
import { Separator } from "@/components/ui/separator"
import { useScrollAnimation } from "@/lib/hooks"
import {
  ListBulletIcon,
  PhoneArrowUpRightIcon,
  DocumentTextIcon,
  CodeBracketIcon,
  RocketLaunchIcon,
} from "@heroicons/react/24/outline"

const steps = [
  { key: "call",   icon: PhoneArrowUpRightIcon },
  { key: "quote",  icon: DocumentTextIcon },
  { key: "build",  icon: CodeBracketIcon },
  { key: "launch", icon: RocketLaunchIcon },
] as const

export default function ProcessSection() {
  const { t } = useTranslation()
  const sectionRef = useRef<HTMLElement>(null)
  const animation = useScrollAnimation(sectionRef)

  return (
    <motion.section
      ref={sectionRef}
      id="process"
      className="py-20 scroll-mt-10 overflow-hidden"
      {...(animation as HTMLMotionProps<"section">)}>

      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4 text-center">
            <ListBulletIcon className="inline-block size-8 text-primary align-middle mr-2 -mt-1" />
            {t('process.title')}
          </h2>
          <Separator className="w-24 mx-auto mb-4" />
          <p className="text-muted-foreground max-w-2xl mx-auto">{t('process.subtitle')}</p>
        </div>

        <div className="max-w-3xl mx-auto">
          {steps.map(({ key, icon: Icon }, index) => (
            <div key={key} className="flex gap-6 mb-12 last:mb-0 group">
              <div className="flex flex-col items-center gap-2 shrink-0">
                <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors duration-300">
                  <Icon className="size-6 text-primary" />
                </div>
                {index < steps.length - 1 && (
                  <div className="w-px flex-1 bg-border/40 mt-1" />
                )}
              </div>
              <div className="pb-12 last:pb-0">
                <h3 className="text-xl font-semibold mb-2 group-hover:text-primary transition-colors duration-300">
                  {t(`process.steps.${key}.title`)}
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  {t(`process.steps.${key}.description`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  )
}
