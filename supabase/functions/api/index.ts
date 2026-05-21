// @ts-nocheck
import {
  create,
  verify,
} from 'https://deno.land/x/djwt@v3.0.2/mod.ts'
import pg from 'npm:pg@8.13.1'
import { createInvoiceInternal, insertPaymentWithRouting, replaceInvoiceInternal } from './invoice_logic.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
}

const pool = new pg.Pool({
  connectionString: Deno.env.get('DB_URL')!,
  max: 10,
  ssl: { rejectUnauthorized: false },
})

let cachedTopProducts: any[] | null = null
let lastTopProductsFetchTime = 0


/** Same cap as server/db.js — data URLs must fit in JSON + DB TEXT. */
const MAX_PRODUCT_IMAGE_URL_LEN = 800_000
function normalizeProductImageUrl(v: unknown): string | null {
  if (v == null || v === '') return null
  const s = String(v)
  if (s.length > MAX_PRODUCT_IMAGE_URL_LEN) {
    throw Object.assign(new Error('صورة المنتج كبيرة جداً — قلّل الحجم وحاول مجدداً'), {
      status: 400,
    })
  }
  return s
}

function normalizeArabicNumbers(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .replace(/٪/g, '%')
}

async function query(sql: string, params: unknown[] = []) {
  const client = await pool.connect()
  try {
    return await client.query(sql, params)
  } finally {
    client.release()
  }
}

async function syncWarehouseStockFromBatches(productId: number, warehouseId: number) {
  await query(
    `
      insert into product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
      values (
        $1,
        $2,
        coalesce((
          select sum(
            case when coalesce(unit_type, 'piece') = 'bulk'
              then coalesce(kg_remaining, 0)
              else coalesce(quantity, 0)
            end
          )
          from product_batches
          where product_id = $1 and warehouse_id = $2
        ), 0),
        now()
      )
      on conflict (product_id, warehouse_id) do update
      set quantity = excluded.quantity, updated_at = now()
    `,
    [productId, warehouseId],
  )
}

