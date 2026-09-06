import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { motion, useScroll, useTransform, useSpring } from "framer-motion"
import { Button } from "@/components/ui/button"
import UnderlineHighlight from "@/components/UnderlineHighlight"
import { CubeTransparentIcon } from "@heroicons/react/24/outline"
import { trackEvent } from "@/lib/events"
import { scrollToId } from "@/lib/scroll"

// Inlined instead of imported from @heroicons/react so Hero's client:load
// bundle doesn't have to pull in the shared "icons" chunk used by
// deferred/below-fold islands (PhoneIcon is also used there).
const PhoneIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
  </svg>
)

// Inlined for the same reason as PhoneIcon above: avoid pulling in the
// shared "icons" chunk (StarIcon/solid is also used by Testimonials).
const StarIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006Z" clipRule="evenodd" />
  </svg>
)

const Hero = () => {
  const { t, i18n } = useTranslation()
  const { scrollY } = useScroll()
  const logoY = useTransform(scrollY, [0, 500], [0, 100])
  const logoOpacity = useTransform(scrollY, [0, 500], [0.1, 0])
  const smoothLogoY = useSpring(logoY, { stiffness: 100, damping: 30 })

  useEffect(() => {
    trackEvent('pageView', {
      page: 'home'
    });
    if (window.location.hash) {
      scrollToId(window.location.hash.slice(1))
    }
  }, []);

  return (
    <section id="home" className="min-h-svh flex items-center justify-center relative overflow-hidden">
      <div className="container mx-auto px-4 text-center relative z-10">
        <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent relative z-20">
          {t('hero.title')}
        </h1>
        <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-2xl mx-auto relative z-20">
          {t('hero.subtitleBefore')}
          <UnderlineHighlight key={i18n.language}>{t('hero.subtitleHighlight')}</UnderlineHighlight>
          {t('hero.subtitleAfter')}
        </p>
        <div className="flex flex-row gap-4 justify-center relative z-20">
          <Button size="lg" onClick={() => scrollToId('packages')}>
            <CubeTransparentIcon className="size-5 mr-2 stroke-[1.5]" />
            {t('hero.viewPackages')}
          </Button>
          <Button size="lg" variant="outline" onClick={() => scrollToId('contact')}>
            <PhoneIcon className="size-5 mr-2 stroke-[1.5]" />
            {t('hero.getInTouch')}
          </Button>
        </div>
        <button
          type="button"
          onClick={() => scrollToId('testimonials')}
          className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors relative z-20"
        >
          <span className="flex gap-0.5" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <StarIcon key={i} className="size-4 text-yellow-400" />
            ))}
          </span>
          {t('hero.googleReviews')}
        </button>
        {/* Logo positioned behind everything */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center z-0 pointer-events-none"
          style={{
            y: smoothLogoY,
            opacity: logoOpacity
          }}
          animate={{
            scale: [1, 1.05, 1],
          }}
          transition={{
            repeat: Infinity,
            duration: 4,
            ease: "easeInOut",
            times: [0, 0.5, 1]
          }}
        >
          <img
            src="/images/logo-glass.webp"
            alt="Stanimeros Logo"
            width="400"
            height="400"
            loading="eager"
            className="h-[400%] w-auto object-contain"
            fetchPriority="high"
            decoding="async"
          />
        </motion.div>
      </div>
    </section>
  )
}

export default Hero
