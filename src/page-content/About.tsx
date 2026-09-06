import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { motion, type HTMLMotionProps } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ProjectCard } from "@/components/ProjectCard"
import ProcessSection from "@/components/ProcessSection"
import Testimonials from "@/components/Testimonials"
import {
  UserIcon,
  AcademicCapIcon,
  LightBulbIcon,
  HandRaisedIcon,
  BriefcaseIcon,
  PhoneIcon,
} from "@heroicons/react/24/outline"
import { trackEvent } from "@/lib/events"
import { useScrollAnimation, useMobileCardAnimation } from "@/lib/hooks"
import GitHubCalendarComponent from "@/components/GitHubCalendar"
import { projectItems, keyToSlug } from "@/lib/projects-data"

const sections = [
  { key: "background", icon: AcademicCapIcon },
  { key: "problems", icon: LightBulbIcon },
  { key: "whyWorkWithMe", icon: HandRaisedIcon },
] as const

const skillBadges = [
  "webApp", "mobileApp", "website", "ecommerce", "ai",
  "maps", "cloud", "crossPlatform", "payments", "education",
]

const exampleKeys = ['fireMessage', 'hedeos', 'transHellas', 'atproPartner']
const examples = projectItems.filter((item) => exampleKeys.includes(item.key))

interface AboutProps {
  lang: "en" | "el"
}

export default function About({ lang }: AboutProps) {
  const { t } = useTranslation()
  const prefix = lang === "el" ? "/el" : ""
  // react-github-calendar breaks Node SSR during Astro's static build, so it's
  // only ever rendered client-side after mount.
  const [isMounted, setIsMounted] = useState(false)
  useEffect(() => setIsMounted(true), [])

  const heroRef = useRef<HTMLElement>(null)
  const sectionsRef = useRef<HTMLElement>(null)
  const githubRef = useRef<HTMLElement>(null)
  const projectsRef = useRef<HTMLElement>(null)
  const ctaRef = useRef<HTMLElement>(null)

  // Refs for card animations
  const sectionCardRefs = Array(sections.length).fill(null).map(() => useRef<HTMLDivElement>(null))
  const exampleCardRefs = Array(examples.length).fill(null).map(() => useRef<HTMLDivElement>(null))

  const heroAnimation = useScrollAnimation(heroRef)
  const sectionsAnimation = useScrollAnimation(sectionsRef)
  const githubAnimation = useScrollAnimation(githubRef)
  const projectsAnimation = useScrollAnimation(projectsRef)
  const ctaAnimation = useScrollAnimation(ctaRef)

  useEffect(() => {
    trackEvent("pageView", { page: "about" })
  }, [])

  return (
    <>
      {/* Hero Section */}
      <motion.section
        ref={heroRef}
        className="py-20 scroll-mt-10 overflow-hidden"
        {...(heroAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 text-center">
              <UserIcon className="inline-block size-8 text-primary align-middle mr-2 -mt-1" />
              {t("aboutPage.title")}
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">{t("aboutPage.intro")}</p>
            <Separator className="w-24 mx-auto mt-4" />
          </div>

          <div className="grid md:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
            <div>
              <div className="w-full h-84 rounded-lg overflow-hidden">
                <img
                  src="/images/pantelis.webp"
                  alt={t("about.name")}
                  width="600"
                  height="600"
                  loading="eager"
                  className="w-full h-full object-cover object-center"
                />
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-semibold mb-4">{t("about.name")}</h2>
              <p className="text-muted-foreground mb-6 leading-relaxed">{t("about.description1")}</p>
              <p className="text-muted-foreground mb-6 leading-relaxed">{t("about.description2")}</p>
              <div className="flex flex-wrap gap-2">
                {skillBadges.map((badge) => (
                  <Badge key={badge} variant="secondary">{t(`common.badges.${badge}`)}</Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* Background / Problems / Why Work With Me */}
      <motion.section
        ref={sectionsRef}
        className="py-20 bg-card/70 scroll-mt-10 overflow-hidden"
        {...(sectionsAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-6 w-full">
            {sections.map(({ key, icon: Icon }, index) => (
              <motion.div
                key={key}
                ref={sectionCardRefs[index]}
                {...useMobileCardAnimation(sectionCardRefs[index], index)}
                className="md:transform-none w-full"
              >
                <Card className="hover:shadow-lg transition-all duration-300 hover:-translate-y-2 h-full flex flex-col bg-card/70 hover:bg-card/70">
                  <CardHeader className="flex-none">
                    <div className="p-2 rounded-lg bg-primary/10 w-fit mb-2">
                      <Icon className="size-6 text-primary" />
                    </div>
                    <h2 className="text-xl font-semibold">{t(`aboutPage.${key}.title`)}</h2>
                  </CardHeader>
                  <CardContent className="flex-grow">
                    <p className="text-muted-foreground leading-relaxed">{t(`aboutPage.${key}.paragraph`)}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* GitHub activity */}
      <motion.section
        ref={githubRef}
        className="py-20 scroll-mt-10 overflow-hidden"
        {...(githubAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <div className="overflow-hidden w-full flex justify-center">
            {isMounted && <GitHubCalendarComponent username="stanimeros" />}
          </div>
          <div className="overflow-hidden w-full flex justify-center mt-4">
            <p className="text-muted-foreground text-sm">{t('about.githubDescription')}</p>
          </div>
        </div>
      </motion.section>

      <Testimonials />

      <ProcessSection />

      {/* Example projects */}
      <motion.section
        ref={projectsRef}
        className="py-20 bg-card/70 scroll-mt-10 overflow-hidden"
        {...(projectsAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-center">
              <BriefcaseIcon className="inline-block size-8 text-primary align-middle mr-2 -mt-1" />
              {t("projects.title")}
            </h2>
            <Separator className="w-24 mx-auto" />
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 w-full">
            {examples.map((item, index) => (
              <motion.div
                key={item.key}
                ref={exampleCardRefs[index]}
                {...useMobileCardAnimation(exampleCardRefs[index], index)}
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
                />
              </motion.div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Button variant="outline" asChild>
              <a href={`${prefix}/projects`}>
                <BriefcaseIcon className="size-5 mr-2 stroke-[1.5]" />
                {t("servicesPage.links.projects")}
              </a>
            </Button>
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
            <h2 className="text-3xl font-bold mb-3">{t("aboutPage.cta.title")}</h2>
            <p className="text-foreground font-medium mb-8">{t("aboutPage.cta.description")}</p>
            <Button variant="green" size="lg" asChild className="mb-10">
              <a href={`${prefix}/contact`}>
                <PhoneIcon className="size-5 mr-2 stroke-[1.5]" />
                {t("aboutPage.cta.button")}
              </a>
            </Button>

            <div className="flex justify-center gap-6 text-sm">
              <a href={`${prefix}/services`} className="text-muted-foreground hover:text-primary transition-colors">
                {t("aboutPage.links.services")}
              </a>
              <a href={`${prefix}/contact`} className="text-muted-foreground hover:text-primary transition-colors">
                {t("aboutPage.links.contact")}
              </a>
            </div>
          </div>
        </div>
      </motion.section>
    </>
  )
}
