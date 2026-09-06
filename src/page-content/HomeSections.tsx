import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { motion, type HTMLMotionProps } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ProjectCard } from "@/components/ProjectCard"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  EnvelopeIcon,
  MapPinIcon,
  DevicePhoneMobileIcon,
  CheckIcon,
  ClockIcon,
  SparklesIcon,
  LightBulbIcon,
  BuildingStorefrontIcon,
  CursorArrowRaysIcon,
  ChatBubbleLeftRightIcon,
  UserIcon,
  WrenchScrewdriverIcon,
  CubeTransparentIcon,
  QuestionMarkCircleIcon,
  PhoneIcon,
  CalendarDaysIcon,
  GlobeAltIcon,
} from "@heroicons/react/24/outline"
const GitHubCalendarComponent = lazy(() => import("@/components/GitHubCalendar"))
import WhySection from "@/components/WhySection"
import ProcessSection from "@/components/ProcessSection"
import Testimonials from "@/components/Testimonials"
import { ContactChannels } from "@/components/ContactChannels"
import { trackEvent } from "@/lib/events"
import { useScrollAnimation, useMobileCardAnimation } from "@/lib/hooks"
import { projectItems, keyToSlug, type ProjectItem } from "@/lib/projects-data"
import { FacebookIcon, InstagramIcon, LinkedinIcon, GithubIcon, BriefcaseIcon } from "lucide-react"

interface HomeSectionsProps {
  lang: "en" | "el"
}

