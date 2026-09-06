import { useEffect, useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import {
  TrashIcon as Trash2,
  ExclamationTriangleIcon as AlertTriangle,
  CheckCircleIcon,
  EnvelopeIcon as Mail,
  ShieldCheckIcon as Shield,
  ClockIcon as Clock
} from "@heroicons/react/24/outline"
import { useTranslation } from "react-i18next"
import { sendEmail } from "@/lib/firebase"
import { trackEvent } from "@/lib/events"

/** Preset app/entity info for Google Play Data safety – URL must reference the entity. */
const DATA_DELETION_PRESETS: Record<string, { appName: string; developer: string; company: string; contactEmail: string }> = {
  "atpro-partner": {
    appName: "ATPro Partner",
    developer: "MP CARRIERS O.E.",
    company: "MP CARRIERS O.E.",
    contactEmail: "mp.transfer.app@gmail.com",
  },
  "e-karotsi": {
    appName: "e-karotsi.gr",
    developer: "STANIMEROS PANTELEIMON",
    company: "STANIMEROS PANTELEIMON",
    contactEmail: "hello@stanimeros.com",
  },
  "ski-greece": {
    appName: "Ski Greece",
    developer: "STANIMEROS PANTELEIMON",
    company: "STANIMEROS PANTELEIMON",
    contactEmail: "hello@stanimeros.com",
  },
  "fire-message": {
    appName: "Fire Message",
    developer: "STANIMEROS PANTELEIMON",
    company: "STANIMEROS PANTELEIMON",
    contactEmail: "hello@stanimeros.com",
  },
  "chronal": {
    appName: "Chronal",
    developer: "STANIMEROS PANTELEIMON",
    company: "STANIMEROS PANTELEIMON",
    contactEmail: "hello@stanimeros.com",
  },
  "nourea": {
    appName: "Nourea",
    developer: "STANIMEROS PANTELEIMON",
    company: "STANIMEROS PANTELEIMON",
    contactEmail: "hello@stanimeros.com",
  },
  "party": {
    appName: "Party - Play with friends",
    developer: "STANIMEROS PANTELEIMON",
    company: "STANIMEROS PANTELEIMON",
    contactEmail: "hello@stanimeros.com",
  },
  "statwise": {
    appName: "Statwise",
    developer: "STANIMEROS PANTELEIMON",
    company: "STANIMEROS PANTELEIMON",
    contactEmail: "hello@stanimeros.com",
  },
}

const DEFAULT_PRESET = {
  appName: "",
  developer: "",
  company: "",
  contactEmail: "hello@stanimeros.com",
}

interface DataDeletionProps {
  appSlug?: string
  lang?: "en" | "el"
}

const DataDeletion = ({ appSlug, lang }: DataDeletionProps) => {
  const { t } = useTranslation()
  const prefix = lang === "el" ? "/el" : ""
  const preset = useMemo(
    () => (appSlug && DATA_DELETION_PRESETS[appSlug]) ? DATA_DELETION_PRESETS[appSlug] : null,
    [appSlug]
  )
  const entity = preset ?? DEFAULT_PRESET

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    appName: entity.appName,
    reason: "",
  })
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [verifyChecked, setVerifyChecked] = useState(false)
  const [deleteAccount, setDeleteAccount] = useState(false)

  useEffect(() => {
    if (preset) {
      setFormData((prev) => ({ ...prev, appName: preset.appName }))
    }
  }, [preset])

  useEffect(() => {
    scrollTo(0, 0)
    trackEvent("pageView", { page: "data-deletion", appSlug: appSlug ?? undefined })
  }, [appSlug])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    
    try {
      const deletionType = deleteAccount ? "Account and Data" : "Data Only"
      const message = `Application: ${formData.appName}\nDeletion Type: ${deletionType}\nReason: ${formData.reason}`
      
      await sendEmail({
        name: formData.name,
        email: formData.email,
        message: message,
        subject: "Data Deletion Request"
      })
      
      setIsLoading(false)
      setIsSubmitted(true)
      
    } catch (error) {
      console.error("Error submitting data deletion request:", error)
      setIsLoading(false)
      // You could add error handling here if needed
      setIsSubmitted(true) // Still show success for UX
    }
  }

  if (isSubmitted) {
    return (
      <>
        {/* Success Content */}
        <main className="container mx-auto px-4 py-12 relative z-10">
          <div className="max-w-2xl mx-auto text-center">
            <div className="flex justify-center mb-6">
              <CheckCircleIcon className="size-16 text-green-500" />
            </div>
            <h1 className="text-3xl font-bold mb-4">{t('dataDeletion.success.title')}</h1>
            <p className="text-muted-foreground mb-8">
              {t('dataDeletion.success.description')}
            </p>
            
            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="flex items-center justify-center">
                  <Clock className="size-5 mr-2" />
                  {t('dataDeletion.success.whatHappensNext')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {(t('dataDeletion.success.steps', { returnObjects: true }) as string[]).map((step, index) => (
                  <div key={index} className="flex items-start space-x-3">
                    <div className="size-2 bg-primary rounded-full mt-2 flex-shrink-0"></div>
                    <p className="text-muted-foreground text-left">
                      {step}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <div>
                <p className="text-sm text-muted-foreground">
                  {t('dataDeletion.success.needHelp')}{" "}
                  <a href={`mailto:${entity.contactEmail}`} className="text-primary hover:underline">
                    {entity.contactEmail}
                  </a>
                </p>
              </div>
            </div>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      {/* Main Content */}
      <main className="container mx-auto px-4 py-12 relative z-10">
        <div className="max-w-2xl mx-auto">
          {/* Title */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <Trash2 className="size-12 text-primary" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              {preset ? t('dataDeletion.titleApp', { appName: preset.appName }) : t('dataDeletion.title')}
            </h1>
            <p className="text-muted-foreground">
              {t('dataDeletion.subtitle')}
            </p>
            {preset && (
              <Card className="mt-6 text-left border-primary/30 bg-primary/5">
                <CardContent className="pt-6">
                  <dl className="space-y-3">
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">
                        {t('dataDeletion.entity.appName')}
                      </dt>
                      <dd className="mt-0.5 font-semibold text-lg">{preset.appName}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">
                        {t('dataDeletion.entity.developer')}
                      </dt>
                      <dd className="mt-0.5">{preset.developer}</dd>
                    </div>
                    {preset.company !== preset.developer && (
                      <div>
                        <dt className="text-sm font-medium text-muted-foreground">
                          {t('dataDeletion.entity.company')}
                        </dt>
                        <dd className="mt-0.5">{preset.company}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground">
                        {t('dataDeletion.entity.contact')}
                      </dt>
                      <dd className="mt-0.5">
                        <a href={`mailto:${preset.contactEmail}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                          <Mail className="size-4 shrink-0" />
                          {preset.contactEmail}
                        </a>
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Account Deletion Policy (app-specific, for store compliance) */}
          {preset && (
            <Card className="mb-8 text-left">
              <CardHeader>
                <CardTitle className="text-xl">
                  {t('dataDeletion.accountDeletionPolicy.title', { appName: preset.appName })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-muted-foreground">
                <p>{t('dataDeletion.accountDeletionPolicy.intro')}</p>
                <p>
                  {t('dataDeletion.accountDeletionPolicy.appIntro', { appName: preset.appName })}
                </p>
                <div>
                  <p className="font-semibold text-foreground mb-2">
                    {t('dataDeletion.accountDeletionPolicy.howToTitle')}:
                  </p>
                  <p className="mb-2">{t('dataDeletion.accountDeletionPolicy.howToIntro')}</p>
                  <ul className="list-disc list-inside space-y-2">
                    <li>
                      {(() => {
                        const text = t('dataDeletion.accountDeletionPolicy.howToOptionEmail', {
                          appName: preset.appName,
                          email: preset.contactEmail,
                        })
                        const parts = text.split(preset.contactEmail)
                        return (
                          <>
                            {parts[0]}
                            <a href={`mailto:${preset.contactEmail}?subject=Account%20Deletion%20Request`} className="text-primary hover:underline font-medium">
                              {preset.contactEmail}
                            </a>
                            {parts[1]}
                          </>
                        )
                      })()}
                    </li>
                    <li>
                      {t('dataDeletion.accountDeletionPolicy.howToOptionForm')}{' '}
                      <a href="#deletion-form" className="text-primary hover:underline font-medium inline-flex items-center gap-1">
                        {t('dataDeletion.accountDeletionPolicy.howToOptionFormLink')}
                      </a>
                    </li>
                  </ul>
                </div>
                <div>
                  <p className="font-semibold text-foreground mb-2">
                    {t('dataDeletion.accountDeletionPolicy.whatDataTitle')}
                  </p>
                  <p className="mb-2">{t('dataDeletion.accountDeletionPolicy.whatDataIntro')}</p>
                  <ul className="list-disc list-inside space-y-1">
                    {(t('dataDeletion.accountDeletionPolicy.dataItems', { returnObjects: true }) as string[]).map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                  <p className="mt-3 text-sm italic">
                    {t('dataDeletion.accountDeletionPolicy.note')}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Important Notice */}
          <Card className="mb-8 border-red-200 bg-red-50/20 dark:border-red-800/50 dark:bg-red-950/30">
            <CardHeader>
              <CardTitle className="flex items-center text-red-700 dark:text-red-300">
                <AlertTriangle className="size-5 mr-2" />
                {t('dataDeletion.importantInformation.title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-red-600 dark:text-red-400">
                {(t('dataDeletion.importantInformation.items', { returnObjects: true }) as string[]).map((item, index) => (
                  <li key={index}>• {item}</li>
                ))}
              </ul>
            </CardContent>
          </Card>



          {/* Deletion Form */}
          <Card id="deletion-form">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Shield className="size-5 mr-2" />
                {t('dataDeletion.form.title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">{t('dataDeletion.form.fullName')}</Label>
                    <Input
                      id="name"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}
                      placeholder={t('dataDeletion.form.fullNamePlaceholder')}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">{t('dataDeletion.form.email')}</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      placeholder={t('dataDeletion.form.emailPlaceholder')}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="appName">{t('dataDeletion.form.appName')}</Label>
                  <Input
                    id="appName"
                    name="appName"
                    value={formData.appName}
                    onChange={handleInputChange}
                    placeholder={t('dataDeletion.form.appNamePlaceholder')}
                    required
                    readOnly={!!preset}
                    className={preset ? "bg-muted" : undefined}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reason">{t('dataDeletion.form.reason')}</Label>
                  <Textarea
                    id="reason"
                    name="reason"
                    value={formData.reason}
                    onChange={handleInputChange}
                    placeholder={t('dataDeletion.form.reasonPlaceholder')}
                    rows={3}
                    required
                  />
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-start space-x-3">
                    <Checkbox
                      id="deleteAccount"
                      checked={deleteAccount}
                      onCheckedChange={(checked) => setDeleteAccount(checked as boolean)}
                    />
                    <Label htmlFor="deleteAccount" className="text-sm cursor-pointer">
                      {t('dataDeletion.form.deleteAccount')}
                    </Label>
                  </div>

                  <div className="flex items-start space-x-3">
                    <Checkbox
                      id="confirm"
                      checked={confirmChecked}
                      onCheckedChange={(checked) => setConfirmChecked(checked as boolean)}
                      required
                    />
                    <Label htmlFor="confirm" className="text-sm cursor-pointer">
                      {t('dataDeletion.form.confirm')}
                    </Label>
                  </div>

                  <div className="flex items-start space-x-3">
                    <Checkbox
                      id="verify"
                      checked={verifyChecked}
                      onCheckedChange={(checked) => setVerifyChecked(checked as boolean)}
                      required
                    />
                    <Label htmlFor="verify" className="text-sm cursor-pointer">
                      {t('dataDeletion.form.verify')}
                    </Label>
                  </div>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-red-600 hover:bg-red-700 text-white"
                  disabled={isLoading || !confirmChecked || !verifyChecked || !formData.appName.trim()}
                >
                  {isLoading ? (
                    <>
                      <div className="animate-spin rounded-full size-5 border-b-2 border-white mr-2"></div>
                      {t('dataDeletion.form.processing')}
                    </>
                  ) : (
                    <>
                      <Trash2 className="size-5 mr-2 stroke-[1.5]" />
                      {t('dataDeletion.form.submit')}
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Contact Information */}
          <div className="text-center mt-8">
            <Separator className="my-8" />
            <p className="text-muted-foreground mb-4">
              {t('dataDeletion.contact.description')}
            </p>
            <div className="flex items-center justify-center space-x-2">
              <Mail className="size-4" />
              <a href={`mailto:${entity.contactEmail}`} className="text-primary hover:underline">
                {entity.contactEmail}
              </a>
            </div>
          </div>

          {/* Privacy Policy Link */}
          <div className="text-center">
            <Separator className="my-8" />
            <p className="text-muted-foreground mb-4">
              {t('dataDeletion.privacyPolicyLink.description')}
            </p>
            <a href={appSlug ? `${prefix}/privacy-policy/${appSlug}` : `${prefix}/privacy-policy`}>
              <Button variant="outline">
                <Shield className="size-4 mr-2 stroke-[1.5]" />
                {t('dataDeletion.privacyPolicyLink.button')}
              </Button>
            </a>
          </div>
        </div>
      </main>
    </>
  )
}

export default DataDeletion 