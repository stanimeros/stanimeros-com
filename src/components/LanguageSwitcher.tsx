import { Button } from "@/components/ui/button"
import { GlobeAltIcon } from "@heroicons/react/24/outline"
import { useTranslation } from "react-i18next"

interface LanguageSwitcherProps {
  variant?: 'default' | 'compact'
}

const LanguageSwitcher = ({ variant = 'default' }: LanguageSwitcherProps) => {
  const { i18n } = useTranslation()

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'el' : 'en'
    try {
      localStorage.setItem('preferredLang', newLang)
    } catch {
      // localStorage unavailable, proceed anyway
    }
    const { pathname, search, hash } = window.location
    const basePath = pathname.startsWith('/el') ? pathname.slice(3) || '/' : pathname
    const target = newLang === 'el' ? `/el${basePath === '/' ? '' : basePath}` : basePath
    window.location.href = `${target || '/'}${search}${hash}`
  }

  return (
    <Button 
      variant={variant === 'compact' ? 'outline' : 'ghost'} 
      onClick={toggleLanguage} 
      className={`cursor-pointer ${variant === 'compact' ? 'px-2 h-8 text-xs' : 'justify-start'}`}
      size={variant === 'compact' ? 'sm' : 'default'}
    >
      <GlobeAltIcon className={`size-4 ${variant === 'compact' ? 'mr-1' : 'mr-3'}`} />
      {variant === 'compact' 
        ? i18n.language === 'en' ? 'EL' : 'EN'
        : i18n.language === 'en' ? 'Αλλαγή στα Ελληνικά' : 'Switch to English'
      }
    </Button>
  )
}

export default LanguageSwitcher
