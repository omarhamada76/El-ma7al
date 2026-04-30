/**
 * Copy product image URLs from a legacy Supabase Postgres (e.g. Pharama / tgdnttzbmixrhxbyhwpb)
 * into the main project's `products.image_url`, pointing at the legacy public Storage URLs (no file copy).
 *
 * Env:
 *   DB_URL                         — main project (target) connection string
 *   PRODUCT_IMAGES_SOURCE_DB_URL   — legacy project connection string
 *
 * Matching (in order):
 *   1) Barcode: when both sides have the same non-empty barcode (skipped if ambiguous on either side).
 *   2) Normalized (lower(trim(name)), lower(trim(coalesce(company,'')))) — must be unique on both sides.
 *
 * Usage:
 *   node scripts/sync-product-images-from-legacy-supabase.js [--dry-run] [--overwrite] [--verify-urls]
 *   node scripts/sync-product-images-from-legacy-supabase.js --source-json=tmp/source.json --main-json=tmp/main.json [--dry-run]
 *
 * Options:
 *   --dry-run      Print plan only (default: apply in a transaction).
 *   --overwrite    Set image_url even when main already has a value.
 *   --verify-urls  HEAD-request the first few distinct https URLs (checks reachability).
 *
 * After go-live, if you previously uploaded duplicates into the main Supabase Storage bucket
 * `product-images`, remove unused objects from the main project only (Dashboard → Storage).
 * Images are served from the legacy project URL stored in `products.image_url`.
 */

import pg from 'pg'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const MAX_IMAGE_URL_LEN = 800_000
const LEGACY_PUBLIC_PREFIX = '/storage/v1/object/public/'

/** When legacy (Pharama) name/company text differs slightly from main El-ma7l rows. Keys: lower(trim(name))|lower(trim(company)). */
const SOURCE_TO_MAIN_NAME_COMPANY = new Map([
  ['سيفوناكس ٢٠جم الميماس|غير محدد', { n: 'سيفوناكس ٢٦جم الميماس', c: 'غير محدد' }],
  ['كوليتانيل ٥٠٠ سم كولسترديا|غير محدد', { n: 'كوليستانيل ٥٠٠ سم كولسترديا', c: 'غير محدد' }],
  ['جالي جولد ٥٠٠ سم جولدن|غير محدد', { n: 'جارلي جولد ٥٠٠ سم جولدن', c: 'غير محدد' }],
  ['مترول ٥٠٠ سم اجرومكس|غير محدد', { n: 'ميترول ٥٠٠ سم اجرومكس', c: 'غير محدد' }],
  ['جارليفاي لتر ثوم|غير محدد', { n: 'جارلي فاي لتر ثوم جولدن', c: 'غير محدد' }],
  ['مونوبيوترين لتر فورتكس|غير محدد', { n: 'منتوبيوترين لتر فورتكس', c: 'غير محدد' }],
])

function parseArgs(argv) {
  const out = { dryRun: false, overwrite: false, verifyUrls: false, sourceJson: null, mainJson: null }
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--overwrite') out.overwrite = true
    else if (a === '--verify-urls') out.verifyUrls = true
    else if (a.startsWith('--source-json=')) out.sourceJson = a.slice('--source-json='.length)
    else if (a.startsWith('--main-json=')) out.mainJson = a.slice('--main-json='.length)
  }
  return out
}

function normKey(n, c) {
  return `${String(n || '').trim().toLowerCase()}|${String(c ?? '').trim().toLowerCase()}`
}

function isAllowedHttpsImageUrl(url) {
  if (!url || typeof url !== 'string') return false
  const s = url.trim()
  if (s.length > MAX_IMAGE_URL_LEN) return false
  if (!s.startsWith('https://')) return false
  if (s.includes('/sign/') || s.includes('token=')) return false
  return true
}

async function verifySampleUrls(urls, limit = 5) {
  const uniq = [...new Set(urls.filter(isAllowedHttpsImageUrl))].slice(0, limit)
  for (const u of uniq) {
    try {
      const res = await fetch(u, { method: 'HEAD', redirect: 'follow' })
      const ok = res.ok
      console.log(`[verify] ${ok ? 'OK' : 'FAIL'} ${res.status} ${u.slice(0, 90)}…`)
    } catch (e) {
      console.log(`[verify] FAIL ${u.slice(0, 90)}… (${e.message})`)
    }
  }
}

