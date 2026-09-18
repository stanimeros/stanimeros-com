import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import Health from "@/page-content/Health"
import { initHealthReporting } from "@/lib/reportClientError"
import "@/index.css"

initHealthReporting({
  project: "stanimeros-dev",
  token: import.meta.env.VITE_HEALTH_CLIENT_TOKEN,
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Health />
  </StrictMode>
)
