import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles/base.css"
import "./styles/tokens.css"
import App from "./App"
import AppRouter from "./platform/AppRouter";

createRoot(document.getElementById('root')!).render(
  <StrictMode>
      <AppRouter >
          <App />
      </AppRouter>
  </StrictMode>,
)