function loadJsonRows(filePath, label) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const data = JSON.parse(raw)
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.rows)) return data.rows
  throw new Error(`${label}: expected JSON array or { rows: [] }`)
}

function buildBarcodeMaps(products) {
  const byBc = new Map()
  for (const p of products) {
    const bc = p.bc != null && String(p.bc).trim() !== '' ? String(p.bc).trim() : null
    if (!bc) continue
    if (!byBc.has(bc)) byBc.set(bc, [])
    byBc.get(bc).push(p)
  }
  const ambiguous = new Set()
  for (const [bc, list] of byBc) {
    if (list.length > 1) ambiguous.add(bc)
  }
  return { byBc, ambiguous }
}

async function fetchSourceRows(client) {
  const r = await client.query(`
    SELECT
      lower(trim(name)) AS n,
      lower(trim(coalesce(company, ''))) AS c,
      NULLIF(trim(barcode::text), '') AS bc,
      image_url AS url
    FROM products
    WHERE image_url IS NOT NULL
      AND trim(image_url) <> ''
      AND image_url LIKE 'https://%'
  `)
  return r.rows
}

async function fetchMainRows(client) {
  const r = await client.query(`
    SELECT
      id,
      lower(trim(name)) AS n,
      lower(trim(coalesce(company, ''))) AS c,
      NULLIF(trim(barcode::text), '') AS bc,
      image_url AS url
    FROM products
  `)
  return r.rows
}