async function transaction<T>(
  run: (q: (sql: string, params?: unknown[]) => Promise<ReturnType<typeof query>>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  const q = (sql: string, params: unknown[] = []) => client.query(sql, params) as ReturnType<typeof query>
  try {
    await client.query('begin')
    const result = await run(q)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}

function stripApiV1Prefix(rawPath: string) {
  let p = (rawPath || '/').split('?')[0]
  // Hosted Supabase Edge URL path is /functions/v1/<functionName>/… — router expects /… only
  if (p.startsWith('/functions/v1/')) {
    const after = p.slice('/functions/v1/'.length)
    const parts = after.split('/').filter((s) => s.length > 0)
    if (parts.length <= 1) {
      p = '/'
    } else {
      p = `/${parts.slice(1).join('/')}`
    }
  }
  while (p.startsWith('/api/v1') || p.startsWith('/api')) {
    if (p.startsWith('/api/v1')) {
      p = p.slice('/api/v1'.length)
    } else if (p.startsWith('/api')) {
      p = p.slice('/api'.length)
    }
    if (!p) p = '/'
  }
  return p || '/'
}

async function buildJwtKey() {
  const secret = Deno.env.get('JWT_SECRET')
  if (!secret) throw Object.assign(new Error('JWT secret is not configured'), { status: 500 })
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function verifyJWT(token: string) {
  try {
    const key = await buildJwtKey()
    return await verify(token, key)
  } catch {
    throw Object.assign(new Error('Unauthorized'), { status: 401 })
  }
}

async function signJWT(payload: Record<string, unknown>) {
  const key = await buildJwtKey()
  return await create({ alg: 'HS256', typ: 'JWT' }, payload, key)
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string) {
  const pairs = hex.match(/.{2}/g) || []
  return new Uint8Array(pairs.map((h) => parseInt(h, 16)))
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
  return `pbkdf2:${toHex(salt)}:${toHex(new Uint8Array(bits))}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('$2')) return false
  if (!stored.startsWith('pbkdf2:')) return false
  const [, saltHex, storedHashHex] = stored.split(':')
  const salt = fromHex(saltHex)
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
  const hashHex = toHex(new Uint8Array(bits))
  return hashHex === storedHashHex
}

async function verifySupabaseAuthUser(email: string, password: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('VITE_SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('VITE_SUPABASE_ANON_KEY')
  if (supabaseUrl && anonKey) {
    try {
      const r = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ email, password }),
      })
      if (r.ok) {
        const data = await r.json() as { user?: Record<string, unknown> }
        if (data?.user) {
          return {
            id: data.user.id,
            email: data.user.email,
            raw_user_meta_data: data.user.user_metadata ?? {},
          } as Record<string, unknown>
        }
      }
    } catch {
      // Fallback to direct SQL verification below.
    }
  }
  try {
    const out = await query(
      `select id, email, raw_user_meta_data
       from auth.users
       where lower(email) = lower($1)
         and encrypted_password = crypt($2, encrypted_password)
       limit 1`,
      [email, password],
    )
    return out.rows?.[0] as Record<string, unknown> | undefined
  } catch {
    return undefined
  }
}

async function ensureAuthUserByEmail(args: {
  email: string
  password: string
  displayName: string
  role: string
}) {
  const { email, password, displayName, role } = args
  const existing = await query(
    `select id
     from auth.users
     where lower(email) = lower($1)
     limit 1`,
    [email],
  )
  const existingId = existing.rows?.[0]?.id as string | undefined
  if (existingId) {
    await query(
      `update auth.users
       set encrypted_password = crypt($2, gen_salt('bf')),
           raw_user_meta_data = coalesce(raw_user_meta_data,'{}'::jsonb) ||
             jsonb_build_object('display_name', $3::text, 'role', $4::text),
           updated_at = now()
       where id = $1::uuid`,
      [existingId, password, displayName, role],
    )
    await query(
      `insert into auth.identities
       (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values
       (gen_random_uuid(), $1::text, $1::uuid,
        jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true),
        'email', now(), now(), now())
       on conflict (provider_id, provider) do nothing`,
      [existingId, email],
    )
    return existingId
  }

  const created = await query(
    `insert into auth.users
     (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values
     ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, crypt($2, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('display_name', $3::text, 'role', $4::text),
      now(), now())
     returning id`,
    [email, password, displayName, role],
  )
  const authId = created.rows?.[0]?.id as string | undefined
  if (!authId) throw new Error('فشل إنشاء مستخدم المصادقة')
  await query(
    `insert into auth.identities
     (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values
     (gen_random_uuid(), $1::text, $1::uuid,
      jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true),
      'email', now(), now(), now())
     on conflict (provider_id, provider) do nothing`,
    [authId, email],
  )
  return authId
}

function send(status: number, body: unknown) {
  return new Response(
    status === 204 ? null : JSON.stringify(body),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
}

async function parseJson(req: Request) {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

/** مبالغ تُسجَّل كدفعة فعلية (تظهر في سجل السداد) — ليست تسويات آجل */
const CASH_LIKE_PAYMENT_METHODS = new Set(['cash', 'vodafone_cash', 'instapay'])

function isDeferredLikePaymentMethod(m: string): boolean {
  const s = m.trim()
  return s === 'deferred' || s === 'آجل' || s === 'credit'
}

function normalizeRegisterPaymentMethod(raw: unknown):
  | { ok: true; value: string }
  | { ok: false; message: string } {
  const m = String(raw ?? 'cash').trim() || 'cash'
  if (isDeferredLikePaymentMethod(m)) {
    return {
      ok: false,
      message:
        'لا يمكن تسجيل دفعة آجل من هنا — سجل السداد للدفعات النقدية والإلكترونية فقط. للآجل استخدم الفاتورة.',
    }
  }
  if (!CASH_LIKE_PAYMENT_METHODS.has(m) && m !== 'discount') {
    return { ok: false, message: 'طريقة الدفع غير مدعومة.' }
  }
  return { ok: true, value: m }
}

async function requireAuth(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw Object.assign(new Error('Unauthorized'), { status: 401 })
  return await verifyJWT(token)
}

async function rpc(name: string, args: unknown[]) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ')
  const sql = `select ${name}(${placeholders}) as result`
  const out = await query(sql, args)
  return out.rows?.[0]?.result ?? null
}

function toYmd(v: string | Date) {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function paymentAmountTowardArStatement(p: { payment_method?: unknown }): boolean {
  const m = String(p?.payment_method ?? '')
  return m !== 'deferred' && m !== 'آجل' && m !== 'credit'
}

function formatPaymentDescriptionArStatement(amount: number, paymentMethod: unknown): string {
  const m = String(paymentMethod || '')
  const methodAr =
    m === 'cash'
      ? 'كاش'
      : m === 'deferred'
        ? 'آجل'
        : m === 'vodafone_cash'
          ? 'فودافون كاش'
          : m === 'instapay'
            ? 'انستاباي'
            : m === 'discount'
              ? 'خصم من المديونية'
              : m === 'historical_invoice_paid'
                ? 'مدفوع (ترحيل)'
                : m || '—'
  const n = Math.round(Number(amount) || 0)
  const formatted = new Intl.NumberFormat('ar-EG', {
    numberingSystem: 'latn',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
  
  if (m === 'discount') return `خصم من المديونية: ${formatted} ج.م`
  return `سداد ${formatted} ج.م — ${methodAr}`
}

function computeInvoiceQuantityUnitPriceStatement(
  items: Array<{ quantity?: unknown; total_price?: unknown }>,
): { quantity: number | null; unit_price: number | null } {
  if (!items || items.length === 0) return { quantity: null, unit_price: null }
  const sumQty = items.reduce((a, it) => a + (Number(it.quantity) || 0), 0)
  if (sumQty <= 0) return { quantity: null, unit_price: null }
  if (items.length === 1) {
    const tp = Number(items[0].total_price) || 0
    const q = Number(items[0].quantity) || 0
    return { quantity: sumQty, unit_price: q > 0 ? tp / q : null }
  }
  return { quantity: sumQty, unit_price: null }
}

function statementDisplayAmountEdge(m: {
  type: string
  debit?: unknown
  credit?: unknown
  display_debit?: unknown
  display_credit?: unknown
}): number {
  if (m.type === 'invoice') return Number(m.debit || 0)
  return Math.max(
    Number(m.display_debit || 0),
    Number(m.display_credit || 0),
    Number(m.credit || 0),
    Number(m.debit || 0),
  )
}

async function buildAccountStatement(params: {
  clientId?: number
  barnId?: number
  from?: string
  to?: string
}) {
  const { clientId, barnId } = params
  const from = params.from?.trim()
  const to = params.to?.trim()
  const baseArgs: unknown[] = []
  const whereInvoicesBase: string[] = ["coalesce(i.invoice_lifecycle,'active') != 'cancelled'"]
  const wherePaymentsBase: string[] = []
  if (clientId != null) {
    baseArgs.push(clientId)
    whereInvoicesBase.push(`i.client_id = $${baseArgs.length}`)
    wherePaymentsBase.push(`p.client_id = $${baseArgs.length}`)
  }
  if (barnId != null) {
    baseArgs.push(barnId)
    whereInvoicesBase.push(`i.barn_id = $${baseArgs.length}`)
    wherePaymentsBase.push(`p.barn_id = $${baseArgs.length}`)
  }
  const rangeArgs = [...baseArgs]
  const whereInvoices = [...whereInvoicesBase]
  const wherePayments = [...wherePaymentsBase]
  if (from) {
    rangeArgs.push(from)
    whereInvoices.push(`i.created_at::date >= $${rangeArgs.length}::date`)
    wherePayments.push(`p.payment_date::date >= $${rangeArgs.length}::date`)
  }
  if (to) {
    rangeArgs.push(to)
    whereInvoices.push(`i.created_at::date <= $${rangeArgs.length}::date`)
    wherePayments.push(`p.payment_date::date <= $${rangeArgs.length}::date`)
  }

  let opening = 0
  if (clientId != null) {
    const cr = await query('select coalesce(initial_debt,0)::float as d from clients where id = $1', [clientId])
    const br = await query('select coalesce(sum(initial_debt),0)::float as d from barns where client_id = $1', [clientId])
    opening += Number(cr.rows?.[0]?.d ?? 0) + Number(br.rows?.[0]?.d ?? 0)
  } else if (barnId != null) {
    const br = await query('select coalesce(initial_debt,0)::float as d from barns where id = $1', [barnId])
    opening += Number(br.rows?.[0]?.d ?? 0)
  }

  const openingArgs = [...baseArgs]
  if (from) {
    openingArgs.push(from)
    const cutoffPos = openingArgs.length
    const openInv = await query(
      `select coalesce(sum(i.total_amount),0) as s
       from invoices i
       where ${whereInvoicesBase.join(' and ')} and i.created_at::date < $${cutoffPos}::date`,
      openingArgs,
    )
    const openPayRows = await query(
      `select p.amount, p.payment_method from payments p
       where ${wherePaymentsBase.join(' and ')} and p.payment_date::date < $${cutoffPos}::date`,
      openingArgs,
    )
    let paySum = 0
    for (const pr of openPayRows.rows as Array<{ amount: unknown; payment_method: unknown }>) {
      if (paymentAmountTowardArStatement(pr)) paySum += Number(pr.amount ?? 0)
    }
    opening += Number(openInv.rows?.[0]?.s ?? 0) - paySum
  }

  const inv = await query(
    `select i.id as invoice_id, i.created_at, i.total_amount, i.paid_amount, i.remaining_amount, i.status, b.name as barn_name
     from invoices i
     left join barns b on b.id = i.barn_id
     where ${whereInvoices.join(' and ')}
     order by i.created_at asc, i.id asc`,
    rangeArgs,
  )
  const pay = await query(
    `select p.id as payment_id, p.payment_date, p.created_at, p.amount, p.payment_method, p.invoice_id, p.notes, p.settled_at, b.name as barn_name
     from payments p
     left join barns b on b.id = p.barn_id
     where ${wherePayments.join(' and ')}
     order by p.payment_date asc, p.id asc`,
    rangeArgs,
  )

  const invRows = inv.rows as Array<Record<string, unknown>>
  const invIds = invRows.map((r) => Number(r.invoice_id)).filter((id) => Number.isFinite(id))
  const itemsByInvoice = new Map<number, Array<{ product_name: string; quantity: number; total_price: number }>>()
  if (invIds.length > 0) {
    const itemOut = await query(
      `select invoice_id, product_name, quantity, total_price from invoice_items where invoice_id = any($1::int[])`,
      [invIds],
    )
    for (const it of itemOut.rows as Array<Record<string, unknown>>) {
      const iid = Number(it.invoice_id)
      if (!itemsByInvoice.has(iid)) itemsByInvoice.set(iid, [])
      itemsByInvoice.get(iid)!.push({
        product_name: String(it.product_name ?? ''),
        quantity: Number(it.quantity) || 0,
        total_price: Number(it.total_price) || 0,
      })
    }
  }

  const merged: Array<Record<string, unknown>> = [
    ...invRows.map((i) => {
      const id = Number(i.invoice_id)
      const items = itemsByInvoice.get(id) || []
      return {
        date: i.created_at,
        sort_at: i.created_at,
        type: 'invoice',
        description: `فاتورة #${id}`,
        debit: Number(i.total_amount ?? 0),
        credit: 0,
        display_debit: Number(i.total_amount ?? 0),
        display_credit: Number(i.paid_amount ?? 0) > 0 ? Number(i.paid_amount ?? 0) : 0,
        invoice_id: id,
        invoice_total: Number(i.total_amount ?? 0),
        paid: Number(i.paid_amount ?? 0),
        remaining: Number(i.remaining_amount ?? 0),
        status: i.status ?? '',
        items,
        barn_name: i.barn_name ?? null,
        ledger_skip: false,
      }
    }),
    ...(pay.rows as Array<Record<string, unknown>>)
      .map((p) => {
        const settles = paymentAmountTowardArStatement(p)
        if (!settles) return null
        const amt = Number(p.amount ?? 0)
        const desc = formatPaymentDescriptionArStatement(amt, p.payment_method)
        return {
          date: p.payment_date || p.created_at,
          sort_at: p.created_at || p.payment_date || p.date,
          type: 'payment',
          description: desc,
          debit: 0,
          credit: amt,
          display_debit: 0,
          display_credit: amt,
          payment_id: Number(p.payment_id),
          payment_amount: amt,
          payment_method: p.payment_method,
          invoice_id_link: p.invoice_id,
          settled_at: p.settled_at,
          barn_name: p.barn_name ?? null,
          ledger_skip: false,
        }
      })
      .filter((p): p is Record<string, unknown> => p !== null),
  ]

  merged.sort((a, b) => {
    const aTs = new Date(String(a.sort_at ?? a.date)).getTime()
    const bTs = new Date(String(b.sort_at ?? b.date)).getTime()
    if (aTs !== bTs) return aTs - bTs
    const aType = a.type === 'invoice' ? 0 : 1
    const bType = b.type === 'invoice' ? 0 : 1
    if (aType !== bType) return aType - bType
    const aId = a.type === 'invoice' ? Number(a.invoice_id ?? 0) : Number(a.payment_id ?? 0)
    const bId = b.type === 'invoice' ? Number(b.invoice_id ?? 0) : Number(b.payment_id ?? 0)
    return aId - bId
  })

  const outRows: Array<Record<string, unknown>> = []
  let runningBalance = opening
  let rowSeq = 0
  for (const m of merged) {
    rowSeq += 1
    const amountForRow = statementDisplayAmountEdge(m as { type: string; debit?: unknown; credit?: unknown; display_debit?: unknown; display_credit?: unknown })
    if (m.type === 'invoice') {
      runningBalance += amountForRow
    } else {
      runningBalance -= amountForRow
    }
    const direction = m.type === 'invoice' ? 'debit' : 'credit'
    const qpu =
      m.type === 'invoice'
        ? computeInvoiceQuantityUnitPriceStatement(
            (m.items as Array<{ quantity?: unknown; total_price?: unknown }>) || [],
          )
        : { quantity: null, unit_price: null }
    const row: Record<string, unknown> = {
      id: rowSeq,
      date: toYmd(String(m.date ?? '')),
      sort_at: String(m.sort_at ?? m.date ?? ''),
      type: m.type,
      description: m.description,
      quantity: qpu.quantity,
      unit_price: qpu.unit_price,
      amount: amountForRow,
      direction,
      running_balance: runningBalance,
    }
    if (m.type === 'invoice') {
      row.invoice_id = m.invoice_id
      const items = m.items as unknown[] | undefined
      if (items && items.length) row.items = items
    } else {
      row.payment_id = m.payment_id
      if (m.payment_method) row.payment_method = m.payment_method
      if (m.settled_at) row.settled_at = m.settled_at
    }
    outRows.push(row)
  }

  return { opening_balance: opening, closing_balance: runningBalance, rows: outRows }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const params = url.searchParams
    const method = req.method
    const path = stripApiV1Prefix(url.pathname)

    // Stage A: auth + core read endpoint + heavy transaction RPC routes.
    if (method === 'GET' && path === '/auth/status') {
      const result = await query('select count(*)::int as count from auth.users')
      const count = Number(result.rows?.[0]?.count ?? 0)
      return send(200, { needsBootstrap: count === 0, hasUsers: count > 0 })
    }

    if (method === 'POST' && path === '/auth/bootstrap') {
      const body = await parseJson(req) as Record<string, unknown>
      const email = String(body.email || '').trim()
      const password = String(body.password || '')
      const displayName = String(body.display_name || 'مدير النظام')
      if (!email || !password) return send(400, { message: 'البريد وكلمة المرور مطلوبان' })
      if (password.length < 8) return send(400, { message: 'كلمة المرور 8 أحرف على الأقل للمسؤول الأول' })

      const existing = await query('select count(*)::int as count from auth.users')
      if (Number(existing.rows?.[0]?.count ?? 0) > 0) return send(403, { message: 'يوجد مستخدمون بالفعل' })

      const authInsert = await query(
        `insert into auth.users
         (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values
         ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, crypt($2, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('display_name', $3::text, 'role', 'super_admin'),
          now(), now())
         returning id, email`,
        [email, password, displayName],
      )
      if (!authInsert.rows?.[0]) return send(500, { message: 'فشل إنشاء مستخدم المصادقة' })
      const authUser = authInsert.rows[0] as Record<string, unknown>
      await query(
        `insert into auth.identities
         (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
         values
         (gen_random_uuid(), $1::text, $1::uuid,
          jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true),
          'email', now(), now(), now())
         on conflict (provider_id, provider) do nothing`,
        [String(authUser.id), email],
      )

      const hash = await hashPassword(password)
      const inserted = await query(
        `insert into users (email, password_hash, display_name, role, is_active, created_at, updated_at)
         values ($1,$2,$3,'super_admin',true,now(),now())
         returning id, email, display_name, role, is_active`,
        [email, hash, displayName],
      )
      const user = inserted.rows[0]
      const accessToken = await signJWT({
        sub: String(user.id),
        email: user.email,
        role: user.role,
      })
      return send(201, { accessToken, refreshToken: accessToken, user })
    }

    if (method === 'POST' && path === '/auth/login') {
      const body = await parseJson(req) as Record<string, unknown>
      const email = String(body.email || '').trim()
      const password = String(body.password || '')
      if (!email || !password) return send(400, { message: 'البريد وكلمة المرور مطلوبان' })

      // 1. Source of truth for registration: the application's users table.
      const local = await query(
        `select id, email, password_hash, display_name, role, is_active
         from users
         where lower(email) = lower($1)
         limit 1`,
        [email],
      )
      const appUser = local.rows?.[0] as Record<string, unknown> | undefined
      if (!appUser) return send(401, { message: 'البريد أو كلمة المرور غير صحيحة' })
      if (appUser.is_active === false) return send(403, { message: 'الحساب غير مفعل' })

      // 2. Verify password (preferring Supabase Auth).
      let authUser = await verifySupabaseAuthUser(email, password)
      if (!authUser) {
        // Backfill path: verify against local password_hash if not in Supabase Auth yet.
        const valid = await verifyPassword(password, String(appUser.password_hash || ''))
        if (!valid) return send(401, { message: 'البريد أو كلمة المرور غير صحيحة' })
        
        // Sync to Supabase Auth for standard verification in future sessions.
        await ensureAuthUserByEmail({
          email,
          password,
          displayName: String(appUser.display_name || email.split('@')[0]),
          role: String(appUser.role || 'staff'),
        })
        authUser = await verifySupabaseAuthUser(email, password)
        if (!authUser) return send(401, { message: 'البريد أو كلمة المرور غير صحيحة' })
      }

      const role = String(appUser.role || 'staff')
      const displayName = String(appUser.display_name || email.split('@')[0])
      const hash = await hashPassword(password)
      
      // Update the user record with latest password hash (and ensure email matches casing)
      await query(
        `update users
         set password_hash = $2,
             updated_at = now()
         where id = $1`,
        [appUser.id, hash],
      )
      
      const user = {
        id: appUser.id,
        email: appUser.email,
        display_name: appUser.display_name,
        role: appUser.role,
        is_active: appUser.is_active,
      }
      const accessToken = await signJWT({
        sub: String(appUser.id),
        email: String(appUser.email),
        role: String(appUser.role),
      })
      return send(200, { accessToken, refreshToken: accessToken, user })
    }

    if (method === 'POST' && path === '/auth/logout') {
      return send(200, { ok: true })
    }

    if (method === 'GET' && path === '/auth/me') {
      const auth = await requireAuth(req) as Record<string, unknown>
      const uid = Number(auth.sub)
      const out = await query(
        'select id, email, display_name, role, is_active from users where id = $1 limit 1',
        [uid],
      )
      const user = out.rows?.[0]
      if (!user) return send(401, { message: 'Unauthorized' })
      return send(200, user)
    }

    if (method === 'GET' && path === '/warehouses') {
      await requireAuth(req)
      const out = await query('select * from warehouses order by id asc')
      return send(200, out.rows)
    }

    const whStockMap = path.match(/^\/warehouses\/(\d+)\/stock-map$/)
    if (method === 'GET' && whStockMap) {
      await requireAuth(req)
      const wid = Number(whStockMap[1])
      const out = await query(
        'select product_id, quantity from product_warehouse_stock where warehouse_id = $1',
        [wid],
      )
      const map: Record<number, number> = {}
      for (const r of out.rows as Array<{ product_id: number; quantity: string | number }>) {
        map[Number(r.product_id)] = Number(r.quantity ?? 0)
      }
      return send(200, map)
    }

    const whProductsWithStock = path.match(/^\/warehouses\/(\d+)\/products-with-stock$/)
    if (method === 'GET' && whProductsWithStock) {
      await requireAuth(req)
      const wid = Number(whProductsWithStock[1])
      const out = await query(
        `select p.id, p.name, p.company, p.category, p.barcode, p.unit_type, p.bag_weight_kg,
                p.purchase_price, p.selling_price, p.alert_level, p.alert_level_kg,
                p.expiry_date, p.image_url, p.is_active, p.created_at, p.updated_at,
                s.quantity as stock
         from product_warehouse_stock s
         join products p on p.id = s.product_id
         where s.warehouse_id = $1 and s.quantity > 0
         order by p.id desc`,
        [wid],
      )
      return send(200, out.rows.map((r) => ({ product: r, stock: Number((r as any).stock ?? 0) })))
    }

    const whBatches = path.match(/^\/warehouses\/(\d+)\/batches$/)
    if (method === 'GET' && whBatches) {
      await requireAuth(req)
      const out = await query(
        `select * from product_batches 
         where warehouse_id = $1 
         and (quantity > 0 or kg_remaining > 0)
         order by id desc`,
        [Number(whBatches[1])]
      )
      return send(200, out.rows)
    }

    const whPickerData = path.match(/^\/warehouses\/(\d+)\/picker-data$/)
    if (method === 'GET' && whPickerData) {
      await requireAuth(req)
      const wid = Number(whPickerData[1])
      
      const client = await pool.connect()
      try {
        const productsOut = await client.query(
          `select p.id, p.name, p.company, p.category, p.barcode, p.unit_type, p.bag_weight_kg,
                  p.purchase_price, p.selling_price, p.alert_level, p.alert_level_kg,
                  p.expiry_date, p.is_active, p.created_at, p.updated_at,
                  s.quantity as stock
           from product_warehouse_stock s
           join products p on p.id = s.product_id
           where s.warehouse_id = $1 and s.quantity > 0
           order by p.id desc`,
          [wid]
        )
        
        const batchesOut = await client.query(
          `select * from product_batches 
           where warehouse_id = $1 
           and (quantity > 0 or kg_remaining > 0)
           order by id desc`,
          [wid]
        )
        
        let topSellingRows: any[] = []
        const now = Date.now()
        if (cachedTopProducts && (now - lastTopProductsFetchTime) < 60_000) {
          topSellingRows = cachedTopProducts
        } else {
          const topProductsOut = await client.query(
            `select ii.product_id,
                    coalesce(p.name, ii.product_name) as name,
                    coalesce(sum(ii.total_price),0) as total_sales,
                    coalesce(sum(ii.quantity),0) as total_quantity
             from invoice_items ii
             join invoices i on i.id = ii.invoice_id
             left join products p on p.id = ii.product_id
             where coalesce(i.invoice_lifecycle,'active') != 'cancelled'
             group by ii.product_id, coalesce(p.name, ii.product_name)
             order by total_sales desc
             limit 10`,
            []
          )
          topSellingRows = topProductsOut.rows
          cachedTopProducts = topSellingRows
          lastTopProductsFetchTime = now
        }

        return send(200, {
          productsWithStock: productsOut.rows.map((r) => ({ product: r, stock: Number((r as any).stock ?? 0) })),
          warehouseBatches: batchesOut.rows,
          topSellingRows: topSellingRows
        })
      } finally {
        client.release()
      }
    }


    if (method === 'GET' && path === '/categories/options') {
      await requireAuth(req)
      const out = await query("select distinct category as name_ar from products where category is not null and category != '' order by category asc")
      return send(200, out.rows.map((r) => (r as { name_ar: string }).name_ar))
    }

    if (method === 'POST' && path === '/categories') {
      await requireAuth(req)
      const body = await parseJson(req) as Record<string, unknown>
      const name = String(body.name_ar || '').trim()
      if (!name) return send(400, { message: 'الاسم مطلوب' })
      const out = await query(
        'insert into categories (name_ar, created_at) values ($1, now()) returning id, name_ar',
        [name],
      )
      return send(200, out.rows?.[0] ?? { id: null, name_ar: name })
    }

    if (method === 'GET' && path === '/clients') {
      await requireAuth(req)
      const sp = url.searchParams
      const limit = Math.min(Number(sp.get('limit') || 50), 500)
      const search = normalizeArabicNumbers(sp.get('search') || '')
      const pinned = sp.get('pinned')
      const where: string[] = []
      const args: unknown[] = []
      if (search) {
        args.push(`%${search}%`)
        where.push(`(translate(c.name, '٠١٢٣٤٥٦٧٨٩٪', '0123456789%') ilike $${args.length} or coalesce(translate(c.phone, '٠١٢٣٤٥٦٧٨٩٪', '0123456789%'),'') ilike $${args.length})`)
      }
      if (pinned === 'true') where.push('coalesce(c.pinned,false) = true')
      const whereSql = where.length ? `where ${where.join(' and ')}` : ''
      const balanceExpr = `(
        coalesce(c.initial_debt,0) +
        coalesce((select sum(initial_debt) from barns where client_id = c.id), 0) +
        coalesce((
          select sum(i.total_amount)
          from invoices i
          where i.client_id = c.id and coalesce(i.invoice_lifecycle,'active') != 'cancelled'
        ),0) -
        coalesce((
          select sum(case when coalesce(p.payment_method,'') in ('deferred','آجل','credit') then 0 else p.amount end)
          from payments p
          where p.client_id = c.id
        ),0)
      )`
      const orderSql = `order by
        case when coalesce(c.pinned, false) then 0 else 1 end,
        c.pinned_at asc nulls last,
        ${balanceExpr} desc,
        c.id desc`
      args.push(limit)
      const out = await query(
        `select c.*, ${balanceExpr} as balance
         from clients c
         ${whereSql}
         ${orderSql}
         limit $${args.length}`,
        args,
      )
      return send(200, { data: out.rows, total: out.rows.length, debt_alert_threshold_egp: 5000 })
    }

    const getClient = path.match(/^\/clients\/(\d+)$/)
    if (method === 'GET' && getClient) {
      await requireAuth(req)
      const out = await query('select * from clients where id = $1 limit 1', [Number(getClient[1])])
      const row = out.rows?.[0]
      if (!row) return send(404, { message: 'العميل غير موجود' })
      return send(200, row)
    }

    if (method === 'POST' && path === '/clients') {
      await requireAuth(req)
      const body = await parseJson(req) as Record<string, unknown>
      const out = await query(
        `insert into clients
         (name, phone, location, initial_debt, notes, favorite, pinned, created_at, updated_at)
         values ($1,$2,$3,$4,$5,false,false,now(),now())
         returning *`,
        [
          String(body.name || ''),
          body.phone ?? null,
          body.location ?? null,
          Number(body.initial_debt ?? 0),
          body.notes ?? null,
        ],
      )
      return send(200, out.rows?.[0])
    }

    if (method === 'PATCH' && getClient) {
      await requireAuth(req)
      const id = Number(getClient[1])
      const body = await parseJson(req) as Record<string, unknown>
      const fields: string[] = []
      const vals: unknown[] = []
      const add = (k: string, v: unknown) => { vals.push(v); fields.push(`${k} = $${vals.length}`) }
      if (body.name !== undefined) add('name', body.name)
      if (body.phone !== undefined) add('phone', body.phone)
      if (body.location !== undefined) add('location', body.location)
      if (body.initial_debt !== undefined) add('initial_debt', Number(body.initial_debt))
      if (body.notes !== undefined) add('notes', body.notes)
      if (!fields.length) {
        const cur = await query('select * from clients where id = $1 limit 1', [id])
        return send(200, cur.rows?.[0])
      }
      vals.push(id)
      const out = await query(
        `update clients set ${fields.join(', ')}, updated_at = now() where id = $${vals.length} returning *`,
        vals,
      )
      const row = out.rows?.[0]
      if (!row) return send(404, { message: 'العميل غير موجود' })
      return send(200, row)
    }

    if (method === 'DELETE' && getClient) {
      await requireAuth(req)
      await query('delete from clients where id = $1', [Number(getClient[1])])
      return send(204, {})
    }

    const getClientBarns = path.match(/^\/clients\/(\d+)\/barns$/)
    if (method === 'GET' && getClientBarns) {
      await requireAuth(req)
      const cid = Number(getClientBarns[1])
      const out = await query(
        `SELECT b.*,
           COALESCE((SELECT SUM(total_amount) FROM invoices i WHERE i.barn_id = b.id AND COALESCE(i.invoice_lifecycle,'active') != 'cancelled'), 0) AS inv_total,
           COALESCE((SELECT SUM(CASE WHEN COALESCE(p.payment_method,'') IN ('deferred','آجل','credit') THEN 0 ELSE p.amount END) FROM payments p WHERE p.barn_id = b.id), 0) AS paid
         FROM barns b
         WHERE b.client_id = $1
         ORDER BY b.id DESC`,
        [cid]
      )
      return send(
        200,
        out.rows.map((row) => {
          const invTotal = Number(row.inv_total ?? 0)
          const paid = Number(row.paid ?? 0)
          const initialDebt = Number(row.initial_debt ?? 0)
          const totalAccount = initialDebt + invTotal
          return {
            ...row,
            total_account: totalAccount,
            total_paid: paid,
            balance: totalAccount - paid,
          }
        })
      )
    }

    if (method === 'POST' && getClientBarns) {
      await requireAuth(req)
      const cid = Number(getClientBarns[1])
      const body = await parseJson(req) as Record<string, unknown>
      const out = await query(
        `insert into barns (client_id, name, initial_debt, total_invoices, total_profit, created_at, updated_at)
         values ($1,$2,$3,0,0,now(),now()) returning *`,
        [cid, String(body.name || ''), Number(body.initial_debt ?? 0)],
      )
      return send(200, out.rows?.[0])
    }

    const clientPin = path.match(/^\/clients\/(\d+)\/pin$/)
    if (method === 'PATCH' && clientPin) {
      await requireAuth(req)
      const out = await query(
        `update clients set pinned = not coalesce(pinned,false), pinned_at = case when not coalesce(pinned,false) then now() else null end, updated_at = now()
         where id = $1 returning *`,
        [Number(clientPin[1])],
      )
      const row = out.rows?.[0]
      if (!row) return send(404, { message: 'العميل غير موجود' })
      return send(200, row)
    }

    const clientFav = path.match(/^\/clients\/(\d+)\/favorite$/)
    if (method === 'PATCH' && clientFav) {
      await requireAuth(req)
      const out = await query(
        `update clients set favorite = not coalesce(favorite,false), updated_at = now()
         where id = $1 returning *`,
        [Number(clientFav[1])],
      )
      const row = out.rows?.[0]
      if (!row) return send(404, { message: 'العميل غير موجود' })
      return send(200, row)
    }

    const clientPayments = path.match(/^\/clients\/(\d+)\/payments$/)
    if (method === 'POST' && clientPayments) {
      await requireAuth(req)
      const clientId = Number(clientPayments[1])
      const body = await parseJson(req) as Record<string, unknown>
      const pm = normalizeRegisterPaymentMethod(body.payment_method)
      if (!pm.ok) return send(400, { message: pm.message })

      const payment = await transaction(async (q) => {
        const pay = await insertPaymentWithRouting(q, {
          client_id: clientId,
          barn_id: body.barn_id ?? null,
          amount: Number(body.amount ?? 0),
          payment_method: pm.value,
          notes: body.notes ?? null,
          payment_date: body.payment_date ?? new Date().toISOString().slice(0, 10),
          invoice_id: body.invoice_id ?? null,
          wallet_id: body.wallet_id ?? null,
        })

        if (pm.value === 'discount') {
          await q(
            'UPDATE clients SET total_profit = GREATEST(0, COALESCE(total_profit, 0) - $1) WHERE id = $2',
            [pay.amount, pay.client_id]
          )
          if (pay.barn_id) {
            await q(
              'UPDATE barns SET total_profit = GREATEST(0, COALESCE(total_profit, 0) - $1) WHERE id = $2',
              [pay.amount, pay.barn_id]
            )
          }
        }

        return pay
      })

      return send(200, payment)
    }

    const getClientBalance = path.match(/^\/clients\/(\d+)\/balance$/)
    if (method === 'GET' && getClientBalance) {
      await requireAuth(req)
      const cid = Number(getClientBalance[1])
      const out = await query(
        `select
           coalesce((select initial_debt from clients where id = $1),0) + coalesce((select sum(initial_debt) from barns where client_id = $1), 0) as initial_debt,
           coalesce((select sum(total_amount) from invoices where client_id = $1 and coalesce(invoice_lifecycle,'active') != 'cancelled'), 0) as inv_total,
           coalesce((select sum(case when coalesce(payment_method,'') in ('deferred', 'آجل', 'credit') then 0 else amount end) from payments where client_id = $1), 0) as paid`,
        [cid]
      )
      const row = out.rows?.[0]
      const initialDebt = Number(row?.initial_debt ?? 0)
      const invTotal = Number(row?.inv_total ?? 0)
      const paid = Number(row?.paid ?? 0)
      const totalAccount = initialDebt + invTotal
      return send(200, {
        total_account: totalAccount,
        total_paid: paid,
        balance: totalAccount - paid,
      })
    }

    const getBarn = path.match(/^\/barns\/(\d+)$/)
    if (method === 'GET' && getBarn) {
      await requireAuth(req)
      const out = await query(
        `SELECT b.*,
           COALESCE((SELECT SUM(total_amount) FROM invoices i WHERE i.barn_id = b.id AND COALESCE(i.invoice_lifecycle,'active') != 'cancelled'), 0) AS inv_total,
           COALESCE((SELECT SUM(CASE WHEN COALESCE(p.payment_method,'') IN ('deferred','آجل','credit') THEN 0 ELSE p.amount END) FROM payments p WHERE p.barn_id = b.id), 0) AS paid
         FROM barns b
         WHERE b.id = $1 limit 1`,
        [Number(getBarn[1])]
      )
      const row = out.rows?.[0] as Record<string, unknown> | undefined
      if (!row) return send(404, { message: 'العنبر غير موجود' })
      
      const invTotal = Number(row.inv_total ?? 0)
      const paid = Number(row.paid ?? 0)
      const initialDebt = Number(row.initial_debt ?? 0)
      const totalAccount = initialDebt + invTotal
      row.total_account = totalAccount
      row.total_paid = paid
      row.balance = totalAccount - paid
      
      return send(200, row)
    }

    if (method === 'PATCH' && getBarn) {
      await requireAuth(req)
      const id = Number(getBarn[1])
      const body = await parseJson(req) as Record<string, unknown>
      const fields: string[] = []
      const vals: unknown[] = []
      const add = (k: string, v: unknown) => { vals.push(v); fields.push(`${k} = $${vals.length}`) }
      if (body.name !== undefined) add('name', body.name)
      if (body.initial_debt !== undefined) add('initial_debt', Number(body.initial_debt))
      if (!fields.length) {
        const cur = await query('select * from barns where id = $1 limit 1', [id])
        return send(200, cur.rows?.[0])
      }
      vals.push(id)
      const out = await query(`update barns set ${fields.join(', ')}, updated_at = now() where id = $${vals.length} returning *`, vals)
      const row = out.rows?.[0]
      if (!row) return send(404, { message: 'العنبر غير موجود' })
      return send(200, row)
    }

    if (method === 'DELETE' && getBarn) {
      await requireAuth(req)
      await query('delete from barns where id = $1', [Number(getBarn[1])])
      return send(204, {})
    }

    const getClientCycles = path.match(/^\/clients\/(\d+)\/billing-cycles$/)
    if (method === 'GET' && getClientCycles) {
      await requireAuth(req)
      const cid = Number(getClientCycles[1])
      const [list, open] = await Promise.all([
        query('select * from client_billing_cycles where client_id = $1 order by id desc', [cid]),
        query('select id from client_billing_cycles where client_id = $1 and ended_at is null order by id desc limit 1', [cid]),
      ])
      return send(200, { data: list.rows, open_cycle_id: open.rows?.[0]?.id ?? null })
    }

    const startClientCycle = path.match(/^\/clients\/(\d+)\/billing-cycles\/start$/)
    if (method === 'POST' && startClientCycle) {
      await requireAuth(req)
      const cid = Number(startClientCycle[1])
      const body = await parseJson(req) as Record<string, unknown>
      const out = await query(
        `insert into client_billing_cycles (client_id, started_at, carry_in, created_at, updated_at)
         values ($1, coalesce($2::timestamptz, now()), $3, now(), now()) returning *`,
        [cid, body.started_at ?? null, Number(body.carry_in ?? 0)],
      )
      return send(200, out.rows?.[0])
    }

    const endClientCycle = path.match(/^\/clients\/(\d+)\/billing-cycles\/end$/)
    if (method === 'POST' && endClientCycle) {
      await requireAuth(req)
      const cid = Number(endClientCycle[1])
      const body = await parseJson(req) as Record<string, unknown>
      const out = await query(
        `update client_billing_cycles
         set ended_at = coalesce($1::timestamptz, now()), updated_at = now()
         where id = (
           select id from client_billing_cycles where client_id = $2 and ended_at is null order by id desc limit 1
         ) returning *`,
        [body.ended_at ?? null, cid],
      )
      return send(200, out.rows?.[0] ?? null)
    }

    const getBarnCycles = path.match(/^\/barns\/(\d+)\/billing-cycles$/)
    if (method === 'GET' && getBarnCycles) {
      await requireAuth(req)
      const bid = Number(getBarnCycles[1])
      const [list, open] = await Promise.all([
        query('select * from barn_billing_cycles where barn_id = $1 order by id desc', [bid]),
        query('select id from barn_billing_cycles where barn_id = $1 and ended_at is null order by id desc limit 1', [bid]),
      ])
      return send(200, { data: list.rows, open_cycle_id: open.rows?.[0]?.id ?? null })
    }

    const startBarnCycle = path.match(/^\/barns\/(\d+)\/billing-cycles\/start$/)
    if (method === 'POST' && startBarnCycle) {
      await requireAuth(req)
      const bid = Number(startBarnCycle[1])
      const body = await parseJson(req) as Record<string, unknown>
      const out = await query(
        `insert into barn_billing_cycles (barn_id, started_at, carry_in, created_at, updated_at)
         values ($1, coalesce($2::timestamptz, now()), $3, now(), now()) returning *`,
        [bid, body.started_at ?? null, Number(body.carry_in ?? 0)],
      )
      return send(200, out.rows?.[0])
    }

    const endBarnCycle = path.match(/^\/barns\/(\d+)\/billing-cycles\/end$/)
    if (method === 'POST' && endBarnCycle) {
      await requireAuth(req)
      const bid = Number(endBarnCycle[1])
      const body = await parseJson(req) as Record<string, unknown>
      const out = await query(
        `update barn_billing_cycles
         set ended_at = coalesce($1::timestamptz, now()), updated_at = now()
         where id = (
           select id from barn_billing_cycles where barn_id = $2 and ended_at is null order by id desc limit 1
         ) returning *`,
        [body.ended_at ?? null, bid],
      )
      return send(200, out.rows?.[0] ?? null)
    }

    if (method === 'GET' && path === '/products') {
      await requireAuth(req)
      
      // One-time performance optimization: check/create indexes
      // This is safe to run repeatedly but best to keep here for simplicity in this env.
      await query(`
        CREATE INDEX IF NOT EXISTS idx_bag_instances_product_status_v2 ON bag_instances (product_id, status, kg_remaining);
        CREATE INDEX IF NOT EXISTS idx_product_batches_product_price_qty ON product_batches (product_id, quantity) include (purchase_price, selling_price);
        CREATE INDEX IF NOT EXISTS idx_product_batches_product_expiry ON product_batches (product_id, expiry_date, quantity) where expiry_date is not null;
        CREATE INDEX IF NOT EXISTS idx_product_warehouse_stock_lookup ON product_warehouse_stock (warehouse_id, product_id);
      `).catch(() => {/* ignore errors if Postgres version doesn't support "include" or specific syntax */})

      const sp = url.searchParams
      const limit = Math.min(Number(sp.get('limit') || 100), 5000)
      const page = Math.max(1, Number(sp.get('page') || 1))
      const offset = (page - 1) * limit
      const search = normalizeArabicNumbers(sp.get('search') || '')
      const category = (sp.get('category') || '').trim()
      const warehouse_id = sp.get('warehouse_id')
      const low_stock = sp.get('low_stock') === 'true'
      const unpriced = sp.get('unpriced') === 'true'
      const expiring = sp.get('expiring') === 'true'
      const expired = sp.get('expired') === 'true'
      const out_of_stock = sp.get('out_of_stock') === 'true'
      const idsParam = sp.get('ids')

      // Helper for Arabic character normalization (Alef, Yaa, Teh Marbuta, Hamza)
      const normalizeArabicForSql = (field: string) => `translate(lower(coalesce(${field}, '')), 'أإآةىئؤ', 'اااهيءء')`
      const normalizeArabicText = (text: string) => text.toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/[ئؤ]/g, 'ء')

      const where: string[] = []
      const whereArgs: any[] = []
      const addWhereParam = (v: any) => {
        whereArgs.push(v)
        return `$${whereArgs.length}`
      }

      let searchForOrder: string | null = null
      if (search) {
        const normalizedSearch = normalizeArabicNumbers(search)
        searchForOrder = normalizedSearch
        const searchWords = normalizedSearch.split(/\s+/).filter(w => w.length > 0)
        
        if (searchWords.length > 0) {
          const wordClauses: string[] = []
          for (const word of searchWords) {
            const normalizedWord = normalizeArabicText(word)
            const pContains = addWhereParam(`%${normalizedWord}%`)
            
            // Match pure numeric (e.g. "56" or "0056") or prefixed IDs (e.g. "B56" or "G56")
            const numericM = /^(\d{1,12})$/.exec(word)
            const batchM = /^B(\d{1,12})$/i.exec(word)
            const bagM = /^G(\d{1,12})$/i.exec(word)
            const targetId = numericM?.[1] || batchM?.[1] || bagM?.[1]
            
            if (targetId) {
              const pInt = addWhereParam(Number(targetId))
              const pWord = addWhereParam(word)
              const pSuffix = addWhereParam(`%${word}`)
              
              let idConditions = `exists (select 1 from product_batches b where b.product_id = p.id and b.id = ${pInt})`
              if (numericM) {
                idConditions += ` or p.id = ${pInt} or p.barcode = ${pWord} or p.barcode ilike ${pSuffix}`
              }
              
              wordClauses.push(`(${normalizeArabicForSql('p.name')} ilike ${pContains} or ${idConditions})`)
            } else {
              wordClauses.push(`(${normalizeArabicForSql('p.name')} ilike ${pContains} or ${normalizeArabicForSql('p.barcode')} ilike ${pContains} or p.id::text ilike ${pContains})`)
            }
          }
          where.push(`(${wordClauses.join(' AND ')})`)
        }
      } else {
        if (category) {
          where.push(`p.category = ${addWhereParam(category)}`)
        }
        if (low_stock) {
          if (warehouse_id) {
             where.push(`coalesce((select sum(quantity) from product_warehouse_stock s where s.product_id = p.id and s.warehouse_id = ${addWhereParam(Number(warehouse_id))}), 0) <= (case when p.unit_type = 'bulk' then coalesce(p.alert_level_kg, p.alert_level) else coalesce(p.alert_level, 0) end)`)
          } else {
             where.push(`coalesce((select sum(quantity) from product_warehouse_stock s where s.product_id = p.id), 0) <= (case when p.unit_type = 'bulk' then coalesce(p.alert_level_kg, p.alert_level) else coalesce(p.alert_level, 0) end)`)
          }
        }
        if (unpriced) {
          where.push(`coalesce(p.selling_price, 0) = 0`)
        }
        if (out_of_stock) {
          if (warehouse_id) {
             where.push(`coalesce((select sum(quantity) from product_warehouse_stock s where s.product_id = p.id and s.warehouse_id = ${addWhereParam(Number(warehouse_id))}), 0) = 0`)
          } else {
             where.push(`coalesce((select sum(quantity) from product_warehouse_stock s where s.product_id = p.id), 0) = 0`)
          }
        }
        if (expiring) {
          if (warehouse_id) {
            where.push(`exists (select 1 from product_batches b where b.product_id = p.id and b.warehouse_id = ${addWhereParam(Number(warehouse_id))} and b.expiry_date is not null and b.expiry_date != '9999-12-31' and b.expiry_date <= (now() + interval '6 months') and b.expiry_date >= now()::date and (coalesce(b.quantity,0) > 0 or coalesce(b.kg_remaining,0) > 0))`)
          } else {
            where.push(`exists (select 1 from product_batches b where b.product_id = p.id and b.expiry_date is not null and b.expiry_date != '9999-12-31' and b.expiry_date <= (now() + interval '6 months') and b.expiry_date >= now()::date and (coalesce(b.quantity,0) > 0 or coalesce(b.kg_remaining,0) > 0))`)
          }
        }
        if (expired) {
          if (warehouse_id) {
            where.push(`(p.expiry_date is not null and p.expiry_date != '9999-12-31' and p.expiry_date < now()::date) or exists (select 1 from product_batches b where b.product_id = p.id and b.warehouse_id = ${addWhereParam(Number(warehouse_id))} and b.expiry_date is not null and b.expiry_date != '9999-12-31' and b.expiry_date < now()::date and coalesce(b.quantity,0) > 0)`)
          } else {
            where.push(`(p.expiry_date is not null and p.expiry_date != '9999-12-31' and p.expiry_date < now()::date) or exists (select 1 from product_batches b where b.product_id = p.id and b.expiry_date is not null and b.expiry_date != '9999-12-31' and b.expiry_date < now()::date and coalesce(b.quantity,0) > 0)`)
          }
        }
        if (idsParam) {
          const idList = idsParam.split(',').map(Number).filter(n => !isNaN(n))
          if (idList.length > 0) {
            where.push(`p.id = any(${addWhereParam(idList)})`)
          }
        }
      }

      const show_archived = url.searchParams.get('show_archived') === 'true'
      if (!show_archived) {
        where.push('p.is_active = true')
      }

      const whereSql = where.length ? `where ${where.join(' and ')}` : ''
      const total = await query(`select count(*)::int as c from products p ${whereSql}`, whereArgs)
      
      // Now build list query args, starting with whereArgs so whereSql indexes remain valid
      const listArgs = [...whereArgs]
      const addListParam = (v: any) => {
        listArgs.push(v)
        return `$${listArgs.length}`
      }

      const whParam = warehouse_id ? addListParam(Number(warehouse_id)) : null
      
      let orderBy = 'p.id desc'
      if (searchForOrder) {
        const pExact = addListParam(searchForOrder)
        // Check for numeric/batch IDs to prioritize in ordering
        const numericM = /^(\d+)$/.exec(searchForOrder)
        const batchM = /^B(\d+)$/i.exec(searchForOrder)
        const bagM = /^G(\d+)$/i.exec(searchForOrder)
        const targetId = numericM?.[1] || batchM?.[1] || bagM?.[1]
        
        let batchPriority = ''
        if (targetId) {
          const pInt = addListParam(Number(targetId))
          batchPriority = `when exists (select 1 from product_batches b where b.product_id = p.id and b.id = ${pInt}) then 3`
        }

        orderBy = `case 
          when p.id::text = ${pExact} then 0 
          when p.barcode = ${pExact} then 1 
          when lower(p.name) = ${pExact} then 2 
          ${batchPriority}
          else 4 end, p.id desc`
      } else if (expiring || expired) {
        orderBy = 'b.nearest_expiry asc nulls last, p.id desc'
      }

      const pLimit = addListParam(limit)
      const pOffset = addListParam(offset)

      let stockSelect = `coalesce((
          select sum(case when pb.unit_type = 'bulk' then pb.kg_remaining else pb.quantity end)
          from product_batches pb
          where pb.product_id = p.id and pb.warehouse_id = ${whParam ? whParam : '1'}
        ), 0) as warehouse_stock`

      let wsJoin = `left join lateral (
          select coalesce(sum(case when pb.unit_type = 'bulk' then pb.kg_remaining else pb.quantity end), 0) as batch_total_quantity
          from product_batches pb
          where pb.product_id = p.id
            ${whParam ? `and pb.warehouse_id = ${whParam}` : 'and pb.warehouse_id = 1'}
      ) ws on true`

      if (expiring) {
        stockSelect = `coalesce((
          select sum(case when pb.unit_type = 'bulk' then pb.kg_remaining else pb.quantity end)
          from product_batches pb
          where pb.product_id = p.id and pb.warehouse_id = ${whParam ? whParam : '1'}
            and pb.expiry_date is not null and pb.expiry_date != '9999-12-31' 
            and pb.expiry_date <= (now() + interval '6 months') and pb.expiry_date >= now()::date
        ), 0) as warehouse_stock`

        wsJoin = `left join lateral (
          select coalesce(sum(case when pb.unit_type = 'bulk' then pb.kg_remaining else pb.quantity end), 0) as batch_total_quantity
          from product_batches pb
          where pb.product_id = p.id
            and pb.expiry_date is not null and pb.expiry_date != '9999-12-31' 
            and pb.expiry_date <= (now() + interval '6 months') and pb.expiry_date >= now()::date
            ${whParam ? `and pb.warehouse_id = ${whParam}` : ''}
        ) ws on true`
      } else if (expired) {
        stockSelect = `coalesce((
          select sum(case when pb.unit_type = 'bulk' then pb.kg_remaining else pb.quantity end)
          from product_batches pb
          where pb.product_id = p.id and pb.warehouse_id = ${whParam ? whParam : '1'}
            and pb.expiry_date is not null and pb.expiry_date != '9999-12-31' 
            and pb.expiry_date < now()::date
        ), 0) as warehouse_stock`

        wsJoin = `left join lateral (
          select coalesce(sum(case when pb.unit_type = 'bulk' then pb.kg_remaining else pb.quantity end), 0) as batch_total_quantity
          from product_batches pb
          where pb.product_id = p.id
            and pb.expiry_date is not null and pb.expiry_date != '9999-12-31' 
            and pb.expiry_date < now()::date
            ${whParam ? `and pb.warehouse_id = ${whParam}` : ''}
        ) ws on true`
      }

      const list = await query(
        `select
           p.id, p.name, p.company, p.category, p.barcode, p.unit_type, p.bag_weight_kg, 
           p.purchase_price, p.selling_price, p.alert_level, p.alert_level_kg, p.expiry_date,
           p.image_url, 
           coalesce(ws.batch_total_quantity, 0) as batch_total_quantity,
           ${stockSelect},
           b.purchase_price_min,
           b.purchase_price_max,
           b.selling_price_min,
           b.selling_price_max,
           b.nearest_expiry,
           coalesce(bi.bulk_bag_count, 0) as bulk_bag_count,
           coalesce(bi.bulk_open_bag_low, false) as bulk_open_bag_low
         from products p
         ${wsJoin}
         left join lateral (
           select min(pb.purchase_price) as purchase_price_min,
                  max(pb.purchase_price) as purchase_price_max,
                  min(pb.selling_price) as selling_price_min,
                  max(pb.selling_price) as selling_price_max,
                   min(case when pb.expiry_date is not null and pb.expiry_date != '9999-12-31' then pb.expiry_date end) as nearest_expiry
           from product_batches pb
           where pb.product_id = p.id and (coalesce(pb.quantity,0) > 0 or coalesce(pb.kg_remaining,0) > 0)
             ${whParam ? `and pb.warehouse_id = ${whParam}` : ''}
         ) b on true
         left join lateral (
           select count(*)::int as bulk_bag_count,
                  bool_or(
                    bins.status = 'open' 
                    and coalesce(bins.kg_total, 0) > 0 
                    and (coalesce(bins.kg_remaining, 0) / bins.kg_total) <= 0.2
                  ) as bulk_open_bag_low
           from bag_instances bins
           where bins.product_id = p.id
             and bins.status in ('sealed', 'open')
             and coalesce(bins.kg_remaining, 0) > 0
         ) bi on true
         ${whereSql}
         order by ${orderBy}
         limit ${pLimit} offset ${pOffset}`,
        listArgs,
      )
      return send(200, { data: list.rows, total: Number(total.rows?.[0]?.c ?? 0) })
    }

    if (method === 'POST' && path === '/products') {
      await requireAuth(req)
      const body = await parseJson(req) as Record<string, unknown>
      const unitTypeCreate = String(body.unit_type ?? body.unit ?? 'piece')
      const defaultAlertCreate = unitTypeCreate === 'bulk' ? 0 : 5
      const rawBc = body.barcode
      const barcode =
        rawBc != null && String(rawBc).trim() !== ''
          ? String(rawBc).trim()
          : `PRD-${Date.now()}`
      let bagW: number | null =
        body.bag_weight_kg != null && body.bag_weight_kg !== ''
          ? Number(body.bag_weight_kg)
          : null
      if (!Number.isFinite(bagW)) bagW = null
      let alertKg: number | null =
        body.alert_level_kg != null && body.alert_level_kg !== ''
          ? Number(body.alert_level_kg)
          : null
      if (!Number.isFinite(alertKg)) alertKg = null
      const imageUrl = normalizeProductImageUrl(body.image_url)
      const out = await query(
        `insert into products
         (name, company, category, barcode, unit_type, bag_weight_kg, purchase_price, selling_price, alert_level, alert_level_kg, expiry_date, image_url, notes, is_active, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null,$11,$12,$13,now(),now())
         returning *`,
        [
          body.name ?? '',
          body.company ?? null,
          body.category ?? null,
          barcode,
          unitTypeCreate,
          bagW,
          Number(body.purchase_price ?? 0),
          Number(body.selling_price ?? 0),
          Number(body.alert_level ?? body.low_stock_threshold ?? defaultAlertCreate),
          alertKg,
          imageUrl,
          body.notes ?? null,
          body.is_active !== undefined ? Boolean(body.is_active) : true,
        ],
      )
      const product = out.rows?.[0] as Record<string, unknown> | undefined
      const productId = Number(product?.id ?? 0)
      const initialBatches = (Array.isArray(body.initial_batches) ? body.initial_batches : body.initial_bulk_stock) as Array<Record<string, unknown>> | undefined
      if (productId && Array.isArray(initialBatches)) {
        for (const b of initialBatches) {
          const warehouseId = Number(b.warehouse_id ?? body.warehouse_id ?? 1)
          const quantity = Number(b.quantity ?? b.bag_count ?? 0)
          await query(
            `insert into product_batches
             (product_id, warehouse_id, quantity, purchase_price, selling_price, expiry_date, created_at, updated_at)
             values ($1,$2,$3,$4,$5,$6,now(),now())`,
            [productId, warehouseId, quantity, Number(b.purchase_price ?? body.purchase_price ?? 0), Number(b.selling_price ?? body.selling_price ?? 0), b.expiry_date ?? null],
          )
          await query(
            `insert into product_warehouse_stock (product_id, warehouse_id, quantity)
             values ($1,$2,$3)
             on conflict (product_id, warehouse_id) do update
             set quantity = product_warehouse_stock.quantity + excluded.quantity`,
            [productId, warehouseId, quantity],
          )
        }
      }
      return send(200, product)
    }

    if (method === 'GET' && path === '/products/by-barcode') {
      await requireAuth(req)
      const barcode = (url.searchParams.get('barcode') || '').trim()
      if (!barcode) return send(200, null)
      // Normalize Eastern Arabic numerals in the database to match the incoming normalized barcode
      const out = await query(
        `select * from products where translate(barcode, '٠١٢٣٤٥٦٧٨٩', '0123456789') = $1 limit 1`,
        [barcode]
      )
      return send(200, out.rows?.[0] ?? null)
    }

    const getProduct = path.match(/^\/products\/(\d+)$/)
    if (method === 'GET' && getProduct) {
      await requireAuth(req)
      const out = await query('select * from products where id = $1 limit 1', [Number(getProduct[1])])
      const row = out.rows?.[0]
      if (!row) return send(404, { message: 'المنتج غير موجود' })
      return send(200, row)
    }

    if (method === 'PATCH' && getProduct) {
      await requireAuth(req)
      const id = Number(getProduct[1])
      const body = await parseJson(req) as Record<string, unknown>
      const fields: string[] = []
      const vals: unknown[] = []
      const add = (k: string, v: unknown) => { vals.push(v); fields.push(`${k} = $${vals.length}`) }
      if (body.name !== undefined) add('name', body.name)
      if (body.category !== undefined) add('category', body.category)
      if (body.unit_type !== undefined || body.unit !== undefined) add('unit_type', body.unit_type ?? body.unit)
      if (body.barcode !== undefined) add('barcode', body.barcode)
      if (body.purchase_price !== undefined) add('purchase_price', Number(body.purchase_price))
      if (body.selling_price !== undefined) add('selling_price', Number(body.selling_price))
      if (body.alert_level !== undefined || body.low_stock_threshold !== undefined) add('alert_level', Number(body.alert_level ?? body.low_stock_threshold))
      if (body.alert_level_kg !== undefined) add('alert_level_kg', Number(body.alert_level_kg))
      if (body.bag_weight_kg !== undefined) add('bag_weight_kg', Number(body.bag_weight_kg))
      if (body.company !== undefined) add('company', body.company ?? null)
      if (body.notes !== undefined) add('notes', body.notes ?? null)
      if (body.expiry_date !== undefined) add('expiry_date', body.expiry_date ?? null)
      if (body.image_url !== undefined) add('image_url', normalizeProductImageUrl(body.image_url))
      if (body.is_active !== undefined) add('is_active', Boolean(body.is_active))
      if (!fields.length) {
        const cur = await query('select * from products where id = $1 limit 1', [id])
        return send(200, cur.rows?.[0])
      }
      vals.push(id)
      const out = await query(`update products set ${fields.join(', ')}, updated_at = now() where id = $${vals.length} returning *`, vals)
      const row = out.rows?.[0]
      if (!row) return send(404, { message: 'المنتج غير موجود' })
      return send(200, row)
    }

    if (method === 'DELETE' && getProduct) {
      const auth = await requireAuth(req) as Record<string, unknown>
      const id = Number(getProduct[1])
      const sp = new URL(req.url).searchParams
      const force = sp.get('force') === 'true'
      const appMeta = (auth?.app_metadata as Record<string, unknown> | undefined) ?? {}
      const role = String(auth?.role ?? appMeta.role ?? '')

      if (force && role !== 'super_admin') {
        return send(403, { message: 'الحذف القسري متاح فقط لمدير النظام', code: 'PRODUCT_FORCE_DELETE_FORBIDDEN' })
      }

      if (force) {
        // Force delete: clean up history
        await query(
          `delete from return_items
           where invoice_item_id in (select id from invoice_items where product_id = $1)
              or batch_id in (select id from product_batches where product_id = $1)`,
          [id]
        )
        await query('delete from invoice_items where product_id = $1', [id])
        await query('delete from supplier_purchase_items where product_id = $1', [id])
        // product_batches and product_warehouse_stock have ON DELETE CASCADE in DB
      }

      try {
        await query('delete from products where id = $1', [id])
        return send(204, {})
      } catch (err: any) {
        if (err.message?.includes('violates foreign key constraint')) {
          return send(409, {
            error: 'لا يمكن حذف هذا المنتج لوجود سجلات مرتبطة به. يمكنك أرشفة المنتج، أو استخدام "الحذف القسري" لمسح كافة السجلات التاريخية المرتبطة به.',
            code: 'PRODUCT_HAS_REFERENCES',
            can_force: true,
          })
        }
        throw err
      }
    }

    const productStock = path.match(/^\/products\/(\d+)\/stock$/)
    if (method === 'GET' && productStock) {
      await requireAuth(req)
      const out = await query('select * from product_warehouse_stock where product_id = $1 order by warehouse_id asc', [Number(productStock[1])])
      return send(200, out.rows)
    }

    const productBatches = path.match(/^\/products\/(\d+)\/batches$/)
    if (method === 'GET' && productBatches) {
      await requireAuth(req)
      const pid = Number(productBatches[1])
      const wh = url.searchParams.get('warehouse_id')
      if (wh) {
        const out = await query('select * from product_batches where product_id = $1 and warehouse_id = $2 order by id desc', [pid, Number(wh)])
        return send(200, out.rows)
      }
      const out = await query('select * from product_batches where product_id = $1 order by id desc', [pid])
      return send(200, out.rows)
    }

    const createProductBatch = path.match(/^\/products\/(\d+)\/batches$/)
    if (method === 'POST' && createProductBatch) {
      await requireAuth(req)
      const pid = Number(createProductBatch[1])
      const body = await parseJson(req) as Record<string, unknown>
      const qty = Number(body.quantity ?? body.bag_count ?? 0)
      const wid = Number(body.warehouse_id ?? 1)
      const out = await query(
        `insert into product_batches
         (product_id, warehouse_id, quantity, purchase_price, selling_price, expiry_date, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,now(),now())
         returning *`,
        [pid, wid, qty, Number(body.purchase_price ?? 0), Number(body.selling_price ?? 0), body.expiry_date ?? null],
      )
      await query(
        `insert into product_warehouse_stock (product_id, warehouse_id, quantity)
         values ($1,$2,$3)
         on conflict (product_id, warehouse_id) do update
         set quantity = product_warehouse_stock.quantity + excluded.quantity`,
        [pid, wid, qty],
      )
      return send(200, out.rows?.[0])
    }

    const productBags = path.match(/^\/products\/(\d+)\/bags$/)
    if (method === 'GET' && productBags) {
      await requireAuth(req)
      const pid = Number(productBags[1])
      const wh = url.searchParams.get('warehouse_id')
      if (wh) {
        const out = await query('select * from bag_instances where product_id = $1 and warehouse_id = $2 order by id desc', [pid, Number(wh)])
        return send(200, out.rows)
      }
      const out = await query('select * from bag_instances where product_id = $1 order by id desc', [pid])
      return send(200, out.rows)
    }

    const initialBulkStock = path.match(/^\/products\/(\d+)\/initial-bulk-stock$/)
    if (method === 'POST' && initialBulkStock) {
      await requireAuth(req)
      const pid = Number(initialBulkStock[1])
      const body = await parseJson(req) as Record<string, unknown>
      const list = (Array.isArray(body.initial_batches) ? body.initial_batches : body.initial_bulk_stock) as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(list)) return send(400, { message: 'initial_batches مطلوبة' })
      for (const b of list) {
        const wid = Number(b.warehouse_id ?? 1)
        const qty = Number(b.quantity ?? b.bag_count ?? 0)
        await query(
          `insert into product_batches
           (product_id, warehouse_id, quantity, purchase_price, selling_price, expiry_date, created_at, updated_at)
           values ($1,$2,$3,$4,$5,$6,now(),now())`,
          [pid, wid, qty, Number(b.purchase_price ?? 0), Number(b.selling_price ?? 0), b.expiry_date ?? null],
        )
        await query(
          `insert into product_warehouse_stock (product_id, warehouse_id, quantity)
           values ($1,$2,$3)
           on conflict (product_id, warehouse_id) do update
           set quantity = product_warehouse_stock.quantity + excluded.quantity`,
          [pid, wid, qty],
        )
      }
      const out = await query('select * from products where id = $1 limit 1', [pid])
      return send(200, out.rows?.[0] ?? null)
    }

    /* ─── Inventory Transfer (اجهور → شبرا) ─── */
    if (method === 'POST' && path === '/inventory-transfers') {
      await requireAuth(req)
      const body = await parseJson(req) as Record<string, unknown>
      const fromWh = Number(body.from_warehouse_id)
      const toWh = Number(body.to_warehouse_id)
      if (!Number.isFinite(fromWh) || !Number.isFinite(toWh) || fromWh === toWh) {
        return send(400, { message: 'المخزن المصدر والهدف مطلوبان ويجب أن يكونا مختلفين' })
      }
      const items = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : []
      if (items.length === 0) {
        return send(400, { message: 'أضف صنفاً واحداً على الأقل' })
      }
      // Validate stock availability first
      for (const it of items) {
        const pid = Number(it.product_id)
        const qty = Number(it.quantity ?? 0)
        if (!Number.isFinite(pid) || !Number.isFinite(qty) || qty <= 0) {
          return send(400, { message: `كمية غير صالحة للمنتج #${pid}` })
        }
        const stockRow = await query(
          'select coalesce(quantity, 0) as qty from product_warehouse_stock where product_id = $1 and warehouse_id = $2',
          [pid, fromWh]
        )
        const available = Number(stockRow.rows?.[0]?.qty ?? 0)
        if (qty > available) {
          const pName = await query('select name from products where id = $1', [pid])
          const name = (pName.rows?.[0] as Record<string, unknown>)?.name ?? `#${pid}`
          return send(400, {
            message: `الكمية المطلوبة (${qty}) للمنتج «${name}» أكبر من المتاح (${available})`,
          })
        }
      }
      // Execute transfer: deduct batches (LIFO), create target batches, update stock
      for (const it of items) {
        const pid = Number(it.product_id)
        const qty = Number(it.quantity ?? 0)

        // ── Deduct from source batches (LIFO: newest batch first) ──
        const batchRes = await query(
          `select * from product_batches
           where product_id = $1 and warehouse_id = $2 and coalesce(quantity, 0) > 0
           order by id desc`,
          [pid, fromWh]
        )
        let remaining = qty
        for (const batch of (batchRes.rows as Array<Record<string, unknown>>)) {
          if (remaining <= 0) break
          const batchQty = Number(batch.quantity ?? 0)
          const take = Math.min(remaining, batchQty)
          if (take <= 0) continue

          // Subtract from source batch
          await query(
            'update product_batches set quantity = greatest(0, quantity - $1), updated_at = now() where id = $2',
            [take, batch.id]
          )

          // Create or update matching batch in target warehouse
          const existingTarget = await query(
            `select id from product_batches
             where product_id = $1 and warehouse_id = $2 and expiry_date = $3
               and coalesce(purchase_price, 0) = coalesce($4::numeric, 0)
               and coalesce(selling_price, 0) = coalesce($5::numeric, 0)
             limit 1`,
            [pid, toWh, batch.expiry_date, batch.purchase_price, batch.selling_price]
          )

          if ((existingTarget.rows?.length ?? 0) > 0) {
            await query(
              'update product_batches set quantity = quantity + $1, updated_at = now() where id = $2',
              [take, (existingTarget.rows[0] as Record<string, unknown>).id]
            )
          } else {
            await query(
              `insert into product_batches
               (product_id, warehouse_id, expiry_date, quantity, purchase_price, selling_price,
                unit_type, bag_count, kg_per_bag, kg_remaining, source, created_at, updated_at)
               values ($1, $2, $3, $4, $5, $6, $7, null, $8, null, 'transfer', now(), now())`,
              [
                pid, toWh, batch.expiry_date, take,
                batch.purchase_price ?? null, batch.selling_price ?? null,
                batch.unit_type ?? 'piece', batch.kg_per_bag ?? null,
              ]
            )
          }
          remaining -= take
        }

        // ── Update product_warehouse_stock ──
        // Subtract from source warehouse
        await query(
          `update product_warehouse_stock
           set quantity = greatest(0, quantity - $1), updated_at = now()
           where product_id = $2 and warehouse_id = $3`,
          [qty, pid, fromWh]
        )
        // Add to target warehouse (upsert)
        await query(
          `insert into product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
           values ($1, $2, $3, now())
           on conflict (product_id, warehouse_id) do update
           set quantity = product_warehouse_stock.quantity + excluded.quantity, updated_at = now()`,
          [pid, toWh, qty]
        )
      }

      // ── Persist transfer log ──
      const trRes = await query(
        'insert into inventory_transfers (from_warehouse_id, to_warehouse_id, notes, created_at) values ($1, $2, $3, now()) returning id',
        [fromWh, toWh, (body.notes as string) ?? null]
      )
      const transferId = (trRes.rows[0] as Record<string, unknown>).id
      for (const it of items) {
        const pid = Number(it.product_id)
        const qty = Number(it.quantity ?? 0)
        const pRow = await query('select name from products where id = $1', [pid])
        const name = (pRow.rows?.[0] as Record<string, unknown>)?.name ?? `#${pid}`
        await query(
          'insert into inventory_transfer_items (transfer_id, product_id, product_name, quantity) values ($1, $2, $3, $4)',
          [transferId, pid, name, qty]
        )
      }

      return send(200, {
        from_warehouse_id: fromWh,
        to_warehouse_id: toWh,
        notes: body.notes ?? null,
        created_at: new Date().toISOString(),
        items_count: items.length,
      })
    }

    /* ─── Inventory Transfer History ─── */
    if (method === 'GET' && path === '/inventory-transfers') {
      await requireAuth(req)
      const limit = Math.min(Number(params.get('limit') || 50), 200)
      const transfers = await query(`
        select t.*,
          wf.name_ar as from_warehouse_name,
          wt.name_ar as to_warehouse_name
        from inventory_transfers t
        left join warehouses wf on wf.id = t.from_warehouse_id
        left join warehouses wt on wt.id = t.to_warehouse_id
        order by t.id desc
        limit $1
      `, [limit])

      if (transfers.rows.length === 0) return send(200, { data: [] })

      const ids = (transfers.rows as Array<Record<string, unknown>>).map((t) => t.id)
      const itemRes = await query(
        `select * from inventory_transfer_items where transfer_id = any($1) order by id`,
        [ids]
      )

      const itemsByTransfer: Record<number, unknown[]> = {}
      for (const item of (itemRes.rows as Array<Record<string, unknown>>)) {
        const tid = Number(item.transfer_id)
        if (!itemsByTransfer[tid]) itemsByTransfer[tid] = []
        itemsByTransfer[tid].push(item)
      }

      const data = (transfers.rows as Array<Record<string, unknown>>).map((t) => ({
        ...t,
        items: itemsByTransfer[Number(t.id)] ?? [],
      }))
      return send(200, { data })
    }

    const stockAdjustment = path.match(/^\/products\/(\d+)\/stock-adjustment$/)
    if (method === 'POST' && stockAdjustment) {
      await requireAuth(req)
      const pid = Number(stockAdjustment[1])
      const body = await parseJson(req) as Record<string, unknown>
      const wid = Number(body.warehouse_id ?? 1)
      const delta = Number(body.quantity_delta ?? 0)
      const existingBatches = await query(
        'select 1 from product_batches where product_id = $1 and warehouse_id = $2 limit 1',
        [pid, wid],
      )
      if (existingBatches.rows?.length) {
        return send(400, {
          message: 'لا يمكن تعديل مخزون مباشر لمنتج لديه دُفعات. عدّل الكمية من الدُفعات.',
        })
      }
      await query(
        `insert into product_warehouse_stock (product_id, warehouse_id, quantity)
         values ($1,$2,$3)
         on conflict (product_id, warehouse_id) do update
         set quantity = product_warehouse_stock.quantity + excluded.quantity`,
        [pid, wid, delta],
      )
      return send(204, {})
    }

    const batchById = path.match(/^\/batches\/(\d+)$/)
    if (method === 'GET' && batchById) {
      await requireAuth(req)
      const id = Number(batchById[1])
      const out = await query('select * from product_batches where id = $1 limit 1', [id])
      const row = out.rows?.[0]
      if (!row) return send(404, { message: 'الدفعة غير موجودة' })
      return send(200, row)
    }

    const patchBatch = path.match(/^\/batches\/(\d+)$/)
    if (method === 'PATCH' && patchBatch) {
      await requireAuth(req)
      const id = Number(patchBatch[1])
      const before = await query('select product_id, warehouse_id from product_batches where id = $1 limit 1', [id])
      const prev = before.rows?.[0]
      if (!prev) return send(404, { message: 'الدفعة غير موجودة' })
      const body = await parseJson(req) as Record<string, unknown>
      const fields: string[] = []
      const vals: unknown[] = []
      const add = (k: string, v: unknown) => { vals.push(v); fields.push(`${k} = $${vals.length}`) }
      if (body.quantity !== undefined) add('quantity', Number(body.quantity))
      if (body.kg_remaining !== undefined) add('kg_remaining', Number(body.kg_remaining))
      if (body.purchase_price !== undefined) add('purchase_price', body.purchase_price === null ? null : Number(body.purchase_price))
      if (body.selling_price !== undefined) add('selling_price', body.selling_price === null ? null : Number(body.selling_price))
      if (body.expiry_date !== undefined) add('expiry_date', body.expiry_date)
      if (!fields.length) {
        const cur = await query('select * from product_batches where id = $1 limit 1', [id])
        return send(200, cur.rows?.[0])
      }
      vals.push(id)
      const out = await query(`update product_batches set ${fields.join(', ')}, updated_at = now() where id = $${vals.length} returning *`, vals)
      const row = out.rows?.[0]
      const productId = Number(row?.product_id ?? prev.product_id)
      const warehouseId = Number(row?.warehouse_id ?? prev.warehouse_id)
      if (Number.isFinite(productId) && Number.isFinite(warehouseId)) {
        await syncWarehouseStockFromBatches(productId, warehouseId)
      }
      return send(200, row ?? null)
    }

    const deleteBatch = path.match(/^\/products\/batches\/(\d+)$/)
    if (method === 'DELETE' && deleteBatch) {
      await requireAuth(req)
      const id = Number(deleteBatch[1])
      const before = await query('select product_id, warehouse_id from product_batches where id = $1 limit 1', [id])
      const prev = before.rows?.[0]
      await query('delete from product_batches where id = $1', [id])
      if (prev) {
        const productId = Number(prev.product_id)
        const warehouseId = Number(prev.warehouse_id)
        if (Number.isFinite(productId) && Number.isFinite(warehouseId)) {
          await syncWarehouseStockFromBatches(productId, warehouseId)
        }
      }
      return send(204, {})
    }

    const bagById = path.match(/^\/bag-instances\/(\d+)$/)
    if (method === 'GET' && bagById) {
      await requireAuth(req)
      const out = await query('select * from bag_instances where id = $1 limit 1', [Number(bagById[1])])
      const row = out.rows?.[0]
      if (!row) return send(404, { message: 'الشكارة غير موجودة' })
      return send(200, row)
    }

    if (method === 'GET' && path === '/suppliers') {
      await requireAuth(req)
      const sp = url.searchParams
      const limit = Math.min(Number(sp.get('limit') || 50), 200)
      const search = normalizeArabicNumbers(sp.get('search') || '')
      const sortBal = (sp.get('sort') || '').trim() === 'balance_desc'
      const args: unknown[] = []
      let where = ''
      if (search) {
        args.push(`%${search}%`)
        where = `where (translate(s.name, '٠١٢٣٤٥٦٧٨٩٪', '0123456789%') ilike $1 or coalesce(translate(s.phone, '٠١٢٣٤٥٦٧٨٩٪', '0123456789%'),'') ilike $1)`
      }
      args.push(limit)
      const balExpr = `(
             coalesce((select sum(sp.total_amount) from supplier_purchases sp where sp.supplier_id = s.id),0) -
             coalesce((select sum(py.amount) from supplier_payments py where py.supplier_id = s.id),0)
           )`
      const orderSql = sortBal ? `order by ${balExpr} desc, s.id desc` : 'order by s.id desc'
      const out = await query(
        `select
           s.*,
           ${balExpr} as balance
         from suppliers s
         ${where}
         ${orderSql}
         limit $${args.length}`,
        args,
      )
      return send(200, { data: out.rows, total: out.rows.length })
    }

    if (method === 'POST' && path === '/suppliers') {
      await requireAuth(req)
      const body = await parseJson(req) as Record<string, unknown>
      const out = await query(
        `insert into suppliers (name, phone, email, address, notes, is_active, created_at, updated_at)
         values ($1,$2,$3,$4,$5,true,now(),now()) returning *`,
        [
          String(body.name || ''),
          body.phone ?? null,
          body.email ?? null,
          body.address ?? null,
          body.notes ?? null,
        ],
      )
      return send(200, out.rows?.[0])
    }

    const getSupplier = path.match(/^\/suppliers\/(\d+)$/)
    if (method === 'GET' && getSupplier) {
      await requireAuth(req)
      const out = await query('select * from suppliers where id = $1 limit 1', [Number(getSupplier[1])])
      const row = out.rows?.[0]
      if (!row) return send(404, { message: 'المورد غير موجود' })
      return send(200, row)
    }

    if (method === 'PATCH' && getSupplier) {
      await requireAuth(req)
      const id = Number(getSupplier[1])
      const body = await parseJson(req) as Record<string, unknown>
      const fields: string[] = []
      const vals: unknown[] = []
      const add = (k: string, v: unknown) => { vals.push(v); fields.push(`${k} = $${vals.length}`) }
      if (body.name !== undefined) add('name', body.name)
      if (body.phone !== undefined) add('phone', body.phone)
      if (body.email !== undefined) add('email', body.email)
      if (body.address !== undefined) add('address', body.address)
      if (body.notes !== undefined) add('notes', body.notes)
      if (body.is_active !== undefined) add('is_active', Boolean(body.is_active))
      if (!fields.length) {
        const cur = await query('select * from suppliers where id = $1 limit 1', [id])
        return send(200, cur.rows?.[0])
      }
      vals.push(id)
      const out = await query(`update suppliers set ${fields.join(', ')}, updated_at = now() where id = $${vals.length} returning *`, vals)
      const row = out.rows?.[0]
      if (!row) return send(404, { message: 'المورد غير موجود' })
      return send(200, row)
    }

    if (method === 'DELETE' && getSupplier) {
      await requireAuth(req)
      await query('delete from suppliers where id = $1', [Number(getSupplier[1])])
      return send(204, {})
    }

    const supplierBalance = path.match(/^\/suppliers\/(\d+)\/balance$/)
    if (method === 'GET' && supplierBalance) {
      await requireAuth(req)
      const sid = Number(supplierBalance[1])
      const out = await query(
        `select
          coalesce((select sum(total_amount) from supplier_purchases where supplier_id = $1),0) -
          coalesce((select sum(amount) from supplier_payments where supplier_id = $1),0)
          as balance`,
        [sid],
      )
      return send(200, { balance: Number(out.rows?.[0]?.balance ?? 0) })
    }

    const getSupplierPurchasesWithItems = path.match(/^\/suppliers\/(\d+)\/purchases-with-items$/)
    if (method === 'GET' && getSupplierPurchasesWithItems) {
      await requireAuth(req)
      const sid = Number(getSupplierPurchasesWithItems[1])
      const out = await query(
        `select * from supplier_purchases where supplier_id = $1 order by id desc limit 50`,
        [sid],
      )
      const purchases = out.rows
      for (const p of purchases) {
        const items = await query(
          `select spi.*, coalesce(pr.name, 'منتج') as product_name
           from supplier_purchase_items spi
           left join products pr on pr.id = spi.product_id
           where spi.supplier_purchase_id = $1`,
          [p.id],
        )
        p.items = items.rows
      }
      return send(200, { data: purchases })
    }

    const supplierPurchases = path.match(/^\/suppliers\/(\d+)\/purchases$/)
    if (method === 'GET' && supplierPurchases) {
      await requireAuth(req)
      const sid = Number(supplierPurchases[1])
      const limit = Math.min(Number(url.searchParams.get('limit') || 10), 100)
      const out = await query('select * from supplier_purchases where supplier_id = $1 order by id desc limit $2', [sid, limit])
      return send(200, { data: out.rows, total: out.rows.length })
    }


    const supplierPayments = path.match(/^\/suppliers\/(\d+)\/payments$/)
    if (method === 'GET' && supplierPayments) {
      await requireAuth(req)
      const sid = Number(supplierPayments[1])
      const limit = Math.min(Number(url.searchParams.get('limit') || 10), 100)
      const out = await query('select * from supplier_payments where supplier_id = $1 order by id desc limit $2', [sid, limit])
      return send(200, { data: out.rows, total: out.rows.length })
    }

    const supplierPurchaseById = path.match(/^\/supplier-purchases\/(\d+)$/)
    if (method === 'GET' && supplierPurchaseById) {
      await requireAuth(req)
      const pid = Number(supplierPurchaseById[1])
      const purchase = await query('select * from supplier_purchases where id = $1 limit 1', [pid])
      const row = purchase.rows?.[0]
      if (!row) return send(404, { message: 'الفاتورة غير موجودة' })
      const items = await query('select * from supplier_purchase_items where supplier_purchase_id = $1 order by id asc', [pid])
      return send(200, { ...(row as Record<string, unknown>), items: items.rows })
    }

    if (method === 'POST' && path === '/supplier-purchases') {
      await requireAuth(req)
      const body = await parseJson(req) as Record<string, unknown>
      const items = Array.isArray(body.items) ? body.items : []
      const totalAmount = Number(body.total_amount ?? items.reduce((s, it) => s + Number((it as Record<string, unknown>).total_price ?? 0), 0))
      const purchase = await query(
        `insert into supplier_purchases (supplier_id, warehouse_id, total_amount, notes, created_at, created_by)
         values ($1,$2,$3,$4,now(),null) returning *`,
        [body.supplier_id, body.warehouse_id ?? 1, totalAmount, body.notes ?? null],
      )
      const row = purchase.rows?.[0] as { id: number } | undefined
      if (row) {
        for (const it of items as Array<Record<string, unknown>>) {
          await query(
            `insert into supplier_purchase_items
             (supplier_purchase_id, product_id, quantity, unit_price, total_price, created_at)
             values ($1,$2,$3,$4,$5,now())`,
            [row.id, it.product_id, Number(it.quantity ?? 0), Number(it.unit_price ?? 0), Number(it.total_price ?? 0)],
          )
        }
      }
      return send(200, purchase.rows?.[0])
    }

    if (method === 'POST' && path === '/supplier-payments') {
      await requireAuth(req)
      const body = await parseJson(req) as Record<string, unknown>
      const out = await query(
        `insert into supplier_payments (supplier_id, amount, notes, payment_date, created_at, created_by)
         values ($1,$2,$3,$4,now(),null) returning *`,
        [body.supplier_id, Number(body.amount ?? 0), body.notes ?? null, body.payment_date ?? new Date().toISOString().slice(0, 10)],
      )
      return send(200, out.rows?.[0])
    }

    if (method === 'GET' && path === '/invoices') {
      await requireAuth(req)
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200)
      const status = (url.searchParams.get('status') || '').trim()
      const paymentMethod = (url.searchParams.get('payment_method') || '').trim()
      const warehouseId = url.searchParams.get('warehouse_id')
      const clientId = url.searchParams.get('client_id')
      const barnId = url.searchParams.get('barn_id')
      const searchId = normalizeArabicNumbers(url.searchParams.get('id') || '')
      const from = (url.searchParams.get('from') || '').trim()
      const to = (url.searchParams.get('to') || '').trim()
      const where: string[] = [`coalesce(invoice_lifecycle,'active') != 'cancelled'`]
      const args: unknown[] = []
      
      console.log(`[GET /invoices] Filters: client=${clientId}, barn=${barnId}, id=${searchId}`)
      const unpaid = url.searchParams.get('unpaid')
      if (unpaid === '1' || unpaid === 'true') {
        where.push('coalesce(remaining_amount, 0) > 0')
      }
      if (searchId) {
        args.push(`%${searchId}%`)
        where.push(`cast(id as text) ilike $${args.length}`)
      }
      if (status) {
        args.push(status)
        where.push(`status = $${args.length}`)
      }
      if (paymentMethod) {
        if (paymentMethod === 'cash') {
          args.push('cash')
          where.push(`payment_method = $${args.length}`)
        } else if (paymentMethod === 'آجل' || paymentMethod === 'credit' || paymentMethod === 'deferred') {
          where.push(`coalesce(payment_method, '') in ('آجل', 'credit', 'deferred')`)
        } else {
          args.push(paymentMethod)
          where.push(`payment_method = $${args.length}`)
        }
      }
      if (warehouseId) {
        args.push(Number(warehouseId))
        where.push(`warehouse_id = $${args.length}`)
      }
      if (clientId) {
        args.push(Number(clientId))
        where.push(`client_id = $${args.length}`)
      }
      if (barnId) {
        args.push(Number(barnId))
        where.push(`barn_id = $${args.length}`)
      }
      if (searchId) {
        args.push(Number(searchId))
        where.push(`id = $${args.length}`)
      }
      if (from) {
        args.push(from)
        where.push(`created_at::date >= $${args.length}::date`)
      }
      if (to) {
        args.push(to)
        where.push(`created_at::date <= $${args.length}::date`)
      }
      const whereSql = where.length ? `where ${where.join(' and ')}` : ''
      args.push(limit)
      const out = await query(
        `select invoices.*, b.name as barn_name
         from invoices
         left join barns b on b.id = invoices.barn_id
         ${whereSql}
         order by invoices.id desc
         limit $${args.length}`,
        args,
      )
      const invoices = out.rows as Array<Record<string, unknown>>
      for (const inv of invoices) {
        const items = await query('select * from invoice_items where invoice_id = $1 order by id asc', [inv.id])
        inv.items = items.rows
      }
      return send(200, { data: invoices, total: invoices.length })
    }

    const invoiceById = path.match(/^\/invoices\/(\d+)$/)
    if (method === 'GET' && invoiceById) {
      await requireAuth(req)
      const id = Number(invoiceById[1])
      const inv = await query(
        `select
           inv.*,
           wh.name_ar as warehouse_name_ar,
           (select b.name from barns b where b.id = inv.barn_id) as barn_name,
           (
             coalesce((select c0.initial_debt from clients c0 where c0.id = inv.client_id), 0) +
             coalesce((select sum(br.initial_debt) from barns br where br.client_id = inv.client_id), 0) +
             coalesce((
               select sum(i2.total_amount) from invoices i2
               where i2.client_id = inv.client_id
                 and coalesce(i2.invoice_lifecycle, 'active') != 'cancelled'
                 and (i2.created_at, i2.id) <= (coalesce(inv.created_at, inv.updated_at, now()), inv.id)
             ), 0) -
             coalesce((
               select sum(py.amount) from payments py
               where py.client_id = inv.client_id
                 and coalesce(py.payment_method, '') not in ('deferred', 'آجل', 'credit')
                 and py.created_at <= coalesce(inv.created_at::timestamptz, inv.updated_at::timestamptz, now())
             ), 0)
           )::float8 as client_balance_after,
           (
             coalesce((select c0.initial_debt from clients c0 where c0.id = inv.client_id), 0) +
             coalesce((select sum(br.initial_debt) from barns br where br.client_id = inv.client_id), 0) +
             coalesce((
               select sum(i2.total_amount) from invoices i2
               where i2.client_id = inv.client_id
                 and coalesce(i2.invoice_lifecycle, 'active') != 'cancelled'
                 and (i2.created_at, i2.id) < (coalesce(inv.created_at, inv.updated_at, now()), inv.id)
             ), 0) -
             coalesce((
               select sum(py.amount) from payments py
               where py.client_id = inv.client_id
                 and coalesce(py.payment_method, '') not in ('deferred', 'آجل', 'credit')
                 and py.created_at < coalesce(inv.created_at::timestamptz, inv.updated_at::timestamptz, now())
             ), 0)
           )::float8 as client_balance_before,
           (
             case
               when inv.barn_id is null then null
               else (
                 coalesce((select br.initial_debt from barns br where br.id = inv.barn_id), 0) +
                 coalesce((
                   select sum(i2.total_amount) from invoices i2
                   where i2.barn_id = inv.barn_id
                     and coalesce(i2.invoice_lifecycle, 'active') != 'cancelled'
                     and (i2.created_at, i2.id) <= (coalesce(inv.created_at, inv.updated_at, now()), inv.id)
                 ), 0) -
                 coalesce((
                   select sum(py.amount) from payments py
                   where py.barn_id = inv.barn_id
                     and coalesce(py.payment_method, '') not in ('deferred', 'آجل', 'credit')
                     and py.created_at <= coalesce(inv.created_at::timestamptz, inv.updated_at::timestamptz, now())
                 ), 0)
               )::float8
             end
           ) as barn_balance_after,
           (
             case
               when inv.barn_id is null then null
               else (
                 coalesce((select br.initial_debt from barns br where br.id = inv.barn_id), 0) +
                 coalesce((
                   select sum(i2.total_amount) from invoices i2
                   where i2.barn_id = inv.barn_id
                     and coalesce(i2.invoice_lifecycle, 'active') != 'cancelled'
                     and (i2.created_at, i2.id) < (coalesce(inv.created_at, inv.updated_at, now()), inv.id)
                 ), 0) -
                 coalesce((
                   select sum(py.amount) from payments py
                   where py.barn_id = inv.barn_id
                     and coalesce(py.payment_method, '') not in ('deferred', 'آجل', 'credit')
                     and py.created_at < coalesce(inv.created_at::timestamptz, inv.updated_at::timestamptz, now())
                 ), 0)
               )::float8
             end
           ) as barn_balance_before
         from invoices inv
         left join warehouses wh on wh.id = inv.warehouse_id
         where inv.id = $1
         limit 1`,
        [id],
      )
      const row = inv.rows?.[0]
      if (!row) return send(404, { message: 'الفاتورة غير موجودة' })
      const items = await query('select * from invoice_items where invoice_id = $1 order by id asc', [id])
      return send(200, { ...(row as Record<string, unknown>), items: items.rows })
    }

    const paymentById = path.match(/^\/payments\/(\d+)$/)
    if (method === 'GET' && paymentById) {
      await requireAuth(req)
      const id = Number(paymentById[1])
      const out = await query(
        `select
           p.*,
           c.name as client_name,
           b.name as barn_name,
           (
             coalesce((select c0.initial_debt from clients c0 where c0.id = p.client_id), 0) +
             coalesce((select sum(br.initial_debt) from barns br where br.client_id = p.client_id), 0) +
             coalesce((
               select sum(i.total_amount) from invoices i
               where i.client_id = p.client_id
                 and coalesce(i.invoice_lifecycle, 'active') != 'cancelled'
                 and i.created_at <= coalesce(p.created_at, p.payment_date::timestamp)
             ), 0) -
             coalesce((
               select sum(py.amount) from payments py
               where py.client_id = p.client_id
                 and coalesce(py.payment_method, '') not in ('deferred', 'آجل', 'credit')
                 and (
                   py.created_at < coalesce(p.created_at, p.payment_date::timestamp)
                   or (
                     py.created_at = coalesce(p.created_at, p.payment_date::timestamp)
                     and py.id <= p.id
                   )
                 )
             ), 0)
           )::float8 as client_balance_after,
           (
             case
               when coalesce(p.payment_method, '') in ('deferred', 'آجل', 'credit') then
                 (
                   coalesce((select c0.initial_debt from clients c0 where c0.id = p.client_id), 0) +
                   coalesce((select sum(br.initial_debt) from barns br where br.client_id = p.client_id), 0) +
                   coalesce((
                     select sum(i.total_amount) from invoices i
                     where i.client_id = p.client_id
                       and coalesce(i.invoice_lifecycle, 'active') != 'cancelled'
                       and i.created_at <= coalesce(p.created_at, p.payment_date::timestamp)
                   ), 0) -
                   coalesce((
                     select sum(py.amount) from payments py
                     where py.client_id = p.client_id
                       and coalesce(py.payment_method, '') not in ('deferred', 'آجل', 'credit')
                       and (
                         py.created_at < coalesce(p.created_at, p.payment_date::timestamp)
                         or (
                           py.created_at = coalesce(p.created_at, p.payment_date::timestamp)
                           and py.id <= p.id
                         )
                       )
                   ), 0)
                 )::float8
               else
                 (
                   coalesce((select c0.initial_debt from clients c0 where c0.id = p.client_id), 0) +
                   coalesce((select sum(br.initial_debt) from barns br where br.client_id = p.client_id), 0) +
                   coalesce((
                     select sum(i.total_amount) from invoices i
                     where i.client_id = p.client_id
                       and coalesce(i.invoice_lifecycle, 'active') != 'cancelled'
                       and i.created_at <= coalesce(p.created_at, p.payment_date::timestamp)
                   ), 0) -
                   coalesce((
                     select sum(py.amount) from payments py
                     where py.client_id = p.client_id
                       and coalesce(py.payment_method, '') not in ('deferred', 'آجل', 'credit')
                       and (
                         py.created_at < coalesce(p.created_at, p.payment_date::timestamp)
                         or (
                           py.created_at = coalesce(p.created_at, p.payment_date::timestamp)
                           and py.id < p.id
                         )
                       )
                   ), 0)
                 )::float8
             end
           ) as client_balance_before,
           (
             case
               when coalesce(p.barn_id, pinv.barn_id) is null then null
               else (
                 coalesce((select br.initial_debt from barns br where br.id = coalesce(p.barn_id, pinv.barn_id)), 0) +
                 coalesce((
                   select sum(i.total_amount) from invoices i
                   where i.barn_id = coalesce(p.barn_id, pinv.barn_id)
                     and coalesce(i.invoice_lifecycle, 'active') != 'cancelled'
                     and i.created_at <= coalesce(p.created_at, p.payment_date::timestamp)
                 ), 0) -
                 coalesce((
                   select sum(py.amount) from payments py
                   where py.barn_id = coalesce(p.barn_id, pinv.barn_id)
                     and coalesce(py.payment_method, '') not in ('deferred', 'آجل', 'credit')
                     and (
                       py.created_at < coalesce(p.created_at, p.payment_date::timestamp)
                       or (
                         py.created_at = coalesce(p.created_at, p.payment_date::timestamp)
                         and py.id <= p.id
                       )
                     )
                 ), 0)
               )::float8
             end
           ) as barn_balance_after,
           (
             case
               when coalesce(p.barn_id, pinv.barn_id) is null then null
               when coalesce(p.payment_method, '') in ('deferred', 'آجل', 'credit') then
                 (
                   coalesce((select br.initial_debt from barns br where br.id = coalesce(p.barn_id, pinv.barn_id)), 0) +
                   coalesce((
                     select sum(i.total_amount) from invoices i
                     where i.barn_id = coalesce(p.barn_id, pinv.barn_id)
                       and coalesce(i.invoice_lifecycle, 'active') != 'cancelled'
                       and i.created_at <= coalesce(p.created_at, p.payment_date::timestamp)
                   ), 0) -
                   coalesce((
                     select sum(py.amount) from payments py
                     where py.barn_id = coalesce(p.barn_id, pinv.barn_id)
                       and coalesce(py.payment_method, '') not in ('deferred', 'آجل', 'credit')
                       and (
                         py.created_at < coalesce(p.created_at, p.payment_date::timestamp)
                         or (
                           py.created_at = coalesce(p.created_at, p.payment_date::timestamp)
                           and py.id <= p.id
                         )
                       )
                   ), 0)
                 )::float8
               else
                 (
                   coalesce((select br.initial_debt from barns br where br.id = coalesce(p.barn_id, pinv.barn_id)), 0) +
                   coalesce((
                     select sum(i.total_amount) from invoices i
                     where i.barn_id = coalesce(p.barn_id, pinv.barn_id)
                       and coalesce(i.invoice_lifecycle, 'active') != 'cancelled'
                       and i.created_at <= coalesce(p.created_at, p.payment_date::timestamp)
                   ), 0) -
                   coalesce((
                     select sum(py.amount) from payments py
                     where py.barn_id = coalesce(p.barn_id, pinv.barn_id)
                       and coalesce(py.payment_method, '') not in ('deferred', 'آجل', 'credit')
                       and (
                         py.created_at < coalesce(p.created_at, p.payment_date::timestamp)
                         or (
                           py.created_at = coalesce(p.created_at, p.payment_date::timestamp)
                           and py.id < p.id
                         )
                       )
                   ), 0)
                 )::float8
             end
           ) as barn_balance_before
         from payments p
         left join clients c on c.id = p.client_id
         left join barns b on b.id = p.barn_id
         left join invoices pinv on pinv.id = p.invoice_id
         where p.id = $1
         limit 1`,
        [id],
      )
      const row = out.rows?.[0]
      if (!row) return send(404, { message: 'الدفعة غير موجودة' })
      return send(200, row)
    }

    if (method === 'GET' && path === '/payments') {
      await requireAuth(req)
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200)
      const out = await query(
        `select p.*, c.name as client_name, b.name as barn_name
         from payments p
         left join clients c on c.id = p.client_id
         left join barns b on b.id = p.barn_id
         where coalesce(p.payment_method, '') in ('cash', 'vodafone_cash', 'instapay')
         order by p.id desc
         limit $1`,
        [limit],
      )
      return send(200, { data: out.rows, total: out.rows.length })
    }

    if (method === 'GET' && path === '/safe/balance') {
      await requireAuth(req)
      const out = await query(
        `select coalesce(sum(
          case
            when type in ('initial','customer_payment_in','adjustment_in') then amount
            else -amount
          end
        ),0) as balance from safe_transactions`,
      )
      return send(200, { balance: Math.max(0, Number(out.rows?.[0]?.balance ?? 0)) })
    }

    if (method === 'GET' && path === '/safe/transactions') {
      await requireAuth(req)
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100)
      const out = await query('select * from safe_transactions order by id desc limit $1', [limit])
      return send(200, { data: out.rows, total: out.rows.length })
    }

    if (method === 'POST' && path === '/safe/initial') {
      await requireAuth(req)
      const body = await parseJson(req) as Record<string, unknown>
      await query(
        `insert into safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
         values ('initial',$1,null,null,$2,now(),null)`,
        [Number(body.amount ?? 0), body.notes ?? null],
      )
      return send(204, {})
    }

    if (method === 'POST' && path === '/safe/adjustment') {
      await requireAuth(req)
      const body = await parseJson(req) as Record<string, unknown>
      await query(
        `insert into safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
         values ($1,$2,null,null,$3,now(),null)`,
        [body.type ?? 'adjustment_in', Number(body.amount ?? 0), body.notes ?? null],
      )
      return send(204, {})
    }

    const deleteSafeTxn = path.match(/^\/safe\/transactions\/(\d+)$/)
    if (method === 'DELETE' && deleteSafeTxn) {
      await requireAuth(req)
      const id = Number(deleteSafeTxn[1])
      const row = await query('select * from safe_transactions where id = $1', [id])
      if (!row.rows?.[0]) return send(404, { message: 'الحركة غير موجودة' })
      if ((row.rows?.[0] as Record<string, unknown>).reference_type) {
        return send(400, { message: 'لا يمكن حذف حركة مرتبطة بعملية أخرى (دفعة عميل أو مورد).' })
      }
      await query('delete from safe_transactions where id = $1', [id])
      return send(204, {})
    }

    if (method === 'POST' && path === '/safe/clear-history') {
      await requireAuth(req)
      const out = await query('delete from safe_transactions where reference_type is null')
      return send(200, { deleted: Number(out.rowCount ?? 0) })
    }

    if (method === 'GET' && path === '/reports/dashboard') {
      const auth = await requireAuth(req) as { role?: string; sub?: string }
      const fromD = (url.searchParams.get('from') || '').trim()
      const toD = (url.searchParams.get('to') || '').trim()
      const rangeOk =
        /^\d{4}-\d{2}-\d{2}$/.test(fromD) &&
        /^\d{4}-\d{2}-\d{2}$/.test(toD)
      const dateFilter = rangeOk
        ? ` and created_at::date >= $1::date and created_at::date <= $2::date`
        : ''
      const dateArgs = rangeOk ? [fromD, toD] : []
      const [salesInRange, invoiceTotalsGlobal, clientStats, stockStats, safeStats, supplierStats, inventoryStats] =
        await Promise.all([
          query(
            `
          select 
            coalesce(sum(total_amount),0) as total_sales,
            (
              coalesce(sum(profit_amount),0) - 
              coalesce((select sum(amount) from payments where payment_method = 'discount' ${dateFilter}), 0)
            ) as total_profit
          from invoices 
          where coalesce(invoice_lifecycle,'active') != 'cancelled'
          ${dateFilter}
        `,
            dateArgs,
          ),
          query(`
          select 
            count(*)::int as invoices_count,
            count(case when coalesce(remaining_amount,0) > 0 then 1 end)::int as unpaid_invoices_count
          from invoices 
          where coalesce(invoice_lifecycle,'active') != 'cancelled'
        `),
        query(`
          select 
            (select count(*)::int from clients) as clients_count,
            (
              coalesce((select sum(initial_debt) from clients),0) +
              coalesce((select sum(initial_debt) from barns),0) +
              coalesce((select sum(total_amount) from invoices where coalesce(invoice_lifecycle,'active') != 'cancelled' and client_id is not null),0) -
              coalesce((select sum(case when coalesce(payment_method,'') in ('deferred','آجل','credit') then 0 else amount end) from payments where client_id is not null),0)
            ) as client_debt,
            coalesce((select sum(amount) from payments where payment_method = 'deferred' and settled_at is null),0) as total_deferred_receivable
        `),
        query(`
          with primary_wh as (select id from warehouses where name_ar like '%اجهور%' or name_ar like '%أجهور%' or name_en ilike '%aghour%' limit 1)
          select 
            (select count(*)::int from product_warehouse_stock where warehouse_id = (select id from primary_wh) and coalesce(quantity,0) > 0) as products_count,
            (
              select count(*)::int from products p
              where (select coalesce(quantity,0) from product_warehouse_stock s where s.product_id = p.id and s.warehouse_id = (select id from primary_wh)) <= (case when p.unit_type = 'bulk' then coalesce(p.alert_level_kg, p.alert_level) else coalesce(p.alert_level, 0) end)
              and exists (select 1 from product_warehouse_stock s2 where s2.product_id = p.id and s2.warehouse_id = (select id from primary_wh))
            ) as low_stock_count,
            (
              select count(distinct product_id)::int from product_batches 
              where expiry_date is not null and expiry_date <= now() + interval '30 days' and coalesce(quantity,0) > 0
              and warehouse_id = (select id from primary_wh)
            ) as expiring_count
        `),
        query(`
          select coalesce(sum(
            case 
              when type in ('initial','customer_payment_in','adjustment_in') then amount
              else -amount
            end
          ), 0) as balance
          from safe_transactions
        `),
        query(`
          select 
            (select count(*)::int from suppliers) as suppliers_count,
            (
              coalesce((select sum(total_amount) from supplier_purchases),0) -
              coalesce((select sum(amount) from supplier_payments),0)
            ) as supplier_payable
        `),
        query(`
          with primary_wh as (select id from warehouses where name_ar like '%اجهور%' or name_ar like '%أجهور%' or name_en ilike '%aghour%' limit 1)
          select
            sum(
              case when coalesce(pb.unit_type, 'piece') = 'bulk'
                then coalesce(pb.kg_remaining, 0) * coalesce(pb.purchase_price, p.purchase_price, 0)
                else coalesce(pb.quantity, 0) * coalesce(pb.purchase_price, p.purchase_price, 0)
              end
            ) as inventory_value_purchase,
            sum(
              case when coalesce(pb.unit_type, 'piece') = 'bulk'
                then coalesce(pb.kg_remaining, 0) * coalesce(pb.selling_price, p.selling_price, 0)
                else coalesce(pb.quantity, 0) * coalesce(pb.selling_price, p.selling_price, 0)
              end
            ) as inventory_value_selling
          from product_batches pb
          join products p on p.id = pb.product_id
          where pb.warehouse_id = (select id from primary_wh)
        `)
        ])

      const b = { ...(salesInRange.rows?.[0] || {}), ...(invoiceTotalsGlobal.rows?.[0] || {}) }
      const c = clientStats.rows?.[0] || {}
      const s = stockStats.rows?.[0] || {}
      const sf = safeStats.rows?.[0] || {}
      const sp = supplierStats.rows?.[0] || {}
      const inv = inventoryStats.rows?.[0] || {}

      const results = {
        total_sales: Number(b.total_sales ?? 0),
        total_profit: Number(b.total_profit ?? 0),
        client_debt: Math.max(0, Number(c.client_debt ?? 0)),
        total_deferred_receivable: Number(c.total_deferred_receivable ?? 0),
        product_count: Number(s.products_count ?? 0),
        low_stock_count: Number(s.low_stock_count ?? 0),
        expiring_count: Number(s.expiring_count ?? 0),
        unpaid_invoices_count: Number(b.unpaid_invoices_count ?? 0),
        safe_balance: Number(sf.balance ?? 0),
        supplier_payable: Math.max(0, Number(sp.supplier_payable ?? 0)),
        clients_count: Number(c.clients_count ?? 0),
        products_count: Number(s.products_count ?? 0),
        invoices_count: Number(b.invoices_count ?? 0),
        suppliers_count: Number(sp.suppliers_count ?? 0),
        inventory_value_purchase: Number(inv.inventory_value_purchase ?? 0),
        inventory_value_selling: Number(inv.inventory_value_selling ?? 0),
      }

      if (auth.role === 'staff') {
        return send(200, {
          ...results,
          total_sales: 0,
          total_profit: 0,
          client_debt: 0,
          safe_balance: 0,
          supplier_payable: 0,
          inventory_value_purchase: 0,
          inventory_value_selling: 0,
        })
      }

      return send(200, results)
    }

    if (method === 'GET' && path === '/reports/by-category') {
      await requireAuth(req)
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')
      const args: unknown[] = []
      let where = "where coalesce(i.invoice_lifecycle,'active') != 'cancelled'"
      if (from) {
        args.push(from)
        where += ` and i.created_at::date >= $${args.length}::date`
      }
      if (to) {
        args.push(to)
        where += ` and i.created_at::date <= $${args.length}::date`
      }
      const out = await query(
        `select coalesce(p.category,'غير مصنف') as category,
                coalesce(sum(ii.total_price),0) as total_sales,
                coalesce(sum(ii.quantity),0) as total_quantity
         from invoice_items ii
         join invoices i on i.id = ii.invoice_id
         left join products p on p.id = ii.product_id
         ${where}
         group by coalesce(p.category,'غير مصنف')
         order by total_sales desc`,
        args,
      )
      return send(200, { data: out.rows })
    }

    if (method === 'GET' && path === '/reports/top-products') {
      await requireAuth(req)
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')
      const limit = Math.min(Number(url.searchParams.get('limit') || 10), 100)
      const args: unknown[] = []
      let where = "where coalesce(i.invoice_lifecycle,'active') != 'cancelled'"
      if (from) {
        args.push(from)
        where += ` and i.created_at::date >= $${args.length}::date`
      }
      if (to) {
        args.push(to)
        where += ` and i.created_at::date <= $${args.length}::date`
      }
      args.push(limit)
      const out = await query(
        `select ii.product_id,
                coalesce(p.name, ii.product_name) as name,
                coalesce(sum(ii.total_price),0) as total_sales,
                coalesce(sum(ii.quantity),0) as total_quantity
         from invoice_items ii
         join invoices i on i.id = ii.invoice_id
         left join products p on p.id = ii.product_id
         ${where}
         group by ii.product_id, coalesce(p.name, ii.product_name)
         order by total_sales desc
         limit $${args.length}`,
        args,
      )
      return send(200, { data: out.rows })
    }

    if (method === 'GET' && path === '/reports/sales-by-day') {
      await requireAuth(req)
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')
      const days = Math.min(Number(url.searchParams.get('days') || 30), 365)
      const args: unknown[] = []
      let where = "where coalesce(invoice_lifecycle,'active') != 'cancelled'"
      if (from && to) {
        args.push(from, to)
        where += ` and created_at::date between $1::date and $2::date`
      } else {
        args.push(days)
        where += ` and created_at::date >= (now()::date - ($1::int || ' days')::interval)::date`
      }
      const out = await query(
        `select created_at::date as day,
                coalesce(sum(total_amount),0) as total_sales,
                count(*)::int as invoice_count
         from invoices
         ${where}
         group by created_at::date
         order by day asc`,
        args,
      )
      return send(200, { data: out.rows })
    }

    const clientStmt = path.match(/^\/clients\/(\d+)\/account-statement$/)
    if (method === 'GET' && clientStmt) {
      await requireAuth(req)
      const data = await buildAccountStatement({
        clientId: Number(clientStmt[1]),
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
      })
      return send(200, data)
    }

    const clientStatement = path.match(/^\/clients\/(\d+)\/statement$/)
    if (method === 'GET' && clientStatement) {
      await requireAuth(req)
      const data = await buildAccountStatement({
        clientId: Number(clientStatement[1]),
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
      })
      return send(200, data)
    }

    const barnStmt = path.match(/^\/barns\/(\d+)\/account-statement$/)
    if (method === 'GET' && barnStmt) {
      await requireAuth(req)
      const data = await buildAccountStatement({
        barnId: Number(barnStmt[1]),
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
      })
      return send(200, data)
    }

    const barnStatement = path.match(/^\/barns\/(\d+)\/statement$/)
    if (method === 'GET' && barnStatement) {
      await requireAuth(req)
      const data = await buildAccountStatement({
        barnId: Number(barnStatement[1]),
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
      })
      return send(200, data)
    }

    const acctClient = path.match(/^\/account-statement\/client\/(\d+)$/)
    if (method === 'GET' && acctClient) {
      await requireAuth(req)
      const data = await buildAccountStatement({
        clientId: Number(acctClient[1]),
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
      })
      return send(200, data)
    }

    const acctBarn = path.match(/^\/account-statement\/barn\/(\d+)$/)
    if (method === 'GET' && acctBarn) {
      await requireAuth(req)
      const data = await buildAccountStatement({
        barnId: Number(acctBarn[1]),
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
      })
      return send(200, data)
    }

    const stmtAfterClient = path.match(/^\/clients\/(\d+)\/statement-after-cycle$/)
    if (method === 'GET' && stmtAfterClient) {
      await requireAuth(req)
      const clientId = Number(stmtAfterClient[1])
      const cycleId = Number(url.searchParams.get('cycle_id') || 0)
      const cyc = await query('select * from client_billing_cycles where id = $1 and client_id = $2 limit 1', [cycleId, clientId])
      const cycle = cyc.rows?.[0] as Record<string, unknown> | undefined
      if (!cycle) return send(404, { message: 'الدورة غير موجودة' })
      const from = cycle.ended_at ? toYmd(String(cycle.ended_at)) : undefined
      const data = await buildAccountStatement({ clientId, from })
      return send(200, { ...data, after_cycle: { cycle_id: cycleId, cycle_ended_at: cycle.ended_at, from, to: toYmd(new Date()) } })
    }

    const stmtAfterBarn = path.match(/^\/barns\/(\d+)\/statement-after-cycle$/)
    if (method === 'GET' && stmtAfterBarn) {
      await requireAuth(req)
      const barnId = Number(stmtAfterBarn[1])
      const cycleId = Number(url.searchParams.get('cycle_id') || 0)
      const cyc = await query('select * from barn_billing_cycles where id = $1 and barn_id = $2 limit 1', [cycleId, barnId])
      const cycle = cyc.rows?.[0] as Record<string, unknown> | undefined
      if (!cycle) return send(404, { message: 'الدورة غير موجودة' })
      const from = cycle.ended_at ? toYmd(String(cycle.ended_at)) : undefined
      const data = await buildAccountStatement({ barnId, from })
      return send(200, { ...data, after_cycle: { cycle_id: cycleId, cycle_ended_at: cycle.ended_at, from, to: toYmd(new Date()) } })
    }

    const cycleStmt = path.match(/^\/billing-cycles\/(\d+)\/account-statement$/)
    if (method === 'GET' && cycleStmt) {
      await requireAuth(req)
      const cycleId = Number(cycleStmt[1])
      const cyc = await query('select * from client_billing_cycles where id = $1 limit 1', [cycleId])
      const cycle = cyc.rows?.[0] as Record<string, unknown> | undefined
      if (!cycle) return send(404, { message: 'الدورة غير موجودة' })
      const data = await buildAccountStatement({
        clientId: Number(cycle.client_id),
        from: cycle.started_at ? toYmd(String(cycle.started_at)) : undefined,
        to: cycle.ended_at ? toYmd(String(cycle.ended_at)) : undefined,
      })
      return send(200, { ...data, cycle })
    }

    const barnCycleStmt = path.match(/^\/barn-billing-cycles\/(\d+)\/account-statement$/)
    if (method === 'GET' && barnCycleStmt) {
      await requireAuth(req)
      const cycleId = Number(barnCycleStmt[1])
      const cyc = await query('select * from barn_billing_cycles where id = $1 limit 1', [cycleId])
      const cycle = cyc.rows?.[0] as Record<string, unknown> | undefined
      if (!cycle) return send(404, { message: 'الدورة غير موجودة' })
      const data = await buildAccountStatement({
        barnId: Number(cycle.barn_id),
        from: cycle.started_at ? toYmd(String(cycle.started_at)) : undefined,
        to: cycle.ended_at ? toYmd(String(cycle.ended_at)) : undefined,
      })
      return send(200, { ...data, cycle })
    }

    if (method === 'GET' && path === '/settings') {
      await requireAuth(req)
      const out = await query('select key, value from settings')
      const kv: Record<string, string> = {}
      for (const r of out.rows as Array<{ key: string; value: string }>) kv[r.key] = r.value
      return send(200, kv)
    }

    if (method === 'PATCH' && path === '/settings') {
      await requireAuth(req)
      const body = await parseJson(req) as Record<string, unknown>
      for (const [k, v] of Object.entries(body)) {
        await query(
          `insert into settings (key, value) values ($1,$2)
           on conflict (key) do update set value = excluded.value`,
          [k, String(v ?? '')],
        )
      }
      const out = await query('select key, value from settings')
      const kv: Record<string, string> = {}
      for (const r of out.rows as Array<{ key: string; value: string }>) kv[r.key] = r.value
      return send(200, kv)
    }

    if (method === 'POST' && path === '/settings/reset-test-data') {
      const auth = await requireAuth(req) as Record<string, unknown>
      // Support role either at top level (custom JWT) or in user_metadata (Supabase standard)
      const role = String(auth.role || (auth.user_metadata as any)?.role || '')
      if (role !== 'super_admin') {
        return send(403, { message: 'غير مصرح — متاح فقط لمدير النظام' })
      }
      const result = await transaction(async (q) => {
        let deleted = 0
        const del = async (sql: string) => {
          const out = await q(sql)
          deleted += Number(out.rowCount ?? 0)
        }

        // Delete operational/test data. 
        // IMPORTANT: Order matters to satisfy foreign key constraints.
        // Preserving inventory products (products table), but zeroing their current stock.
        
        await del('delete from invoice_item_bags')
        await del('delete from invoice_item_batches')
        await del('delete from return_items')
        await del('delete from return_documents')
        await del('delete from invoice_items')
        await del('delete from payments')           // Must be before invoices/clients/barns
        await del('delete from wallet_transactions') // Must be before digital_wallets
        await del('delete from invoices')           // Must be before clients/barns
        await del('delete from safe_transactions')
        await del('delete from supplier_purchase_items')
        await del('delete from supplier_purchases')
        await del('delete from supplier_payments')
        await del('delete from barn_billing_cycles')
        await del('delete from client_billing_cycles')
        await del('delete from inventory_transfer_items')
        await del('delete from inventory_transfers')
        await del('delete from barns')
        await del('delete from digital_wallets')
        await del('delete from clients')
        await del('delete from suppliers')

        // Zero out inventory quantities while keeping product records
        await q('UPDATE product_batches SET quantity = 0, kg_remaining = 0, bag_count = 0')
        await q("UPDATE bag_instances SET kg_remaining = 0, status = 'empty'")
        await q('UPDATE product_warehouse_stock SET quantity = 0')

        return { deleted_rows: deleted }
      })
      return send(200, { ok: true, ...result })
    }


    if (method === 'GET' && path === '/users') {
      await requireAuth(req)
      const out = await query('select id, email, display_name, role, is_active, created_at, updated_at from users order by id desc')
      return send(200, { data: out.rows })
    }

    if (method === 'POST' && path === '/users') {
      await requireAuth(req)
      const body = await parseJson(req) as Record<string, unknown>
      const email = String(body.email || '').trim()
      const password = String(body.password || '')
      if (!email || !password) return send(400, { message: 'البريد وكلمة المرور مطلوبان' })
      if (password.length < 6) return send(400, { message: 'كلمة المرور 6 أحرف على الأقل' })
      const displayName = String(body.display_name ?? '')
      const role = String(body.role ?? 'staff')

      const appExisting = await query(
        `select id from users where lower(email) = lower($1) limit 1`,
        [email],
      )
      if (appExisting.rows?.[0]) return send(409, { message: 'البريد مستخدم بالفعل' })

      await ensureAuthUserByEmail({ email, password, displayName: displayName || email.split('@')[0], role })

      const hash = await hashPassword(password)
      const out = await query(
        `insert into users (email, password_hash, display_name, role, is_active, created_at, updated_at)
         values ($1,$2,$3,$4,true,now(),now())
         returning id, email, display_name, role, is_active, created_at, updated_at`,
        [email, hash, displayName, role],
      )
      return send(201, out.rows?.[0])
    }

    const userById = path.match(/^\/users\/(\d+)$/)
    if (method === 'PATCH' && userById) {
      await requireAuth(req)
      const id = Number(userById[1])
      const body = await parseJson(req) as Record<string, unknown>
      const currentUserOut = await query(
        'select id, email, display_name, role, is_active from users where id = $1 limit 1',
        [id],
      )
      const currentUser = currentUserOut.rows?.[0] as Record<string, unknown> | undefined
      if (!currentUser) return send(404, { message: 'المستخدم غير موجود' })
      const fields: string[] = []
      const vals: unknown[] = []
      const add = (k: string, v: unknown) => { vals.push(v); fields.push(`${k} = $${vals.length}`) }
      if (body.display_name !== undefined) add('display_name', body.display_name)
      if (body.role !== undefined) add('role', body.role)
      if (body.is_active !== undefined) add('is_active', Boolean(body.is_active))
      if (body.password !== undefined) add('password_hash', await hashPassword(String(body.password)))
      if (!fields.length) {
        return send(200, currentUser)
      }
      vals.push(id)
      const out = await query(
        `update users set ${fields.join(', ')}, updated_at = now() where id = $${vals.length}
         returning id, email, display_name, role, is_active, created_at, updated_at`,
        vals,
      )
      const row = out.rows?.[0]
      if (!row) return send(404, { message: 'المستخدم غير موجود' })

      if (body.password !== undefined) {
        await ensureAuthUserByEmail({
          email: String(row.email),
          password: String(body.password),
          displayName: String(row.display_name || row.email || ''),
          role: String(row.role || 'staff'),
        })
      } else if (body.display_name !== undefined || body.role !== undefined) {
        await query(
          `update auth.users
           set raw_user_meta_data = coalesce(raw_user_meta_data,'{}'::jsonb) ||
             jsonb_build_object('display_name', $2::text, 'role', $3::text),
               updated_at = now()
           where lower(email) = lower($1)`,
          [String(row.email), String(row.display_name || ''), String(row.role || 'staff')],
        )
      }

      return send(200, row)
    }

    if (method === 'DELETE' && userById) {
      await requireAuth(req)
      await query('delete from users where id = $1', [Number(userById[1])])
      return send(204, {})
    }

    if (method === 'POST' && path === '/invoices') {
      await requireAuth(req)
      const body = await parseJson(req)
      const result = await transaction(async (q) => {
        return await createInvoiceInternal(q, body)
      })
      return send(200, result)
    }

    const patchInvoice = path.match(/^\/invoices\/(\d+)$/)
    if (method === 'PATCH' && patchInvoice) {
      await requireAuth(req)
      const invoiceId = Number(patchInvoice[1])
      const body = await parseJson(req) as Record<string, unknown>
      if (body?.invoice_lifecycle === 'cancelled') {
        const result = await rpc('public.cancel_invoice', [invoiceId])
        return send(200, result?.data ?? result)
      }
      if (Array.isArray(body?.items)) {
        const result = await transaction(async (q) => {
          return await replaceInvoiceInternal(q, invoiceId, body)
        })
        return send(200, result)
      }
      const fields: string[] = []
      const vals: unknown[] = []
      const add = (k: string, v: unknown) => { vals.push(v); fields.push(`${k} = $${vals.length}`) }
      if (body.customer_name !== undefined) add('customer_name', body.customer_name)
      if (body.payment_method !== undefined) add('payment_method', body.payment_method)
      if (body.status !== undefined) add('status', body.status)
      if (body.notes !== undefined) add('notes', body.notes)
      if (body.discount_amount !== undefined) add('discount_amount', Number(body.discount_amount))
      if (body.due_date !== undefined) add('due_date', body.due_date)
      if (body.paid_amount !== undefined) add('paid_amount', Number(body.paid_amount))
      if (body.remaining_amount !== undefined) add('remaining_amount', Number(body.remaining_amount))
      if (body.total_amount !== undefined) add('total_amount', Number(body.total_amount))
      if (!fields.length) {
        const cur = await query('select * from invoices where id = $1 limit 1', [invoiceId])
        const row = cur.rows?.[0]
        if (!row) return send(404, { message: 'الفاتورة غير موجودة' })
        return send(200, row)
      }
      vals.push(invoiceId)
      const out = await query(
        `update invoices set ${fields.join(', ')}, updated_at = now() where id = $${vals.length} returning *`,
        vals,
      )
      const row = out.rows?.[0]
      if (!row) return send(404, { message: 'الفاتورة غير موجودة' })
      return send(200, row)
    }

    const deleteInvoice = path.match(/^\/invoices\/(\d+)$/)
    if (method === 'DELETE' && deleteInvoice) {
      await requireAuth(req)
      const result = await rpc('public.cancel_invoice', [Number(deleteInvoice[1])])
      return send(200, result?.data ?? result)
    }

    const deleteItem = path.match(/^\/invoices\/(\d+)\/items\/(\d+)$/)
    if (method === 'DELETE' && deleteItem) {
      await requireAuth(req)
      const result = await rpc('public.delete_invoice_item', [
        Number(deleteItem[1]),
        Number(deleteItem[2]),
      ])
      return send(200, result?.data ?? result)
    }

    const returnItem = path.match(/^\/invoices\/(\d+)\/items\/(\d+)\/return$/)
    if (method === 'POST' && returnItem) {
      await requireAuth(req)
      const body = await parseJson(req) as Record<string, unknown>
      const payload = {
        ...body,
        invoice_id: Number(returnItem[1]),
        item_id: Number(returnItem[2]),
      }
      const result = await rpc('public.return_partial_invoice_item', [JSON.stringify(payload)])
      return send(200, result?.data ?? result)
    }

    if (method === 'POST' && path === '/supplier-receipts') {
      await requireAuth(req)
      const body = await parseJson(req)
      
      const items = Array.isArray(body.items) ? body.items : []
      const totalAmount = items.reduce((acc, it) => {
        const qty = Number(it.quantity || 0)
        const unitPrice = Number(it.unit_price || 0)
        if (it.unit_type === 'bulk') {
          const kpb = Number(it.kg_per_bag || 0)
          return acc + (qty * kpb * unitPrice)
        }
        return acc + (qty * unitPrice)
      }, 0)
      
      body.total_amount = totalAmount
      
      const result = await rpc('public.create_supplier_receipt', [JSON.stringify(body)])
      
      const pId = result?.data?.id ?? result?.id
      if (pId) {
        // Fix any missing total_amount or incorrect total_price in items (to handle bulk correctly)
        await query('update supplier_purchases set total_amount = $1 where id = $2', [totalAmount, pId])
        
        // Fix total_price in items because the RPC uses bag_qty * price instead of kg_qty * price for bulk
        for (const it of items) {
          if (it.unit_type === 'bulk') {
            const qty = Number(it.quantity || 0)
            const unitPrice = Number(it.unit_price || 0)
            const kpb = Number(it.kg_per_bag || 0)
            const correctTotal = qty * kpb * unitPrice
            await query(`update supplier_purchase_items set total_price = $1 where supplier_purchase_id = $2 and product_id = $3`, [correctTotal, pId, it.product_id])
          }
        }
      }

      return send(200, [result?.data ?? result])
    }

    if (method === 'POST' && path === '/payments') {
      await requireAuth(req)
      const body = await parseJson(req) as Record<string, unknown>
      const pm = normalizeRegisterPaymentMethod(body.payment_method)
      if (!pm.ok) return send(400, { message: pm.message })

      const payment = await transaction(async (q) => {
        const pay = await insertPaymentWithRouting(q, {
          client_id: body.client_id ?? null,
          barn_id: body.barn_id ?? null,
          amount: Number(body.amount ?? 0),
          payment_method: pm.value,
          notes: body.notes ?? null,
          payment_date: body.payment_date ?? new Date().toISOString().slice(0, 10),
          invoice_id: body.invoice_id ?? null,
          wallet_id: body.wallet_id ?? null,
        })

        if (pm.value === 'discount') {
          if (pay.client_id) {
            await q(
              'UPDATE clients SET total_profit = GREATEST(0, COALESCE(total_profit, 0) - $1) WHERE id = $2',
              [pay.amount, pay.client_id]
            )
          }
          if (pay.barn_id) {
            await q(
              'UPDATE barns SET total_profit = GREATEST(0, COALESCE(total_profit, 0) - $1) WHERE id = $2',
              [pay.amount, pay.barn_id]
            )
          }
        }

        return pay
      })

      return send(200, payment)
    }

    return send(404, { message: 'Not found', route: `${method} ${path}` })
  } catch (err) {
    const e = err as { message?: string; status?: number }
    return send(e.status ?? 500, { error: e.message ?? 'Internal error' })
  }
})
