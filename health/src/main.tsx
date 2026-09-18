import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import Health from "@/page-content/Health"
import "@/index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Health />
  </StrictMode>
)