const HomeSections = ({ lang }: HomeSectionsProps) => {
  const { t } = useTranslation()
  const prefix = lang === "el" ? "/el" : ""
  // react-github-calendar breaks Node SSR during Astro's static build, so it's
  // only ever rendered client-side, and only once the About section scrolls
  // into view (it pulls in a separate JS chunk + external API fetch).
  const [showCalendar, setShowCalendar] = useState(false)

  // Refs for scroll animations
  const aboutRef = useRef<HTMLElement>(null)
  const servicesRef = useRef<HTMLElement>(null)
  const packagesRef = useRef<HTMLElement>(null)
  const projectsRef = useRef<HTMLElement>(null)
  const contactRef = useRef<HTMLElement>(null)
  
  // Refs for card animations
  const serviceCardRefs = Array(5).fill(null).map(() => useRef<HTMLDivElement>(null))
  const packageCardRefs = Array(3).fill(null).map(() => useRef<HTMLDivElement>(null))
  // A fixed slice, not a random one: this page is statically prerendered, so
  // Math.random() here would pick different projects at build time (server)
  // vs. hydration time (client) and break hydration every load.
  const featuredProjectItems: ProjectItem[] = projectItems.slice(0, 12)
  const projectCardRefs = Array(featuredProjectItems.length).fill(null).map(() => useRef<HTMLDivElement>(null))
  
  // Get animation props for each section
  const aboutAnimation = useScrollAnimation(aboutRef)
  useEffect(() => {
    const el = aboutRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShowCalendar(true)
          observer.disconnect()
        }
      },
      { rootMargin: "200px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const servicesAnimation = useScrollAnimation(servicesRef)
  const packagesAnimation = useScrollAnimation(packagesRef)
  const projectsAnimation = useScrollAnimation(projectsRef)
  const contactAnimation = useScrollAnimation(contactRef)
  
  const goToContact = (source: string, pkg?: string) => {
    trackEvent('ctaClick', { source, package: pkg ?? null })
    const params = new URLSearchParams({ source })
    const contactPath = window.location.pathname.startsWith('/el') ? '/el/contact' : '/contact'
    window.location.href = `${contactPath}?${params.toString()}`
  }

  return (
    <>
      {/* About Section */}
      <motion.section 
        ref={aboutRef}
        id="about" 
        className="py-20 bg-card/70 scroll-mt-10 overflow-hidden"
        {...(aboutAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-center">
              <UserIcon className="inline-block size-8 text-primary align-middle mr-2 -mt-1" />
              {t('about.title')}
            </h2>
            <Separator className="w-24 mx-auto" />
          </div>
          <div className="grid md:grid-cols-2 gap-12 items-start">
            <div>
              <h3 className="text-2xl font-semibold mb-4">{t('about.name')}</h3>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                {t('about.description1')}
              </p>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                {t('about.description2')}
              </p>
              <div className="flex flex-wrap gap-2 mb-8">
                <Badge variant="secondary">{t('common.badges.webApp')}</Badge>
                <Badge variant="secondary">{t('common.badges.mobileApp')}</Badge>
                <Badge variant="secondary">{t('common.badges.website')}</Badge>
                <Badge variant="secondary">{t('common.badges.ecommerce')}</Badge>
                <Badge variant="secondary">{t('common.badges.ai')}</Badge>
                <Badge variant="secondary">{t('common.badges.maps')}</Badge>
                <Badge variant="secondary">{t('common.badges.cloud')}</Badge>
                <Badge variant="secondary">{t('common.badges.crossPlatform')}</Badge>
                <Badge variant="secondary">{t('common.badges.payments')}</Badge>
                <Badge variant="secondary">{t('common.badges.education')}</Badge>
              </div>
            </div>
            <div className="space-y-8">
              <div className="relative">
                <div className="w-full h-84 rounded-lg overflow-hidden">
                  <img 
                    src="/images/pantelis.webp"
                    alt={t('about.name')}
                    width="600"
                    height="600"
                    loading="lazy"
                    className="w-full h-full object-cover object-center"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="overflow-hidden pt-16 w-full flex justify-center">
            {showCalendar && (
              <Suspense fallback={null}>
                <GitHubCalendarComponent username="stanimeros" />
              </Suspense>
            )}
          </div>
          <div className="overflow-hidden w-full flex justify-center">
            <p className="text-muted-foreground text-sm">
              {t('about.githubDescription')}
            </p>
          </div>
        </div>
      </motion.section>

      <WhySection />

      {/* Services Section */}
      <motion.section
        ref={servicesRef}
        id="services" 
        className="p-10 pb-20 scroll-mt-10 overflow-hidden"
        {...(servicesAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-center">
              <WrenchScrewdriverIcon className="inline-block size-8 text-primary align-middle mr-2 -mt-1" />
              {t('services.title')}
            </h2>
            <Separator className="w-24 mx-auto" />
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 w-full">
            {[
              {
                icon: <GlobeAltIcon className="size-8" />,
                title: 'services.website.title',
                description: 'services.website.description'
              },
              {
                icon: <DevicePhoneMobileIcon className="size-8" />,
                title: 'services.apps.title',
                description: 'services.apps.description'
              },
              {
                icon: <LightBulbIcon className="size-8" />,
                title: 'services.optimization.title',
                description: 'services.optimization.description'
              },
              {
                icon: <ChatBubbleLeftRightIcon className="size-8" />,
                title: 'services.aiAgent.title',
                description: 'services.aiAgent.description'
              }
            ].map((service, index) => (
              <motion.div
                key={index}
                ref={serviceCardRefs[index]}
                {...useMobileCardAnimation(serviceCardRefs[index], index)}
                className="md:transform-none w-full"
              >
                <Card className="hover:shadow-lg transition-all duration-300 hover:-translate-y-2 h-full flex flex-col bg-card/70 hover:bg-card/70">
                  <CardHeader className="text-center flex-none">
                    <div className="mx-auto mb-4 text-primary">
                      {service.icon}
                    </div>
                    <CardTitle>
                      {t(service.title)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-grow">
                    <CardDescription className="text-center">
                      {t(service.description)}
                    </CardDescription>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      <ProcessSection />

      {/* Packages Section */}
      <motion.section 
        ref={packagesRef}
        id="packages" 
        className="py-10 pb-20 scroll-mt-10 overflow-hidden"
        {...(packagesAnimation as HTMLMotionProps<"section">)}>
        <div className="mx-auto px-4 max-w-[1600px]">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-center">
              <CubeTransparentIcon className="inline-block size-8 text-primary align-middle mr-2 -mt-1" />
              {t('packages.title')}
            </h2>
            <p className="text-muted-foreground max-w-3xl mx-auto">
              {t('packages.subtitle')}
            </p>
            <Separator className="w-24 mx-auto mt-4" />
            <div className="inline-flex items-center gap-2 mt-5 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 text-primary font-medium text-sm">
              <ClockIcon className="size-4" />
              {t('packages.footer')}
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-8 w-full">
            {[
              {
                title: 'packages.website.title',
                description: 'packages.website.description',
                price: 'packages.website.price',
                priceNote: null,
                badge: 'common.badges.website',
                features: 'packages.website.features',
                className: 'border-border/60',
                icon: GlobeAltIcon,
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
                icon: BuildingStorefrontIcon,
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
                icon: SparklesIcon,
                ctaIcon: <SparklesIcon className="size-5 mr-2 stroke-[1.5]" />,
              },
            ].map((pkg, index) => (
              <motion.div
                key={index}
                ref={packageCardRefs[index]}
                {...useMobileCardAnimation(packageCardRefs[index], index)}
                className="md:transform-none w-full"
              >
                <Card className={`relative flex flex-col hover:shadow-lg transition-all duration-300 h-full bg-card/70 hover:bg-card/70 ${pkg.className}`}>
                  <CardHeader className="flex-none">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <pkg.icon className="size-6 text-primary shrink-0" />
                        <CardTitle>{t(pkg.title)}</CardTitle>
                      </div>
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
                    <Button
                      variant="green"
                      size="lg"
                      className="w-full px-8"
                      onClick={() => goToContact('package-button', t(pkg.title))}
                    >
                      {pkg.ctaIcon}
                      {t('packages.getStarted')}
                    </Button>
                  </div>
                </Card>
              </motion.div>
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
              <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center gap-3 shrink-0">
                <div className="text-lg font-semibold text-primary whitespace-nowrap">{t('packages.maintenance.price')}</div>
                <Button variant="outline" onClick={() => goToContact('maintenance-card')}>
                  <WrenchScrewdriverIcon className="size-5 mr-2 stroke-[1.5]" />
                  {t('packages.getStarted')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* FAQ Section */}
          <div className="mt-20">
            <h3 className="text-2xl font-semibold text-center mb-8">
              <QuestionMarkCircleIcon className="inline-block size-6 text-primary align-middle mr-1.5 -mt-1" />
              {t('packages.faq.title')}
            </h3>
            <Accordion type="single" collapsible className="w-full max-w-3xl mx-auto">
              <AccordionItem value="hiddenFees">
                <AccordionTrigger className="text-lg">{t('packages.faq.items.hiddenFees.question')}</AccordionTrigger>
                <AccordionContent>
                  {t('packages.faq.items.hiddenFees.answer')}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="payBeforeSeeing">
                <AccordionTrigger className="text-lg">{t('packages.faq.items.payBeforeSeeing.question')}</AccordionTrigger>
                <AccordionContent>
                  {t('packages.faq.items.payBeforeSeeing.answer')}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="timeToLaunch">
                <AccordionTrigger className="text-lg">{t('packages.faq.items.timeToLaunch.question')}</AccordionTrigger>
                <AccordionContent>
                  {t('packages.faq.items.timeToLaunch.answer')}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="ownership">
                <AccordionTrigger className="text-lg">{t('packages.faq.items.ownership.question')}</AccordionTrigger>
                <AccordionContent>
                  {t('packages.faq.items.ownership.answer')}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="noContent">
                <AccordionTrigger className="text-lg">{t('packages.faq.items.noContent.question')}</AccordionTrigger>
                <AccordionContent>
                  {t('packages.faq.items.noContent.answer')}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="technicalKnowledge">
                <AccordionTrigger className="text-lg">{t('packages.faq.items.technicalKnowledge.question')}</AccordionTrigger>
                <AccordionContent>
                  {t('packages.faq.items.technicalKnowledge.answer')}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="seo">
                <AccordionTrigger className="text-lg">{t('packages.faq.items.seo.question')}</AccordionTrigger>
                <AccordionContent>
                  {t('packages.faq.items.seo.answer')}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="aiAutomation">
                <AccordionTrigger className="text-lg">{t('packages.faq.items.aiAutomation.question')}</AccordionTrigger>
                <AccordionContent>
                  {t('packages.faq.items.aiAutomation.answer')}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="aiTrainingData">
                <AccordionTrigger className="text-lg">{t('packages.faq.items.aiTrainingData.question')}</AccordionTrigger>
                <AccordionContent>
                  {t('packages.faq.items.aiTrainingData.answer')}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="optimizationProblems">
                <AccordionTrigger className="text-lg">{t('packages.faq.items.optimizationProblems.question')}</AccordionTrigger>
                <AccordionContent>
                  {t('packages.faq.items.optimizationProblems.answer')}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </div>
      </motion.section>

      <Testimonials />

      {/* Projects Section */}
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
            <p className="text-muted-foreground max-w-2xl mx-auto">{t("projects.subtitle")}</p>
            <Separator className="w-24 mx-auto mt-4" />
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 w-full">
            {featuredProjectItems.map((item, index) => (
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

      {/* Contact Section */}
      <motion.section 
        ref={contactRef}
        id="contact" 
        className="py-20 scroll-mt-10 overflow-hidden"
        {...(contactAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-center">
              <PhoneIcon className="inline-block size-8 text-primary align-middle mr-2 -mt-1" />
              {t('contact.title')}
            </h2>
            <p className="text-foreground font-medium max-w-2xl mx-auto">
              {t('contact.description')}
            </p>
            <Separator className="w-24 mx-auto mt-4" />
          </div>
          <div className="flex flex-col items-center gap-12 max-w-3xl mx-auto">
            <div className="grid md:grid-cols-3 gap-4 w-full">
              <div className="flex items-start space-x-3 p-4 rounded-lg bg-card/70 border border-border/60">
                <div className="mt-1 shrink-0">
                  <ClockIcon className="size-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">{t('contact.features.consultation.title')}</h3>
                  <p className="text-sm text-muted-foreground">{t('contact.features.consultation.description')}</p>
                </div>
              </div>
              <div className="flex items-start space-x-3 p-4 rounded-lg bg-card/70 border border-border/60">
                <div className="mt-1 shrink-0">
                  <CursorArrowRaysIcon className="size-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">{t('contact.features.solutions.title')}</h3>
                  <p className="text-sm text-muted-foreground">{t('contact.features.solutions.description')}</p>
                </div>
              </div>
              <div className="flex items-start space-x-3 p-4 rounded-lg bg-card/70 border border-border/60">
                <div className="mt-1 shrink-0">
                  <SparklesIcon className="size-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">{t('contact.features.noObligations.title')}</h3>
                  <p className="text-sm text-muted-foreground">{t('contact.features.noObligations.description')}</p>
                </div>
              </div>
            </div>

            <Button
              variant="green"
              size="lg"
              className="!px-[100px]"
              onClick={() => goToContact('contact-section')}
            >
              <CalendarDaysIcon className="size-5 mr-2 stroke-[1.5]" />
              {t('contact.ctaButton')}
            </Button>

            <div className="flex flex-col items-center gap-4">
              <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm">
                <div className="flex items-center space-x-2">
                  <EnvelopeIcon className="size-4 text-primary" />
                  <a href="mailto:hello@stanimeros.com" className="hover:text-primary transition-colors">
                    hello@stanimeros.com
                  </a>
                </div>
                <div className="flex items-center space-x-2">
                  <MapPinIcon className="size-4 text-primary" />
                  <span>{t('common.location')}</span>
                </div>
              </div>
              <ContactChannels hideEmail className="flex flex-wrap justify-center gap-3" />
              <div className="flex space-x-3">
                <a href="https://linkedin.com/in/stanimeros" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
                  <Button variant="outline" size="icon" aria-hidden="true" tabIndex={-1}>
                    <LinkedinIcon className="size-5" />
                  </Button>
                </a>
                <a href="https://www.facebook.com/stanimeros.dev" target="_blank" rel="noopener noreferrer" aria-label="Facebook">
                  <Button variant="outline" size="icon" aria-hidden="true" tabIndex={-1}>
                    <FacebookIcon className="size-5" />
                  </Button>
                </a>
                <a href="https://www.instagram.com/stanimeros_dev" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                  <Button variant="outline" size="icon" aria-hidden="true" tabIndex={-1}>
                    <InstagramIcon className="size-5" />
                  </Button>
                </a>
                <a href="https://github.com/stanimeros" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
                  <Button variant="outline" size="icon" aria-hidden="true" tabIndex={-1}>
                    <GithubIcon className="size-5" />
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </div>
      </motion.section>
    </>
  )
}

export default HomeSections