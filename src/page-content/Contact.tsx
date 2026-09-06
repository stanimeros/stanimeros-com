import { useState, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { motion, type HTMLMotionProps } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { ContactChannels } from "@/components/ContactChannels"
import {
  PhoneIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  ClockIcon,
  CursorArrowRaysIcon,
  SparklesIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline"
import { sendEmail } from "@/lib/firebase"
import { trackEvent } from "@/lib/events"
import { useScrollAnimation } from "@/lib/hooks"

const trustFeatures = [
  { key: "consultation", icon: ClockIcon },
  { key: "solutions", icon: CursorArrowRaysIcon },
  { key: "noObligations", icon: SparklesIcon },
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

export default function Contact() {
  const { t } = useTranslation()
  const [searchParams] = useState(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams()
  )
  const source = searchParams.get("source") ?? "contact-page"

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle")

  const heroRef = useRef<HTMLElement>(null)
  const formRef = useRef<HTMLElement>(null)
  const faqRef = useRef<HTMLElement>(null)

  const heroAnimation = useScrollAnimation(heroRef)
  const formAnimation = useScrollAnimation(formRef)
  const faqAnimation = useScrollAnimation(faqRef)

  useEffect(() => {
    trackEvent('pageView', {
      page: 'contact',
      source,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return
    setIsSubmitting(true)
    setStatus("idle")

    const lines = [
      `Source: ${source}`,
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      ...(phone ? [`Phone: ${phone}`] : []),
    ]

    try {
      await sendEmail({
        subject: "Free Strategy Call Request",
        name,
        email,
        message: lines.join("\n"),
      })

      trackEvent('beginCheckout', {
        package: source,
        value: 0,
        currency: 'EUR',
      })

      setStatus("success")
    } catch {
      setStatus("error")
      setTimeout(() => setStatus("idle"), 5000)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {/* Hero + trust features */}
      <motion.section
        ref={heroRef}
        className="pt-20 pb-8 scroll-mt-10 overflow-hidden"
        {...(heroAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <div className="text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 text-center">
              <PhoneIcon className="inline-block size-8 text-primary align-middle mr-2 -mt-1" />
              {t('contact.title')}
            </h1>
            <Separator className="w-24 mx-auto mb-4" />
            <p className="text-foreground font-medium max-w-2xl mx-auto">{t('contact.form.description')}</p>
          </div>
        </div>
      </motion.section>

      {/* Form */}
      <motion.section
        ref={formRef}
        className="pb-20 scroll-mt-10 overflow-hidden"
        {...(formAnimation as HTMLMotionProps<"section">)}>
        <div className="container mx-auto px-4">
          <div className="text-center mb-10">
            <p className="text-sm text-muted-foreground mb-3">{t('contact.channels.title')}</p>
            <ContactChannels className="flex flex-wrap justify-center gap-3" />
          </div>

          {status === "success" ? (
            <div className="text-center space-y-4 max-w-lg mx-auto">
              <CheckCircleIcon className="size-16 text-green-400 mx-auto" />
              <h2 className="text-3xl font-bold">{t('contact.title')}</h2>
              <p className="text-muted-foreground">{t('contact.form.success')}</p>
            </div>
          ) : (
            <div className="max-w-lg mx-auto rounded-xl border border-border/60 bg-card/70 p-8">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="name">{t('contact.form.name')}</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={t('contact.form.namePlaceholder')}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">{t('contact.form.email')}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={t('contact.form.emailPlaceholder')}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">{t('getStarted.contactDetails.phone')}</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+30 69X XXX XXXX"
                  />
                </div>

                {status === "error" && (
                  <div className="p-3 bg-red-950/30 border border-red-800/50 text-red-300 rounded text-sm">
                    {t('contact.form.error')}
                  </div>
                )}

                <Button
                  type="submit"
                  variant="green"
                  size="lg"
                  disabled={isSubmitting}
                  className="w-full"
                >
                  {isSubmitting ? (
                    <>
                      <div className="animate-spin rounded-full size-5 border-b-2 border-white mr-2" />
                      {t('contact.form.sending')}
                    </>
                  ) : (
                    <>
                      <PaperAirplaneIcon className="size-5 mr-2" />
                      {t('contact.form.send')}
                    </>
                  )}
                </Button>
              </form>
            </div>
          )}

          <div className="grid sm:grid-cols-3 gap-4 max-w-4xl mx-auto mt-16">
            {trustFeatures.map(({ key, icon: Icon }) => (
              <div
                key={key}
                className="flex items-start space-x-3 p-4 rounded-lg bg-card/70 border border-border/60"
              >
                <div className="mt-1 shrink-0">
                  <Icon className="size-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">{t(`contact.features.${key}.title`)}</h3>
                  <p className="text-sm text-muted-foreground">{t(`contact.features.${key}.description`)}</p>
                </div>
              </div>
            ))}
          </div>
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
    </>
  )
}
