import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { motion, type HTMLMotionProps } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { ProjectCard } from "@/components/ProjectCard"
import ProcessSection from "@/components/ProcessSection"
import Testimonials from "@/components/Testimonials"
import {
  WrenchScrewdriverIcon,
  SparklesIcon,
  DevicePhoneMobileIcon,
  PuzzlePieceIcon,
  CircleStackIcon,
  CheckIcon,
  CubeTransparentIcon,
  BriefcaseIcon,
  BuildingStorefrontIcon,
  PhoneIcon,
  GlobeAltIcon,
  ClockIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline"
import { trackEvent } from "@/lib/events"
import { useScrollAnimation } from "@/lib/hooks"
import { projectItems, keyToSlug } from "@/lib/projects-data"

const items = [
  { key: "website", icon: GlobeAltIcon },
  { key: "apps", icon: DevicePhoneMobileIcon },
  { key: "optimization", icon: PuzzlePieceIcon },
  { key: "aiData", icon: CircleStackIcon },
] as const

const faqItems = [
  "hiddenFees",
  "payBeforeSeeing",
  "timeToLaunch",
  "ownership",
  "noContent",
  "technicalKnowledge",
  "seo",
  "aiAutomation",
  "aiTrainingData",
  "optimizationProblems",
] as const

const packages = [
  {
    title: 'packages.website.title',
    description: 'packages.website.description',
    price: 'packages.website.price',
    priceNote: null,
    badge: 'common.badges.website',
    features: 'packages.website.features',
    className: 'border-border/60',
    ctaIcon: <GlobeAltIcon className="size-5 mr-2 stroke-[1.5]" />,
  },
  {
    title: 'packages.eShop.title',
    description: 'packages.eShop.description',
    price: 'packages.eShop.price',
    priceNote: 'packages.eShop.priceNote',
    badge: 'common.badges.development',
    features: 'packages.eShop.features',
    className: 'border-primary/30 ring-1 ring-primary/30 bg-primary/5',
    ctaIcon: <BuildingStorefrontIcon className="size-5 mr-2 stroke-[1.5]" />,
  },
  {
    title: 'packages.onlinePresence.title',
    description: 'packages.onlinePresence.description',
    price: 'packages.onlinePresence.price',
    priceNote: null,
    badge: 'common.badges.ai',
    features: 'packages.onlinePresence.features',
    className: 'border-border/60',
    ctaIcon: <SparklesIcon className="size-5 mr-2 stroke-[1.5]" />,
  },
] as const

interface ServicesProps {
  lang: "en" | "el"
}

export default function Services({ lang }: ServicesProps) {
  const { t } = useTranslation()
  const prefix = lang === "el" ? "/el" : ""

  const heroRef = useRef<HTMLElement>(null)
  const itemsRef = useRef<HTMLElement>(null)
  const packagesRef = useRef<HTMLElement>(null)
  const faqRef = useRef<HTMLElement>(null)
  const projectsRef = useRef<HTMLElement>(null)
  const ctaRef = useRef<HTMLElement>(null)

  const heroAnimation = useScrollAnimation(heroRef)
  const itemsAnimation = useScrollAnimation(itemsRef)
  const packagesAnimation = useScrollAnimation(packagesRef)
  const faqAnimation = useScrollAnimation(faqRef)
  const projectsAnimation = useScrollAnimation(projectsRef)
  const ctaAnimation = useScrollAnimation(ctaRef)

  useEffect(() => {
    trackEvent("pageView", { page: "services" })
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
              <WrenchScrewdriverIcon className="inline-block size-8 text-primary align-middle mr-2 -mt-1" />
              {t("servicesPage.title")}
            </h1>
            <Separator className="w-24 mx-auto mb-4" />
            <p className="text-xl text-muted-foreground">{t("servicesPage.intro")}</p>
          </div>
        </div>
      </motion.section>

      {/* What I do */}
      <motion.section
        ref={itemsRef}
        className="py-20 bg-card/70 scroll-mt-10 overflow-hidden"
        {...(itemsAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 w-full">
            {items.map(({ key, icon: Icon }) => (
              <Card
                key={key}
                className="hover:shadow-lg transition-all duration-300 hover:-translate-y-2 h-full flex flex-col bg-card/70 hover:bg-card/70"
              >
                <CardHeader className="text-center flex-none">
                  <div className="mx-auto mb-4 text-primary">
                    <Icon className="size-8" />
                  </div>
                  <CardTitle>{t(`servicesPage.items.${key}.title`)}</CardTitle>
                </CardHeader>
                <CardContent className="flex-grow">
                  <CardDescription className="text-center leading-relaxed">
                    {t(`servicesPage.items.${key}.description`)}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </motion.section>

      {/* Packages */}
      <motion.section
        ref={packagesRef}
        className="py-20 scroll-mt-10 overflow-hidden"
        {...(packagesAnimation as HTMLMotionProps<"section">)}>
        <div className="mx-auto px-4 max-w-[1600px]">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-center">
              <CubeTransparentIcon className="inline-block size-8 text-primary align-middle mr-2 -mt-1" />
              {t('packages.title')}
            </h2>
            <Separator className="w-24 mx-auto mb-4" />
            <p className="text-muted-foreground max-w-3xl mx-auto">{t('packages.subtitle')}</p>
            <div className="inline-flex items-center gap-2 mt-5 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 text-primary font-medium text-sm">
              <ClockIcon className="size-4" />
              {t('packages.footer')}
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-8 w-full">
            {packages.map((pkg) => (
              <Card
                key={pkg.title}
                className={`relative flex flex-col hover:shadow-lg transition-all duration-300 h-full bg-card/70 hover:bg-card/70 ${pkg.className}`}
              >
                <CardHeader className="flex-none">
                  <div className="flex items-center justify-between">
                    <CardTitle>{t(pkg.title)}</CardTitle>
                    <Badge variant="secondary" className="rounded-full">{t(pkg.badge)}</Badge>
                  </div>
                  <CardDescription>{t(pkg.description)}</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow space-y-4">
                  <div>
                    <div className="text-lg font-semibold text-primary">{t(pkg.price)}</div>
                    {pkg.priceNote && (
                      <div className="text-xs text-muted-foreground">{t(pkg.priceNote)}</div>
                    )}
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    {(t(pkg.features, { returnObjects: true }) as string[]).map((feature, featureIndex) => (
                      <div key={featureIndex} className="flex items-start gap-2">
                        <CheckIcon className="size-4 text-primary mt-0.5" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
                <div className="px-6 pb-6 mt-auto">
                  <Button variant="green" size="lg" className="w-full px-8" asChild>
                    <a href={`${prefix}/contact?source=services-package`}>
                      {pkg.ctaIcon}
                      {t('packages.getStarted')}
                    </a>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
          <Card className="mt-8 border-border/60 bg-card/70 w-full">
            <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <WrenchScrewdriverIcon className="size-6 text-primary shrink-0" />
                  <CardTitle>{t('packages.maintenance.title')}</CardTitle>
                </div>
                <CardDescription>{t('packages.maintenance.description')}</CardDescription>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-sm text-muted-foreground">
                  {(t('packages.maintenance.features', { returnObjects: true }) as string[]).map((feature, featureIndex) => (
                    <span key={featureIndex} className="flex items-center gap-1.5">
                      <CheckIcon className="size-4 text-primary" />
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col md:items-end gap-3 w-full md:w-auto shrink-0">
                <div className="text-lg font-semibold text-primary">{t('packages.maintenance.price')}</div>
                <Button variant="outline" className="w-full md:w-auto" asChild>
                  <a href={`${prefix}/contact?source=services-maintenance`}>
                    <WrenchScrewdriverIcon className="size-5 mr-2 stroke-[1.5]" />
                    {t('packages.getStarted')}
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.section>

      {/* FAQ */}
      <motion.section
        ref={faqRef}
        className="pb-20 scroll-mt-10 overflow-hidden"
        {...(faqAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <h2 className="text-2xl font-semibold text-center mb-8">
            <QuestionMarkCircleIcon className="inline-block size-6 text-primary align-middle mr-1.5 -mt-1" />
            {t('packages.faq.title')}
          </h2>
          <Accordion type="single" collapsible className="w-full max-w-3xl mx-auto">
            {faqItems.map((key) => (
              <AccordionItem key={key} value={key}>
                <AccordionTrigger className="text-lg">{t(`packages.faq.items.${key}.question`)}</AccordionTrigger>
                <AccordionContent>{t(`packages.faq.items.${key}.answer`)}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </motion.section>

      <Testimonials />

      <ProcessSection />

      {/* All projects */}
      <motion.section
        id="projects"
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
            {projectItems.map((item) => (
              <ProjectCard
                key={item.key}
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
            <h2 className="text-3xl font-bold mb-3">{t("servicesPage.cta.title")}</h2>
            <p className="text-foreground font-medium mb-8">{t("servicesPage.cta.description")}</p>
            <Button variant="green" size="lg" asChild className="mb-10">
              <a href={`${prefix}/contact`}>
                <PhoneIcon className="size-5 mr-2 stroke-[1.5]" />
                {t("servicesPage.cta.button")}
              </a>
            </Button>

            <div className="flex justify-center gap-6 text-sm">
              <a href={`${prefix}/about`} className="text-muted-foreground hover:text-primary transition-colors">
                {t("servicesPage.links.about")}
              </a>
              <a href={`${prefix}/contact`} className="text-muted-foreground hover:text-primary transition-colors">
                {t("servicesPage.links.contact")}
              </a>
            </div>
          </div>
        </div>
      </motion.section>
    </>
  )
}
