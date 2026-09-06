import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { motion, type HTMLMotionProps } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ProjectCard } from "@/components/ProjectCard"
import { BriefcaseIcon, PhoneIcon } from "@heroicons/react/24/outline"
import { trackEvent } from "@/lib/events"
import { useScrollAnimation, useMobileCardAnimation } from "@/lib/hooks"
import { projectItems, keyToSlug } from "@/lib/projects-data"

interface ProjectsProps {
  lang: "en" | "el"
}

export default function Projects({ lang }: ProjectsProps) {
  const { t } = useTranslation()
  const prefix = lang === "el" ? "/el" : ""

  const heroRef = useRef<HTMLElement>(null)
  const gridRef = useRef<HTMLElement>(null)
  const ctaRef = useRef<HTMLElement>(null)

  // Refs for card animations
  const projectCardRefs = Array(projectItems.length).fill(null).map(() => useRef<HTMLDivElement>(null))

  const heroAnimation = useScrollAnimation(heroRef)
  const gridAnimation = useScrollAnimation(gridRef)
  const ctaAnimation = useScrollAnimation(ctaRef)

  useEffect(() => {
    trackEvent("pageView", { page: "projects" })
  }, [])

  return (
    <>
      {/* Hero */}
      <motion.section
        ref={heroRef}
        className="py-20 scroll-mt-10 overflow-hidden"
        {...(heroAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 text-center">
              <BriefcaseIcon className="inline-block size-8 text-primary align-middle mr-2 -mt-1" />
              {t("projects.title")}
            </h1>
            <p className="text-xl text-muted-foreground">{t("projectsPage.intro")}</p>
            <Separator className="w-24 mx-auto mt-4" />
          </div>
        </div>
      </motion.section>

      {/* All projects */}
      <motion.section
        ref={gridRef}
        className="py-20 bg-card/70 scroll-mt-10 overflow-hidden"
        {...(gridAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 w-full">
            {projectItems.map((item, index) => (
              <motion.div
                key={item.key}
                ref={projectCardRefs[index]}
                {...useMobileCardAnimation(projectCardRefs[index], index)}
                className="md:transform-none w-full"
              >
                <ProjectCard
                  title={t(`projects.items.${item.key}.title`)}
                  description={t(`projects.items.${item.key}.description`)}
                  technologies={item.technologies}
                  bgColor={item.bgColor}
                  textColor={item.textColor}
                  bgImage={item.bgImage}
                  logo={item.logo}
                  logoBg={item.logoBg}
                  url={item.url}
                  caseStudyHref={`${prefix}/projects/${keyToSlug(item.key)}`}
                  storeLinks={item.storeLinks}
                />
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* CTA */}
      <motion.section
        ref={ctaRef}
        className="py-20 scroll-mt-10 overflow-hidden"
        {...(ctaAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold mb-3">{t("projectsPage.cta.title")}</h2>
            <p className="text-foreground font-medium mb-8">{t("projectsPage.cta.description")}</p>
            <Button variant="green" size="lg" asChild className="mb-10">
              <a href={`${prefix}/contact?source=projects`}>
                <PhoneIcon className="size-5 mr-2 stroke-[1.5]" />
                {t("projectsPage.cta.button")}
              </a>
            </Button>

            <div className="flex justify-center gap-6 text-sm">
              <a href={`${prefix}/about`} className="text-muted-foreground hover:text-primary transition-colors">
                {t("servicesPage.links.about")}
              </a>
              <a href={`${prefix}/services`} className="text-muted-foreground hover:text-primary transition-colors">
                {t("servicesPage.title")}
              </a>
            </div>
          </div>
        </div>
      </motion.section>
    </>
  )
}
