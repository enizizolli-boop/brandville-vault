import express from 'express'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env
try {
  const envFile = readFileSync(join(__dirname, '.env'), 'utf8')
  for (const line of envFile.split('\n')) {
    const eqIdx = line.indexOf('=')
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx).trim()
      const val = line.slice(eqIdx + 1).trim()
      if (key && !key.startsWith('#')) process.env[key] = val
    }
  }
} catch {}

const app = express()
app.use(express.json())

const routes = [
  '/api/odoo-sync',
  '/api/odoo-webhook',
  '/api/zoho-sync',
  '/api/zoho-images',
  '/api/extract-jewellery-types',
]

for (const route of routes) {
  const file = '.' + route + '.js'
  try {
    const { default: handler } = await import(file)
    app.all(route, (req, res) => handler(req, res))
    console.log('✓ Loaded', route)
  } catch (e) {
    console.warn('⚠ Could not load', route, '-', e.message)
  }
}

const PORT = 3001
app.listen(PORT, () => {
  console.log(`\nAPI server running at http://localhost:${PORT}`)
  console.log('React app should be running at http://localhost:3000\n')
})