function planUpdates(sourceRows, mainRows, overwrite) {
  const skipped = []
  const updates = []

  const mainByKey = new Map()
  for (const m of mainRows) {
    const k = normKey(m.n, m.c)
    if (!mainByKey.has(k)) mainByKey.set(k, [])
    mainByKey.get(k).push(m)
  }
  const mainKeyAmbiguous = new Set()
  for (const [k, list] of mainByKey) {
    if (list.length > 1) mainKeyAmbiguous.add(k)
  }

  const srcByKey = new Map()
  for (const s of sourceRows) {
    if (!isAllowedHttpsImageUrl(s.url)) {
      skipped.push({ reason: 'bad_url', n: s.n, c: s.c })
      continue
    }
    const k = normKey(s.n, s.c)
    if (!srcByKey.has(k)) srcByKey.set(k, [])
    srcByKey.get(k).push(s)
  }
  const srcKeyAmbiguous = new Set()
  for (const [k, list] of srcByKey) {
    if (list.length > 1) srcKeyAmbiguous.add(k)
  }

  const { byBc: srcByBc, ambiguous: srcBcAmb } = buildBarcodeMaps(sourceRows)
  const { byBc: mainByBc, ambiguous: mainBcAmb } = buildBarcodeMaps(mainRows)

  const usedMainIds = new Set()

  for (const s of sourceRows) {
    if (!isAllowedHttpsImageUrl(s.url)) continue

    let mainRow = null
    let via = null

    const bc = s.bc != null && String(s.bc).trim() !== '' ? String(s.bc).trim() : null
    if (bc && !srcBcAmb.has(bc) && !mainBcAmb.has(bc)) {
      const srcList = srcByBc.get(bc) || []
      const mainList = mainByBc.get(bc) || []
      if (srcList.length === 1 && mainList.length === 1) {
        mainRow = mainList[0]
        via = 'barcode'
      }
    }

    if (!mainRow) {
      const alias = SOURCE_TO_MAIN_NAME_COMPANY.get(normKey(s.n, s.c))
      const lookupN = alias ? alias.n : s.n
      const lookupC = alias ? alias.c : s.c
      const k = normKey(lookupN, lookupC)
      if (srcKeyAmbiguous.has(normKey(s.n, s.c)) || mainKeyAmbiguous.has(k)) {
        skipped.push({ reason: 'ambiguous_name_company', key: k })
        continue
      }
      const mList = mainByKey.get(k) || []
      if (mList.length === 0) {
        skipped.push({ reason: 'no_main_match', n: s.n, c: s.c })
        continue
      }
      mainRow = mList[0]
      via = 'name_company'
    }

    if (usedMainIds.has(mainRow.id)) {
      skipped.push({ reason: 'main_id_already_matched', id: mainRow.id, n: s.n, c: s.c })
      continue
    }

    if (!overwrite && mainRow.url != null && String(mainRow.url).trim() !== '') {
      skipped.push({ reason: 'main_has_image_skip', id: mainRow.id })
      continue
    }

    usedMainIds.add(mainRow.id)
    updates.push({ id: mainRow.id, url: s.url.trim(), via, n: s.n, c: s.c })
  }

  return { updates, skipped, stats: { srcKeyAmbiguous: srcKeyAmbiguous.size, mainKeyAmbiguous: mainKeyAmbiguous.size } }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const useJson = args.sourceJson && args.mainJson

  if (!useJson && !process.env.DB_URL) {
    console.error('DB_URL is required (or pass --source-json and --main-json).')
    process.exit(1)
  }
  if (!useJson && !process.env.PRODUCT_IMAGES_SOURCE_DB_URL) {
    console.error('PRODUCT_IMAGES_SOURCE_DB_URL is required unless using --source-json and --main-json.')
    process.exit(1)
  }

  let sourceRows
  let mainRows

  if (useJson) {
    sourceRows = loadJsonRows(path.resolve(args.sourceJson), 'source')
    mainRows = loadJsonRows(path.resolve(args.mainJson), 'main')
  } else {
    const srcClient = new pg.Client({
      connectionString: process.env.PRODUCT_IMAGES_SOURCE_DB_URL,
      ssl: { rejectUnauthorized: false },
    })
    const mainClient = new pg.Client({
      connectionString: process.env.DB_URL,
      ssl: { rejectUnauthorized: false },
    })
    await srcClient.connect()
    await mainClient.connect()
    try {
      sourceRows = await fetchSourceRows(srcClient)
      mainRows = await fetchMainRows(mainClient)
    } finally {
      await srcClient.end()
      await mainClient.end()
    }
  }

  console.log(`[info] source rows with https image: ${sourceRows.length}, main products: ${mainRows.length}`)

  const { updates, skipped, stats } = planUpdates(sourceRows, mainRows, args.overwrite)
  console.log(`[info] planned updates: ${updates.length}, skipped: ${skipped.length}`)
  if (stats.srcKeyAmbiguous || stats.mainKeyAmbiguous) {
    console.log(
      `[info] ambiguous keys — source: ${stats.srcKeyAmbiguous}, main: ${stats.mainKeyAmbiguous} (name+company not used when ambiguous)`,
    )
  }

  const sampleLegacy = updates.filter((u) => u.url.includes(LEGACY_PUBLIC_PREFIX)).length
  console.log(`[info] updates using legacy public object URLs: ${sampleLegacy}/${updates.length}`)

  if (args.verifyUrls && updates.length) {
    await verifySampleUrls(updates.map((u) => u.url))
  }

  if (args.dryRun) {
    console.log('[dry-run] first 10 updates:', updates.slice(0, 10))
    const reasons = {}
    for (const s of skipped) {
      reasons[s.reason] = (reasons[s.reason] || 0) + 1
    }
    console.log('[dry-run] skip reasons:', reasons)
    return
  }

  if (!process.env.DB_URL) {
    console.error('DB_URL required to apply updates.')
    process.exit(1)
  }

  const client = new pg.Client({
    connectionString: process.env.DB_URL,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    await client.query('begin')
    let applied = 0
    for (const u of updates) {
      const r = await client.query(
        `UPDATE products SET image_url = $2, updated_at = NOW() WHERE id = $1`,
        [u.id, u.url],
      )
      applied += r.rowCount || 0
    }
    await client.query('commit')
    console.log(`[ok] applied ${applied} row(s).`)
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    await client.end()
  }

  const reasons = {}
  for (const s of skipped) {
    reasons[s.reason] = (reasons[s.reason] || 0) + 1
  }
  console.log('[info] skip summary:', reasons)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
