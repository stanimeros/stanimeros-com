import type { ComponentType, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"
import { motion, type HTMLMotionProps } from "framer-motion"

/**
 * Section: the standard `<motion.section>` wrapper used by every page/content
 * block (`py-20 scroll-mt-10 overflow-hidden`, optionally shaded with
 * `bg-card/70`). Forwards all motion props (initial/animate/transition from
 * `useScrollAnimation`) and the section ref exactly like the raw
 * `motion.section` it replaces.
 */
export interface SectionProps extends HTMLMotionProps<"section"> {
  /** Applies the alternating `bg-card/70` shaded background variant. */
  shaded?: boolean
}

export function Section({ shaded, className, ref, ...props }: SectionProps) {
  return (
    <motion.section
      ref={ref}
      className={cn("py-20 scroll-mt-10 overflow-hidden", shaded && "bg-card/70", className)}
      {...props}
    />
  )
}

const HEADING_CLASS: Record<"h1" | "h2", string> = {
  h1: "text-4xl md:text-5xl font-bold mb-4 text-center",
  h2: "text-4xl font-bold mb-4 text-center",
}

/**
 * SectionHeading: the standard centered section title used across every
 * page — a heading with a leading inline icon, an optional subtitle, and the
 * `w-24 mx-auto mt-4` separator underneath.
 */
export interface SectionHeadingProps {
  /** Heading level: "h1" for page titles, "h2" (default) for in-page sections. */
  as?: "h1" | "h2"
  icon: ComponentType<{ className?: string }>
  title: ReactNode
  /** Rendered as-is below the heading, e.g. a <p> with the site's own copy classes. */
  subtitle?: ReactNode
  /** Whether to render the `w-24 mx-auto mt-4` separator (default: true). */
  separator?: boolean
  /** Classes for the centering wrapper div (default: "text-center mb-16"). */
  wrapperClassName?: string
  /** Extra content rendered after the separator (e.g. a badge/chip). */
  children?: ReactNode
}

export function SectionHeading({
  as = "h2",
  icon: Icon,
  title,
  subtitle,
  separator = true,
  wrapperClassName = "text-center mb-16",
  children,
}: SectionHeadingProps) {
  const Heading = as
  return (
    <div className={wrapperClassName}>
      <Heading className={HEADING_CLASS[as]}>
        <Icon className="inline-block size-8 text-primary align-middle mr-2 -mt-1" />
        {title}
      </Heading>
      {subtitle}
      {separator && <Separator className="w-24 mx-auto mt-4" />}
      {children}
    </div>
  )
}

/**
 * MutedLink: the standard muted inline text link
 * (`text-muted-foreground hover:text-primary transition-colors`) used for
 * secondary in-page links (footer links, "back to X" links, etc.).
 */
export function MutedLink({ className, ...props }: React.ComponentProps<"a">) {
  return (
    <a className={cn("text-muted-foreground hover:text-primary transition-colors", className)} {...props} />
  )
}
