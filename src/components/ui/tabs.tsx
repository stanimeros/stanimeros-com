import * as React from "react"

import { cn } from "@/lib/utils"

interface TabsContextValue {
  value: string
  setValue: (value: string) => void
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function useTabsContext() {
  const ctx = React.useContext(TabsContext)
  if (!ctx) throw new Error("Tabs.* components must be used inside <Tabs>")
  return ctx
}

function Tabs({
  value,
  onValueChange,
  className,
  children,
}: {
  value: string
  onValueChange: (value: string) => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <TabsContext.Provider value={{ value, setValue: onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

function TabsList({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex h-9 items-center gap-1 rounded-lg bg-muted/40 p-1 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  value,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & { value: string }) {
  const ctx = useTabsContext()
  const active = ctx.value === value
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => ctx.setValue(value)}
      className={cn(
        "cursor-pointer inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "hover:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function TabsContent({
  value,
  className,
  ...props
}: React.ComponentProps<"div"> & { value: string }) {
  const ctx = useTabsContext()
  if (ctx.value !== value) return null
  return <div className={className} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
