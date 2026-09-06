import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Section, SectionHeading, MutedLink } from "@/components/ui/section"
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
      <Section ref={heroRef} {...heroAnimation}>
        <div className="container mx-auto px-4">
          <SectionHeading
            as="h1"
            icon={BriefcaseIcon}
            title={t("projects.title")}
            wrapperClassName="max-w-3xl mx-auto text-center"
            subtitle={<p className="text-xl text-muted-foreground">{t("projectsPage.intro")}</p>}
          />
        </div>
      </Section>

      {/* All projects */}
      <Section ref={gridRef} shaded {...gridAnimation}>
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
      </Section>

      {/* CTA */}
      <Section ref={ctaRef} {...ctaAnimation}>
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
              <MutedLink href={`${prefix}/about`}>
                {t("servicesPage.links.about")}
              </MutedLink>
              <MutedLink href={`${prefix}/services`}>
                {t("servicesPage.title")}
              </MutedLink>
            </div>
          </div>
        </div>
      </Section>
    </>
  )
}
