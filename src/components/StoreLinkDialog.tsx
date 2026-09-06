import { useState } from "react"
import { CheckIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

export interface StoreLinkDialogStrings {
  title: string
  subtitle: string
  copy: string
  copied: string
}

export interface StoreLinkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  href: string | null
  strings: StoreLinkDialogStrings
}

export function StoreLinkDialog({ open, onOpenChange, href, strings }: StoreLinkDialogProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!href) return
    await navigator.clipboard.writeText(href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setCopied(false)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.title}</DialogTitle>
          <DialogDescription>{strings.subtitle}</DialogDescription>
        </DialogHeader>
        <Button onClick={handleCopy} className="w-full">
          {copied ? (
            <>
              <CheckIcon className="size-4" />
              {strings.copied}
            </>
          ) : (
            <>
              <ClipboardDocumentIcon className="size-4" />
              {strings.copy}
            </>
          )}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
