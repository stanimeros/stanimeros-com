import { useRef } from "react"
import { motion, type HTMLMotionProps } from "framer-motion"
import { useMobileCardAnimation } from "@/lib/hooks"

interface AnimatedCardProps extends HTMLMotionProps<"div"> {
  index?: number
}

export function AnimatedCard({ index = 0, ...props }: AnimatedCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const animation = useMobileCardAnimation(ref, index)

  return <motion.div ref={ref} {...animation} {...props} />
}
