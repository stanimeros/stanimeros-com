import { useTranslation } from "react-i18next"
import { MutedLink } from "@/components/ui/section"

const Footer = () => {
  const { t, i18n } = useTranslation()
  const currentYear = new Date().getFullYear()
  const prefix = i18n.language === 'el' ? '/el' : ''

  return (
    <footer className="bg-card py-8 border-t text-sm">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-muted-foreground text-center md:text-left space-y-1">
            <div>{`© ${currentYear} ${t('footer.copyright')}`}</div>
            <div className="text-xs">GEMI: 183133106000</div>
          </div>
          <div className="flex flex-col md:flex-row items-center gap-2 md:gap-6">
            <MutedLink href={`${prefix}/privacy-policy`}>
              {t('footer.links.privacy')}
            </MutedLink>
            <MutedLink href={`${prefix}/data-deletion`}>
              {t('footer.links.dataDeletion')}
            </MutedLink>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default Footer 