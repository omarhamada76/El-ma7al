/**
 * Seed products from JSON files into the local SQLite inventory.
 * Usage: node server/seed-products.js
 * Reads: products_rows.json (project root), products_rows1.json & products_rows3.json (Downloads).
 * Products are added without image_url. Categories are added to the categories table.
 * Re-running skips products that already exist (by name).
 */
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as db from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const downloads = process.env.HOME
  ? join(process.env.HOME, 'Downloads')
  : join(projectRoot, 'downloads')

const JSON_FILES = [
  join(projectRoot, 'products_rows.json'),
  join(downloads, 'products_rows1.json'),
  join(downloads, 'products_rows3.json'),
]

/** Ensure this category exists in categories table (for dropdown and filters). */
function ensureCategory(catName) {
  if (!catName || String(catName).trim() === '') return
  const name = String(catName).trim()
  const existing = new Set(db.getCategoryOptions())
  if (existing.has(name)) return
  try {
    db.createCategory(name)
    console.log('Category added:', name)
  } catch (e) {
    console.warn('Category skip:', name, e.message)
  }
}

function loadJson(path) {
  if (!existsSync(path)) {
    console.warn('Skip (not found):', path)
    return []
  }
  try {
    const raw = readFileSync(path, 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : [data]
  } catch (e) {
    console.warn('Error reading', path, e.message)
    return []
  }
}

function toNumber(v) {
  if (v == null || v === '') return 0
  const n = Number(String(v).replace(/,/g, '.'))
  return Number.isFinite(n) ? n : 0
}

function normalize(row) {
  return {
    name: String(row.name || '').trim() || 'منتج',
    company: row.company != null && row.company !== '' ? String(row.company).trim() : null,
    category: row.category != null && row.category !== '' ? String(row.category).trim() : null,
    barcode: row.barcode != null && row.barcode !== '' ? String(row.barcode).trim() : null,
    purchase_price: toNumber(row.purchase_price),
    selling_price: toNumber(row.selling_price),
    alert_level: Number(row.alert_level) || 10,
    notes: null,
    expiry_date: row.expiry_date || row.expiration_date || null,
  }
}

async function main() {
  console.log('Database:', db.dbPath)
  console.log('(Server must use this same path so products appear in the app.)\n')

  const allRows = []
  for (const path of JSON_FILES) {
    const rows = loadJson(path)
    allRows.push(...rows)
    if (rows.length) console.log('Loaded', rows.length, 'from', path)
  }

  if (allRows.length === 0) {
    console.log('No product rows found. Check paths:', JSON_FILES)
    process.exit(1)
  }

  const normalized = allRows.map(normalize)

  // 1) Add all categories from products to the categories table (for filters/dropdown)
  const categoriesAdded = new Set()
  for (const row of normalized) {
    const cat = row.category
    if (cat && !categoriesAdded.has(cat)) {
      ensureCategory(cat)
      categoriesAdded.add(cat)
    }
  }

  // 2) Skip products that already exist (by name) so re-run doesn't duplicate
  const existingNames = new Set(db.getAllProductNames())

  let created = 0
  let skipped = 0
  let errors = 0
  for (const p of normalized) {
    if (existingNames.has(p.name)) {
      skipped++
      continue
    }
    try {
      ensureCategory(p.category)
      db.createProduct({
        name: p.name,
        company: p.company,
        category: p.category,
        barcode: p.barcode,
        purchase_price: p.purchase_price,
        selling_price: p.selling_price,
        alert_level: p.alert_level,
        notes: p.notes,
        expiry_date: p.expiry_date,
      })
      existingNames.add(p.name)
      created++
      if (created % 50 === 0) process.stdout.write('.')
    } catch (e) {
      errors++
      if (errors <= 5) console.warn('\nError:', p.name?.slice(0, 30), e.message)
    }
  }

  const categoriesNow = db.getCategoryCount()
  const productsNow = db.getProductCount()
  console.log('\nDone.')
  console.log('Created:', created, 'products. Skipped (already exist):', skipped, 'Errors:', errors)
  console.log('Categories in DB:', categoriesNow, '| Products in DB:', productsNow)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
