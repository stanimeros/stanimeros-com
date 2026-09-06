import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  ChatBubbleLeftRightIcon,
  XMarkIcon,
  PaperAirplaneIcon,
} from "@heroicons/react/24/outline"
import { geminiChat } from "@/lib/firebase"

const SESSION_KEY = "chat_session_id"
const CONSENT_KEY = "cookie_consent"

interface ChatMessage {
  role: "user" | "model"
  text: string
}

// Minimal markdown rendering for chat replies: **bold** and "- " bullet
// lists only. A full markdown library is overkill for a few inline spans in a
// chat bubble, so this just covers what the assistant is instructed to use.
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    )
  )
}

function ChatMessageText({ text }: { text: string }) {
  const lines = text.split("\n")
  const elements: React.ReactNode[] = []
  let listItems: string[] = []

  const flushList = (key: string) => {
    if (listItems.length === 0) return
    elements.push(
      <ul key={key} className="list-disc pl-4">
        {listItems.map((item, i) => (
          <li key={i}>{renderInline(item, `${key}-li-${i}`)}</li>
        ))}
      </ul>
    )
    listItems = []
  }

  lines.forEach((line, i) => {
    const bulletMatch = /^[-*]\s+(.*)/.exec(line)
    if (bulletMatch) {
      listItems.push(bulletMatch[1])
      return
    }
    flushList(`list-${i}`)
    if (line.length > 0) {
      elements.push(<div key={`line-${i}`}>{renderInline(line, `line-${i}`)}</div>)
    } else {
      elements.push(<br key={`br-${i}`} />)
    }
  })
  flushList("list-end")

  return <>{elements}</>
}

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(SESSION_KEY, id)
  }
  return id
}

export default function ChatWidget() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState(false)
  const [consentDecided, setConsentDecided] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setConsentDecided(!!localStorage.getItem(CONSENT_KEY))
    const onConsentUpdated = () => setConsentDecided(true)
    window.addEventListener("cookie-consent-updated", onConsentUpdated)
    return () => window.removeEventListener("cookie-consent-updated", onConsentUpdated)
  }, [])

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: "model", text: t("chat.greeting") }])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, isSending])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isSending) return

    setMessages((prev) => [...prev, { role: "user", text }])
    setInput("")
    setIsSending(true)
    setError(false)

    try {
      const sessionId = getSessionId()
      const result = await geminiChat({ sessionId, message: text })
      const reply = (result.data as { reply?: string })?.reply ?? ""
      setMessages((prev) => [...prev, { role: "model", text: reply }])
    } catch {
      setError(true)
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!consentDecided) return null

  return (
    <>
      {open && (
        <div className="fixed bottom-40 sm:bottom-24 right-4 sm:right-6 z-50 w-[calc(100%-2rem)] sm:w-96 h-[70svh] max-h-[520px] flex flex-col bg-card border border-border/80 rounded-2xl shadow-floating overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
            <div>
              <h2 className="font-semibold">{t("chat.title")}</h2>
              <p className="text-sm text-muted-foreground">{t("chat.subtitle")}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label={t("chat.closeLabel")}>
              <XMarkIcon className="size-5" />
            </Button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "ml-auto bg-emerald-700 text-white whitespace-pre-wrap"
                    : "mr-auto bg-muted text-foreground"
                }`}
              >
                {m.role === "model" ? <ChatMessageText text={m.text} /> : m.text}
              </div>
            ))}
            {isSending && (
              <div className="mr-auto bg-muted text-foreground rounded-2xl px-4 py-2 text-sm">
                <div className="flex gap-1">
                  <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
                  <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
                  <span className="size-1.5 rounded-full bg-current animate-bounce" />
                </div>
              </div>
            )}
            {error && (
              <div className="mr-auto bg-red-950/30 border border-red-800/50 text-red-300 rounded-2xl px-4 py-2 text-sm">
                {t("chat.error")}
              </div>
            )}
          </div>

          <div className="p-3 border-t border-border/60 shrink-0 flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("chat.placeholder")}
              rows={1}
              className="min-h-10 max-h-32 resize-none"
            />
            <Button variant="green" size="icon" onClick={handleSend} disabled={isSending || !input.trim()} aria-label={t("chat.send")}>
              <PaperAirplaneIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <Button
        variant="green"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? t("chat.closeLabel") : t("chat.openLabel")}
        className="fixed bottom-20 sm:bottom-4 right-4 sm:right-6 z-50 size-14 rounded-full shadow-lg"
      >
        {open ? <XMarkIcon className="size-6" /> : <ChatBubbleLeftRightIcon className="size-6" />}
      </Button>
    </>
  )
}
