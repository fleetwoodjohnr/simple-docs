import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './styles.css'
import { App } from './app/App'

createRoot(document.getElementById('root')!).render(<App />)
