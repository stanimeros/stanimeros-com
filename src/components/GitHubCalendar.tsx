import { useEffect, useRef, useState } from 'react'
import * as GitHubCalendarModule from 'react-github-calendar'

// react-github-calendar ships CJS-only; depending on how the bundler wraps
// it (Astro's client build vs. plain Vite) the default export can end up
// nested one or two levels deeper than expected. Unwrap until we hit the
// actual forwardRef component (identifiable by its $$typeof symbol).
function unwrapDefault(mod: unknown): typeof import('react-github-calendar').default {
  let current = mod as { default?: unknown; $$typeof?: unknown }
  while (current && typeof current === 'object' && !('$$typeof' in current) && 'default' in current) {
    current = current.default as typeof current
  }
  return current as typeof import('react-github-calendar').default
}

const GitHubCalendar = unwrapDefault(GitHubCalendarModule)

interface GitHubCalendarProps {
  username: string
  className?: string
}

const GitHubCalendarComponent = ({ username, className = "" }: GitHubCalendarProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [contentHeight, setContentHeight] = useState<number | null>(null)

  useEffect(() => {
    const wrapper = wrapperRef.current
    const content = contentRef.current
    if (!wrapper || !content) return

    const update = () => {
      const naturalWidth = content.scrollWidth
      const naturalHeight = content.scrollHeight
      if (!naturalWidth || !naturalHeight) return
      const availableWidth = wrapper.clientWidth
      setScale(Math.min(1, availableWidth / naturalWidth))
      setContentHeight(naturalHeight)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={wrapperRef}
      className={`github-calendar-container ${className}`}
      style={contentHeight ? { height: contentHeight * scale } : undefined}
    >
      <div
        ref={contentRef}
        style={{ display: 'inline-block', transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        <GitHubCalendar
          username={username}
          colorScheme="dark"
          showWeekdayLabels={true}
          hideTotalCount={true}
        />
      </div>
    </div>
  )
}

export default GitHubCalendarComponent 