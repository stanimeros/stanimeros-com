import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { motion, type HTMLMotionProps } from "framer-motion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import ProcessSection from "@/components/ProcessSection"
import Testimonials from "@/components/Testimonials"
import { ProjectCard } from "@/components/ProjectCard"
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  PhoneIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline"
import { cn } from "@/lib/utils"
import { trackEvent } from "@/lib/events"
import { useScrollAnimation, useMobileCardAnimation } from "@/lib/hooks"
import { getProjectBySlug, projectItems, keyToSlug } from "@/lib/projects-data"

interface ProjectDetailProps {
  lang: "en" | "el"
  slug: string
}

export default function ProjectDetail({ lang, slug }: ProjectDetailProps) {
  const { t } = useTranslation()
  const prefix = lang === "el" ? "/el" : ""
  const item = getProjectBySlug(slug)

  const relatedRef = useRef<HTMLElement>(null)
  const ctaRef = useRef<HTMLElement>(null)
  const relatedAnimation = useScrollAnimation(relatedRef)
  const ctaAnimation = useScrollAnimation(ctaRef)

  // Refs for card animations. Fixed size (3) since `related` below is always
  // sliced from this many candidates at most — computed before any early
  // return so hook count never varies across renders.
  const relatedCardRefs = Array(3).fill(null).map(() => useRef<HTMLDivElement>(null))

  useEffect(() => {
    trackEvent("pageView", { page: `projects/${slug}` })
  }, [slug])

  if (!item) return null

  const title = t(`projects.items.${item.key}.title`)
  const fromWords = title
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
  const initials =
    fromWords.length >= 2
      ? fromWords.slice(0, 2)
      : (title.replace(/\s/g, "").slice(0, 2).toUpperCase() || "??").padEnd(2, "?")

  const currentIndex = projectItems.findIndex((p) => p.key === item.key)
  const related = Array.from({ length: 3 }, (_, i) => {
    const index = (currentIndex + 1 + i) % projectItems.length
    return projectItems[index]
  }).filter((p) => p.key !== item.key)

  return (
    <>
      <section className="py-20 scroll-mt-10 overflow-hidden">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <a
              href={`${prefix}/projects`}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-6"
            >
              <ArrowLeftIcon className="size-4" />
              {t("servicesPage.links.projects")}
            </a>

            <div className="flex items-center gap-4 mb-4">
              <div
                className={cn(
                  "size-16 rounded-full flex items-center justify-center text-xl font-bold shrink-0",
                  "border-2 border-border/60 shadow-lg",
                  item.logoBg ? item.logoBg : "bg-white/95 dark:bg-white/10 backdrop-blur-sm",
                  !item.logo && !item.logoBg && item.textColor
                )}
              >
                {item.logo ? (
                  <img
                    src={item.logo}
                    alt={title}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
              <h1 className="text-4xl md:text-5xl font-bold">{title}</h1>
            </div>
            <Separator className="w-24 mb-4" />
            <p className="text-xl text-muted-foreground mb-6">
              {t(`projects.items.${item.key}.description`)}
            </p>

            <div className="flex flex-wrap gap-2 mb-8">
              {item.technologies.map((tech) => (
                <Badge key={tech} variant="outline">
                  {tech}
                </Badge>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 mb-10">
              {item.url && (
                <Button variant="outline" asChild>
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    <ArrowTopRightOnSquareIcon className="size-5 mr-2 stroke-[1.5]" />
                    {t("projectDetail.visitProject")}
                  </a>
                </Button>
              )}
              <Button variant="green" asChild>
                <a href={`${prefix}/contact?source=projects-${slug}`}>
                  <PhoneIcon className="size-5 mr-2 stroke-[1.5]" />
                  {t("projectDetail.cta")}
                </a>
              </Button>
            </div>

            <Separator className="mb-10" />

            <p className="text-muted-foreground leading-relaxed mb-8">
              {t(`projects.items.${item.key}.overview`)}
            </p>

            <div className="grid sm:grid-cols-2 gap-3">
              {(t(`projects.items.${item.key}.highlights`, { returnObjects: true }) as string[]).map(
                (highlight, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <CheckIcon className="size-4 text-primary mt-1 shrink-0" />
                    <span className="text-sm">{highlight}</span>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </section>

      <ProcessSection />

      <Testimonials />

      {related.length > 0 && (
        <motion.section
          ref={relatedRef}
          className="py-20 bg-card/70 scroll-mt-10 overflow-hidden"
          {...(relatedAnimation as HTMLMotionProps<"section">)}>
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold mb-4 text-center">
                <Squares2X2Icon className="inline-block size-8 text-primary align-middle mr-2 -mt-1" />
                {t("projectDetail.relatedTitle")}
              </h2>
              <Separator className="w-24 mx-auto" />
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
              {related.map((relatedItem, index) => (
                <motion.div
                  key={relatedItem.key}
                  ref={relatedCardRefs[index]}
                  {...useMobileCardAnimation(relatedCardRefs[index], index)}
                  className="md:transform-none w-full"
                >
                  <ProjectCard
                    title={t(`projects.items.${relatedItem.key}.title`)}
                    description={t(`projects.items.${relatedItem.key}.description`)}
                    technologies={relatedItem.technologies}
                    bgColor={relatedItem.bgColor}
                    textColor={relatedItem.textColor}
                    bgImage={relatedItem.bgImage}
                    logo={relatedItem.logo}
                    logoBg={relatedItem.logoBg}
                    url={relatedItem.url}
                    caseStudyHref={`${prefix}/projects/${keyToSlug(relatedItem.key)}`}
                    storeLinks={relatedItem.storeLinks}
                  />
                </motion.div>
              ))}
            </div>
            <div className="text-center mt-10">
              <a
                href={`${prefix}/projects`}
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                {t("servicesPage.links.projects")}
              </a>
            </div>
          </div>
        </motion.section>
      )}

      {/* CTA */}
      <motion.section
        ref={ctaRef}
        className="py-20 scroll-mt-10 overflow-hidden"
        {...(ctaAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold mb-3">{t("projectDetail.ctaSection.title")}</h2>
            <p className="text-muted-foreground mb-8">{t("projectDetail.ctaSection.description")}</p>
            <Button variant="green" size="lg" asChild className="mb-10">
              <a href={`${prefix}/contact?source=projects-${slug}-bottom`}>
                <PhoneIcon className="size-5 mr-2 stroke-[1.5]" />
                {t("projectDetail.cta")}
              </a>
            </Button>

            <div className="flex justify-center gap-6 text-sm">
              <a href={`${prefix}/about`} className="text-muted-foreground hover:text-primary transition-colors">
                {t("servicesPage.links.about")}
              </a>
              <a href={`${prefix}/projects`} className="text-muted-foreground hover:text-primary transition-colors">
                {t("servicesPage.links.projects")}
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
