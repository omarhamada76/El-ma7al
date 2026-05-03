import 'dotenv/config'
/**
 * Local backend for Vet Pharmacy Dashboard.
 * Run: npm run server (or node server/index.js)
 * Frontend proxies /api to this server (see vite.config proxy).
 * Data is persisted in SQLite: data/vet-pharmacy.sqlite
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as db from './pgdb.js'
import * as auth from './auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, '..', 'dist')

const PORT = Number(process.env.PORT) || 3001

if (process.env.NODE_ENV === 'production') {
  auth.getJwtSecret()
  if (!process.env.CORS_ORIGIN?.trim()) {
    throw new Error('CORS_ORIGIN environment variable is required in production')
  }
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return CONTENT_TYPES[ext] || 'application/octet-stream'
}

/** Safe path under dist/ for URL pathname, or null if traversal. */
function safeDistPathFromUrl(urlPath) {
  const pathname = (urlPath || '/').split('?')[0] || '/'
  const rel = pathname === '/' ? '' : pathname.replace(/^\/+/, '')
  if (rel && rel.split('/').some((s) => s === '..')) return null
  const joined = rel ? path.join(DIST_DIR, rel) : path.join(DIST_DIR, 'index.html')
  const baseRes = path.resolve(DIST_DIR)
  const resolved = path.resolve(joined)
  if (!resolved.startsWith(baseRes + path.sep) && resolved !== baseRes) return null
  return resolved
}

function serveProductionStatic(req, res, urlPath) {
  let filePath = safeDistPathFromUrl(urlPath)
  if (!filePath) {
    res.writeHead(403)
    res.end()
    return
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(DIST_DIR, 'index.html')
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }
  }
  const ct = contentTypeFor(filePath)
  const isHtml = path.extname(filePath).toLowerCase() === '.html'
  const headers = {
    'Content-Type': ct,
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000',
  }
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = fs.createReadStream(filePath)
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
  stream.pipe(res)
}

function corsAllowOrigin(req) {
  const raw =
    process.env.NODE_ENV === 'production'
      ? process.env.CORS_ORIGIN
      : (process.env.CORS_ORIGIN || 'http://localhost:5173')
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean)
  const origin = req.headers.origin
  if (list.includes('*')) return '*'
  if (origin && list.includes(origin)) return origin
  return list[0] || '*'
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (ch) => { data += ch })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
  })
  res.end(JSON.stringify(body))
}

function getToken(req) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return null
  return auth.slice(7)
}

function requireAuth(req, res) {
  const token = getToken(req)
  if (!token) {
    send(res, 401, { message: 'Unauthorized' })
    return false
  }
  const payload = auth.verifyAccessToken(token)
  if (!payload) {
    send(res, 401, { message: 'Unauthorized' })
    return false
  }
  req.auth = payload
  return true
}

/** super_admin or admin — user management UI */
function requireManageUsers(req, res) {
  if (!requireAuth(req, res)) return false
  const role = req.auth.role
  if (role !== 'super_admin' && role !== 'admin') {
    send(res, 403, { message: 'غير مصرح بإدارة المستخدمين' })
    return false
  }
  return true
}

function assertRoleCreatableByRequester(requesterRole, targetRole) {
  if (requesterRole === 'super_admin') return
  if (requesterRole === 'admin' && targetRole !== 'super_admin') return
  throw new Error('لا يمكنك إنشاء أو تعيين حساب مدير نظام')
}

/** Block موظف from financial / ledger / admin-only APIs */
function requireNotStaff(req, res) {
  if (!requireAuth(req, res)) return false
  if (req.auth.role === 'staff') {
    send(res, 403, { message: 'لا تملك صلاحية عرض هذه البيانات' })
    return false
  }
  return true
}

function sanitizeClientForStaff(c) {
  if (!c) return c
  const out = { ...c }
  delete out.total_profit
  delete out.balance
  return out
}

function sanitizeBarnForStaff(b) {
  if (!b) return b
  const out = { ...b }
  delete out.total_profit
  return out
}

function sanitizeInvoiceForStaff(inv) {
  if (!inv) return inv
  const out = { ...inv }
  delete out.profit_amount
  if (Array.isArray(out.items)) {
    out.items = out.items.map((it) => {
      const row = { ...it }
      delete row.profit_amount
      delete row.line_profit
      return row
    })
  }
  return out
}

/** Edit-window metadata for invoice detail / edit UI (setting read fresh each request). */
async function attachInvoiceEditMeta(inv, role) {
  if (!inv?.id) return inv
  const st = await db.getInvoiceEditWindowStatus(inv.id)
  if (!st) return inv
  const allowed = st.withinWindow || role === 'super_admin'
  return {
    ...inv,
    edit_window_days: st.windowDays,
    invoice_age_days: st.ageDays,
    structural_edit_within_window: st.withinWindow,
    structural_edit_allowed: allowed,
  }
}

/** Strip leading /api/v1 repeatedly (misconfigured clients may send /api/v1/api/v1/...). */
function stripApiV1Prefix(rawPath) {
  let p = (rawPath || '/').split('?')[0]
  while (p.startsWith('/api/v1')) {
    p = p.slice('/api/v1'.length)
    if (p === '') p = '/'
  }
  return p || '/'
}

function parseUrl(req) {
  const [path, qs] = (req.url || '').split('?')
  const pathParts = stripApiV1Prefix(path).split('/').filter(Boolean)
  const query = qs ? Object.fromEntries(new URLSearchParams(qs)) : {}
  return { path, pathParts, query }
}

// ----- Handlers -----
const handlers = {
  'GET /api/v1/auth/status': async (req, res) => {
    const n = await db.countUsers()
    send(res, 200, { needsBootstrap: n === 0, hasUsers: n > 0 })
  },
  'POST /api/v1/auth/bootstrap': async (req, res, body) => {
    if ((await db.countUsers()) > 0) return send(res, 403, { message: 'يوجد مستخدمون بالفعل' })
    const { email, password, display_name } = body || {}
    if (!email?.trim() || !password) {
      return send(res, 400, { message: 'البريد وكلمة المرور مطلوبان' })
    }
    if (password.length < 8) {
      return send(res, 400, { message: 'كلمة المرور 8 أحرف على الأقل للمسؤول الأول' })
    }
    try {
      const user = await db.createUser({
        email: email.trim(),
        password,
        display_name: display_name || 'مدير النظام',
        role: 'super_admin',
      })
      const accessToken = auth.signAccessToken(user)
      send(res, 201, { accessToken, refreshToken: accessToken, user })
    } catch (e) {
      const msg = e?.message || ''
      if (/UNIQUE|unique/i.test(msg)) {
        return send(res, 400, { message: 'البريد مستخدم بالفعل' })
      }
      send(res, 500, { message: msg || 'فشل إنشاء الحساب' })
    }
  },
  'POST /api/v1/auth/login': async (req, res, body) => {
    const { email, password } = body || {}
    if (!email || !password) return send(res, 400, { message: 'البريد وكلمة المرور مطلوبان' })
    if (password.length < 6) return send(res, 400, { message: 'كلمة المرور 6 أحرف على الأقل' })
    if ((await db.countUsers()) === 0) {
      return send(res, 503, {
        message: 'لم يُنشأ حساب بعد. أنشئ حساب المسؤول الأول من نفس الشاشة.',
        needsBootstrap: true,
      })
    }
    const user = await db.verifyUserPassword(email, password)
    if (!user) return send(res, 401, { message: 'البريد أو كلمة المرور غير صحيحة' })
    const accessToken = auth.signAccessToken(user)
    send(res, 200, { accessToken, refreshToken: accessToken, user })
  },
  'POST /api/v1/auth/logout': async (req, res) => send(res, 204),
  'GET /api/v1/auth/me': async (req, res) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(req.auth.sub, 10)
    const user = await db.getUserPublic(id)
    if (!user) return send(res, 401, { message: 'Unauthorized' })
    send(res, 200, user)
  },
  'GET /api/v1/users': async (req, res) => {
    if (!requireManageUsers(req, res)) return
    send(res, 200, { data: await db.listUsersPublic() })
  },
  'POST /api/v1/users': async (req, res, body) => {
    if (!requireManageUsers(req, res)) return
    const { email, password, display_name, role: roleRaw } = body || {}
    const role = roleRaw || 'staff'
    if (!email?.trim() || !password) {
      return send(res, 400, { message: 'البريد وكلمة المرور مطلوبان' })
    }
    if (password.length < 6) {
      return send(res, 400, { message: 'كلمة المرور 6 أحرف على الأقل' })
    }
    try {
      assertRoleCreatableByRequester(req.auth.role, role)
      const user = await db.createUser({
        email: email.trim(),
        password,
        display_name: display_name || '',
        role,
      })
      send(res, 201, user)
    } catch (e) {
      const msg = e.message || ''
      if (msg.includes('UNIQUE') || msg.includes('unique') || e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return send(res, 400, { message: 'البريد مستخدم بالفعل' })
      }
      send(res, 400, { message: msg || 'فشل إنشاء المستخدم' })
    }
  },
  'PATCH /api/v1/users/:id': async (req, res, body, { pathParts }) => {
    if (!requireManageUsers(req, res)) return
    const id = parseInt(pathParts[1], 10)
    if (!Number.isFinite(id)) return send(res, 400, { message: 'معرف غير صالح' })
    const existing = await db.getUserById(id)
    if (!existing) return send(res, 404, { message: 'المستخدم غير موجود' })
    if (existing.role === 'super_admin' && req.auth.role !== 'super_admin') {
      return send(res, 403, { message: 'لا يمكن تعديل مدير نظام إلا من قبل مدير نظام آخر' })
    }
    if (body.role && body.role !== existing.role) {
      try {
        assertRoleCreatableByRequester(req.auth.role, body.role)
      } catch (err) {
        return send(res, 403, { message: err.message })
      }
    }
    try {
      const row = await db.updateUser(id, {
        display_name: body.display_name,
        role: body.role,
        is_active: body.is_active,
        password: body.password,
      })
      if (!row) return send(res, 404, { message: 'المستخدم غير موجود' })
      send(res, 200, row)
    } catch (e) {
      send(res, 400, { message: e.message || 'فشل التحديث' })
    }
  },
  'DELETE /api/v1/users/:id': async (req, res, _body, { pathParts }) => {
    if (!requireManageUsers(req, res)) return
    const id = parseInt(pathParts[1], 10)
    if (!Number.isFinite(id)) return send(res, 400, { message: 'معرف غير صالح' })
    const existing = await db.getUserById(id)
    if (!existing) return send(res, 404, { message: 'المستخدم غير موجود' })
    if (String(id) === String(req.auth.sub)) {
      return send(res, 400, { message: 'لا يمكن حذف حسابك الحالي' })
    }
    if (existing.role === 'super_admin' && req.auth.role !== 'super_admin') {
      return send(res, 403, { message: 'لا يمكن حذف مدير نظام إلا من قبل مدير نظام آخر' })
    }
    try {
      const ok = await db.deleteUser(id)
      if (!ok) return send(res, 404, { message: 'المستخدم غير موجود' })
      send(res, 204)
    } catch (e) {
      send(res, 400, { message: e.message || 'لا يمكن حذف المستخدم' })
    }
  },
  'GET /api/v1/reports/dashboard': async (req, res, _body, { query }) => {
    if (!requireAuth(req, res)) return
    const stats = await db.getDashboardStats({
      from: query.from || undefined,
      to: query.to || undefined,
    })
    if (req.auth.role === 'staff') {
      return send(res, 200, {
        ...stats,
        total_sales: 0,
        total_profit: 0,
        client_debt: 0,
        safe_balance: 0,
        supplier_payable: 0,
        inventory_value_purchase: 0,
        inventory_value_selling: 0,
      })
    }
    send(res, 200, stats)
  },

  'GET /api/v1/clients': async (req, res, _body, { query }) => {
    if (!requireAuth(req, res)) return
    const limit = Math.min(parseInt(query.limit, 10) || 50, 500)
    const list = await db.getClients(
      query.search,
      query.pinned === 'true',
      limit,
      query.sort || undefined
    )
    const thr = parseFloat((await db.getSetting('client_debt_alert_threshold_egp')) || '5000')
    const debt_alert_threshold_egp = Number.isFinite(thr) ? thr : 5000
    if (req.auth.role === 'staff') {
      const data = list.map((c) => sanitizeClientForStaff(c))
      return send(res, 200, { data, total: data.length, debt_alert_threshold_egp })
    }
    send(res, 200, { data: list, total: list.length, debt_alert_threshold_egp })
  },
  'POST /api/v1/clients': async (req, res, body) => {
    if (!requireAuth(req, res)) return
    const payload = { ...body }
    if (req.auth.role === 'staff') {
      payload.initial_debt = 0
    }
    const row = await db.createClient(payload)
    send(res, 200, req.auth.role === 'staff' ? sanitizeClientForStaff(row) : row)
  },
  'GET /api/v1/clients/:id/account-statement': async (req, res, _body, { pathParts, query }) => {
    if (!requireNotStaff(req, res)) return
    const clientId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(clientId)) return send(res, 400, { message: 'معرف العميل غير صالح' })
    const from = query.from || undefined
    const to = query.to || undefined
    const result = await db.getAccountStatementClient(clientId, from, to)
    if (process.env.NODE_ENV !== 'production') {
      console.log('[account-statement client]', { clientId, from, to, rows: result.rows?.length })
    }
    send(res, 200, result)
  },
  'GET /api/v1/clients/:id/statement': async (req, res, _body, { pathParts, query }) => {
    if (!requireNotStaff(req, res)) return
    const clientId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(clientId)) return send(res, 400, { message: 'معرف العميل غير صالح' })
    const from = query.from || undefined
    const to = query.to || undefined
    const result = await db.getAccountStatementClient(clientId, from, to)
    send(res, 200, result)
  },
  'GET /api/v1/clients/:id/statement-after-cycle': async (req, res, _body, { pathParts, query }) => {
    if (!requireNotStaff(req, res)) return
    const clientId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(clientId)) return send(res, 400, { message: 'معرف العميل غير صالح' })
    const cycleId = parseInt(query.cycle_id, 10)
    if (!Number.isFinite(cycleId)) {
      return send(res, 400, { message: 'معرف الدورة (cycle_id) مطلوب' })
    }
    const result = await db.getAccountStatementAfterCycle(clientId, cycleId)
    if (!result) {
      return send(res, 404, { message: 'الدورة غير موجودة أو لم تُغلق بعد' })
    }
    send(res, 200, result)
  },
  'GET /api/v1/clients/:id/billing-cycles': async (req, res, _body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const clientId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(clientId)) return send(res, 400, { message: 'معرف العميل غير صالح' })
    const c = await db.getClientById(clientId)
    if (!c) return send(res, 404, { message: 'العميل غير موجود' })
    const list = await db.getClientBillingCycles(clientId)
    const open = await db.getOpenBillingCycle(clientId)
    send(res, 200, { data: list, open_cycle_id: open?.id ?? null })
  },
  'POST /api/v1/clients/:id/billing-cycles/start': async (req, res, body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const clientId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(clientId)) return send(res, 400, { message: 'معرف العميل غير صالح' })
    const c = await db.getClientById(clientId)
    if (!c) return send(res, 404, { message: 'العميل غير موجود' })
    try {
      const row = await db.startClientBillingCycle(clientId, {
        started_at: body?.started_at,
        carry_in: body?.carry_in,
      })
      send(res, 200, row)
    } catch (e) {
      send(res, 400, { message: e.message || 'تعذر بدء الدورة' })
    }
  },
  'POST /api/v1/clients/:id/billing-cycles/end': async (req, res, body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const clientId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(clientId)) return send(res, 400, { message: 'معرف العميل غير صالح' })
    const c = await db.getClientById(clientId)
    if (!c) return send(res, 404, { message: 'العميل غير موجود' })
    try {
      const row = await db.endClientBillingCycle(clientId, { ended_at: body?.ended_at })
      send(res, 200, row)
    } catch (e) {
      send(res, 400, { message: e.message || 'تعذر إغلاق الدورة' })
    }
  },
  'GET /api/v1/billing-cycles/:id/account-statement': async (req, res, _body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const cycleId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(cycleId)) return send(res, 400, { message: 'معرف الدورة غير صالح' })
    const result = await db.getAccountStatementForCycle(cycleId)
    if (!result) return send(res, 404, { message: 'الدورة غير موجودة' })
    send(res, 200, result)
  },
  'GET /api/v1/clients/:id': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const c = await db.getClientById(id)
    if (!c) return send(res, 404, { message: 'العميل غير موجود' })
    send(res, 200, req.auth.role === 'staff' ? sanitizeClientForStaff(c) : c)
  },
  'PATCH /api/v1/clients/:id': async (req, res, body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const c = await db.getClientById(id)
    if (!c) return send(res, 404, { message: 'العميل غير موجود' })
    let patch = body
    if (req.auth.role === 'staff') {
      patch = { ...body }
      delete patch.initial_debt
    }
    const row = await db.updateClient(id, patch)
    send(res, 200, req.auth.role === 'staff' ? sanitizeClientForStaff(row) : row)
  },
  'DELETE /api/v1/clients/:id': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const c = await db.getClientById(id)
    if (!c) return send(res, 404, { message: 'العميل غير موجود' })
    await db.deleteClient(id)
    send(res, 204)
  },
  'GET /api/v1/clients/:id/balance': async (req, res, _body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const c = await db.getClientById(id)
    if (!c) return send(res, 404, { message: 'العميل غير موجود' })
    const result = await db.getClientBalance(id)
    send(res, 200, result)
  },
  'GET /api/v1/clients/:id/barns': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const clientId = parseInt(pathParts[1], 10)
    const list = await db.getBarnsByClientId(clientId)
    if (req.auth.role === 'staff') {
      return send(res, 200, list.map((b) => sanitizeBarnForStaff(b)))
    }
    send(res, 200, list)
  },
  'PATCH /api/v1/clients/:id/pin': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const row = await db.toggleClientPin(id)
    if (!row) return send(res, 404, { message: 'العميل غير موجود' })
    send(res, 200, row)
  },
  'PATCH /api/v1/clients/:id/favorite': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const row = await db.toggleClientFavorite(id)
    if (!row) return send(res, 404, { message: 'العميل غير موجود' })
    send(res, 200, row)
  },

  'POST /api/v1/clients/:id/payments': async (req, res, body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const clientId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(clientId)) return send(res, 400, { message: 'معرف العميل غير صالح' })
    const c = await db.getClientById(clientId)
    if (!c) return send(res, 404, { message: 'العميل غير موجود' })
    try {
      const row = await db.createPayment({ ...body, client_id: clientId })
      send(res, 200, row)
    } catch (e) {
      send(res, 400, { message: e?.message || 'تعذر تسجيل الدفعة' })
    }
  },

  'POST /api/v1/clients/:id/barns': async (req, res, body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const clientId = parseInt(pathParts[1], 10)
    const payload = { ...body }
    if (req.auth.role === 'staff') payload.initial_debt = 0
    const row = await db.createBarn(clientId, payload)
    send(res, 200, req.auth.role === 'staff' ? sanitizeBarnForStaff(row) : row)
  },
  'GET /api/v1/barns/:id/account-statement': async (req, res, _body, { pathParts, query }) => {
    if (!requireNotStaff(req, res)) return
    const barnId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(barnId)) return send(res, 400, { message: 'معرف العنبر غير صالح' })
    const from = query.from || undefined
    const to = query.to || undefined
    const result = await db.getAccountStatementBarn(barnId, from, to)
    if (process.env.NODE_ENV !== 'production') {
      console.log('[account-statement barn]', { barnId, from, to, rows: result.rows?.length })
    }
    send(res, 200, result)
  },
  'GET /api/v1/barns/:id/statement': async (req, res, _body, { pathParts, query }) => {
    if (!requireNotStaff(req, res)) return
    const barnId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(barnId)) return send(res, 400, { message: 'معرف العنبر غير صالح' })
    const from = query.from || undefined
    const to = query.to || undefined
    const result = await db.getAccountStatementBarn(barnId, from, to)
    send(res, 200, result)
  },
  'GET /api/v1/barns/:id/billing-cycles': async (req, res, _body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const barnId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(barnId)) return send(res, 400, { message: 'معرف العنبر غير صالح' })
    const b = await db.getBarnById(barnId)
    if (!b) return send(res, 404, { message: 'العنبر غير موجود' })
    const list = await db.getBarnBillingCycles(barnId)
    const open = await db.getOpenBarnBillingCycle(barnId)
    send(res, 200, { data: list, open_cycle_id: open?.id ?? null })
  },
  'POST /api/v1/barns/:id/billing-cycles/start': async (req, res, body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const barnId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(barnId)) return send(res, 400, { message: 'معرف العنبر غير صالح' })
    const b = await db.getBarnById(barnId)
    if (!b) return send(res, 404, { message: 'العنبر غير موجود' })
    try {
      const row = await db.startBarnBillingCycle(barnId, {
        started_at: body?.started_at,
        carry_in: body?.carry_in,
      })
      send(res, 200, row)
    } catch (e) {
      send(res, 400, { message: e.message || 'تعذر بدء الدورة' })
    }
  },
  'POST /api/v1/barns/:id/billing-cycles/end': async (req, res, body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const barnId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(barnId)) return send(res, 400, { message: 'معرف العنبر غير صالح' })
    const b = await db.getBarnById(barnId)
    if (!b) return send(res, 404, { message: 'العنبر غير موجود' })
    try {
      const row = await db.endBarnBillingCycle(barnId, { ended_at: body?.ended_at })
      send(res, 200, row)
    } catch (e) {
      send(res, 400, { message: e.message || 'تعذر إغلاق الدورة' })
    }
  },
  'GET /api/v1/barns/:id/statement-after-cycle': async (req, res, _body, { pathParts, query }) => {
    if (!requireNotStaff(req, res)) return
    const barnId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(barnId)) return send(res, 400, { message: 'معرف العنبر غير صالح' })
    const cycleId = parseInt(query.cycle_id, 10)
    if (!Number.isFinite(cycleId)) {
      return send(res, 400, { message: 'معرف الدورة (cycle_id) مطلوب' })
    }
    const result = await db.getAccountStatementAfterBarnCycle(barnId, cycleId)
    if (!result) {
      return send(res, 404, { message: 'الدورة غير موجودة أو لم تُغلق بعد' })
    }
    send(res, 200, result)
  },
  'GET /api/v1/barn-billing-cycles/:id/account-statement': async (req, res, _body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const cycleId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(cycleId)) return send(res, 400, { message: 'معرف الدورة غير صالح' })
    const result = await db.getAccountStatementForBarnCycle(cycleId)
    if (!result) return send(res, 404, { message: 'الدورة غير موجودة' })
    send(res, 200, result)
  },
  'GET /api/v1/barns/:id': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const b = await db.getBarnById(id)
    if (!b) return send(res, 404, { message: 'العنبر غير موجود' })
    send(res, 200, req.auth.role === 'staff' ? sanitizeBarnForStaff(b) : b)
  },
  'PATCH /api/v1/barns/:id': async (req, res, body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const b = await db.getBarnById(id)
    if (!b) return send(res, 404, { message: 'العنبر غير موجود' })
    let patch = body
    if (req.auth.role === 'staff') {
      patch = { ...body }
      delete patch.initial_debt
    }
    const row = await db.updateBarn(id, patch)
    send(res, 200, req.auth.role === 'staff' ? sanitizeBarnForStaff(row) : row)
  },
  'DELETE /api/v1/barns/:id': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const b = await db.getBarnById(id)
    if (!b) return send(res, 404, { message: 'العنبر غير موجود' })
    await db.deleteBarn(id)
    send(res, 204)
  },

  'GET /api/v1/warehouses': async (req, res) => {
    if (!requireAuth(req, res)) return
    send(res, 200, await db.getWarehouses())
  },
  'GET /api/v1/warehouses/:id/stock-map': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const map = await db.getWarehouseStockMap(id)
    send(res, 200, map)
  },
  'GET /api/v1/warehouses/:id/products-with-stock': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const list = await db.getProductsInWarehouse(id)
    send(res, 200, list)
  },
  'GET /api/v1/warehouses/:id/batches': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const list = await db.getBatchesByWarehouse(id)
    send(res, 200, list)
  },

  'GET /api/v1/categories/options': async (req, res) => {
    if (!requireAuth(req, res)) return
    const names = await db.getCategoryOptions()
    send(res, 200, names)
  },
  'POST /api/v1/categories': async (req, res, body) => {
    if (!requireAuth(req, res)) return
    const row = await db.createCategory(body.name_ar)
    send(res, 200, row)
  },

  'GET /api/v1/products': async (req, res, _body, { query }) => {
    if (!requireAuth(req, res)) return
    const limit = Math.min(parseInt(query.limit, 10) || 100, 500)
    const page = Math.max(1, parseInt(query.page, 10) || 1)
    const offset = (page - 1) * limit
    const widRaw = query.warehouse_id
    const warehouseId =
      widRaw !== undefined && widRaw !== '' && widRaw !== null
        ? parseInt(widRaw, 10)
        : NaN
    const warehouseIdOk = Number.isInteger(warehouseId) ? warehouseId : null
    const lowStock = query.low_stock === 'true' || query.low_stock === '1'
    const unpriced = query.unpriced === 'true' || query.unpriced === '1'
    const expiring = query.expiring === 'true' || query.expiring === '1'
    const list = await db.getProducts(
      query.search,
      query.category,
      limit,
      offset,
      warehouseIdOk,
      lowStock,
      unpriced,
      expiring
    )
    const total = await db.getProductCountFiltered(
      query.search,
      query.category,
      warehouseIdOk,
      lowStock,
      unpriced,
      expiring
    )
    send(res, 200, { data: list, total })
  },
  'POST /api/v1/products': async (req, res, body) => {
    if (!requireAuth(req, res)) return
    const row = await db.createProduct(body)
    send(res, 200, row)
  },
  'GET /api/v1/products/:id': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const p = await db.getProductById(id)
    if (!p) return send(res, 404, { message: 'المنتج غير موجود' })
    send(res, 200, p)
  },
  'PATCH /api/v1/products/:id': async (req, res, body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const p = await db.getProductById(id)
    if (!p) return send(res, 404, { message: 'المنتج غير موجود' })
    const row = await db.updateProduct(id, body)
    send(res, 200, row)
  },
  'DELETE /api/v1/products/:id': async (req, res, _body, { pathParts, query }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const p = await db.getProductById(id)
    if (!p) return send(res, 404, { message: 'المنتج غير موجود' })
    const force = query.force === 'true'
    if (force && req.auth.role !== 'super_admin') {
      return send(res, 403, { message: 'الحذف القسري متاح فقط لمدير النظام', code: 'PRODUCT_FORCE_DELETE_FORBIDDEN' })
    }
    try {
      await db.deleteProductWithPolicy(id, { force })
    } catch (e) {
      if (e?.code === 'PRODUCT_HAS_REFERENCES') {
        return send(res, 409, {
          message: e.message,
          code: e.code,
          can_force: true,
          references: e.references || null,
        })
      }
      throw e
    }
    send(res, 204)
  },
  'GET /api/v1/products/by-barcode': async (req, res, _body, { query }) => {
    if (!requireAuth(req, res)) return
    const p = await db.getProductByBarcode(query.barcode)
    send(res, 200, p || null)
  },
  'GET /api/v1/products/:id/stock': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const productId = parseInt(pathParts[1], 10)
    const list = await db.getProductStock(productId)
    send(res, 200, list)
  },
  'GET /api/v1/products/:id/batches': async (req, res, _body, { pathParts, query }) => {
    if (!requireAuth(req, res)) return
    const productId = parseInt(pathParts[1], 10)
    const warehouseId = query.warehouse_id ? parseInt(query.warehouse_id, 10) : null
    const includeEmpty = query.include_empty === '1' || query.include_empty === 'true'
    const list = await db.getBatchesForProduct(productId, warehouseId, { includeEmpty })
    send(res, 200, list)
  },
  'POST /api/v1/products/:id/batches': async (req, res, body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const productId = parseInt(pathParts[1], 10)
    try {
      const row = await db.createManualProductBatch(productId, body || {})
      send(res, 200, row)
    } catch (e) {
      send(res, 400, { message: e.message || 'Bad request' })
    }
  },
  'POST /api/v1/products/:id/initial-bulk-stock': async (req, res, body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const productId = parseInt(pathParts[1], 10)
    try {
      const row = await db.seedInitialBulkStockForProductWithoutBatches(productId, body || {})
      send(res, 200, row)
    } catch (e) {
      send(res, 400, { message: e.message || 'Bad request' })
    }
  },
  'DELETE /api/v1/products/batches/:batchId': async (req, res, _body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const batchId = parseInt(pathParts[2], 10)
    const result = await db.deleteProductBatch(batchId, req.auth.role)
    if (!result.ok) return send(res, 400, { message: result.error })
    send(res, 204)
  },
  'GET /api/v1/products/:id/bags': async (req, res, _body, { pathParts, query }) => {
    if (!requireAuth(req, res)) return
    const productId = parseInt(pathParts[1], 10)
    const warehouseId = query.warehouse_id ? parseInt(query.warehouse_id, 10) : null
    const list = await db.getBagsForProduct(productId, warehouseId)
    send(res, 200, list)
  },
  'GET /api/v1/bag-instances/:id': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const bagId = parseInt(pathParts[1], 10)
    const row = await db.getBagInstanceById(bagId)
    if (!row) return send(res, 404, { message: 'الشكارة غير موجودة' })
    send(res, 200, row)
  },
  /** Single batch row (e.g. invoice scan when batch is omitted from warehouse list due to zero stock filter). */
  'GET /api/v1/batches/:id': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const batchId = parseInt(pathParts[1], 10)
    if (!Number.isFinite(batchId)) return send(res, 400, { message: 'معرف الدفعة غير صالح' })
    const row = await db.getBatchById(batchId)
    if (!row) return send(res, 404, { message: 'الدفعة غير موجودة' })
    send(res, 200, row)
  },
  'PATCH /api/v1/batches/:id': async (req, res, body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const batchId = parseInt(pathParts[1], 10)
    try {
      const updated = await db.updateProductBatch(batchId, body || {})
      if (!updated) return send(res, 404, { error: 'batch not found' })
      send(res, 200, updated)
    } catch (e) {
      send(res, 400, { message: e.message || 'Bad request' })
    }
  },
  'POST /api/v1/inventory-transfers': async (req, res, body) => {
    if (!requireAuth(req, res)) return
    const fromWh = Number(body.from_warehouse_id)
    const toWh = Number(body.to_warehouse_id)
    if (!Number.isFinite(fromWh) || !Number.isFinite(toWh) || fromWh === toWh) {
      return send(res, 400, { message: 'المخزن المصدر والهدف مطلوبان ويجب أن يكونا مختلفين' })
    }
    const items = Array.isArray(body.items) ? body.items : []
    if (items.length === 0) {
      return send(res, 400, { message: 'أضف صنفاً واحداً على الأقل' })
    }
    try {
      await db.createInventoryTransfer({ from_warehouse_id: fromWh, to_warehouse_id: toWh, items, notes: body.notes })
      send(res, 200, {
        from_warehouse_id: fromWh,
        to_warehouse_id: toWh,
        notes: body.notes ?? null,
        created_at: new Date().toISOString(),
        items_count: items.length,
      })
    } catch (e) {
      send(res, 400, { message: e?.message || 'تعذر تنفيذ التحويل' })
    }
  },
  'GET /api/v1/inventory-transfers': async (req, res, _body, { query }) => {
    if (!requireAuth(req, res)) return
    const limit = Math.min(parseInt(query.limit, 10) || 50, 200)
    const data = await db.getInventoryTransfers(limit)
    send(res, 200, { data })
  },
  'POST /api/v1/products/:id/stock-adjustment': async (req, res, body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const productId = parseInt(pathParts[1], 10)
    await db.upsertProductStock(productId, body.warehouse_id, body.quantity_delta || 0)
    send(res, 204)
  },

  'GET /api/v1/suppliers': async (req, res, _body, { query }) => {
    if (!requireAuth(req, res)) return
    const limit = Math.min(parseInt(query.limit, 10) || 50, 200)
    const list = await db.getSuppliers(query.search, limit, query.sort || undefined)
    if (req.auth.role === 'staff') {
      const data = list.map(({ balance: _b, ...rest }) => rest)
      return send(res, 200, { data, total: data.length })
    }
    send(res, 200, { data: list, total: list.length })
  },
  'POST /api/v1/suppliers': async (req, res, body) => {
    if (!requireNotStaff(req, res)) return
    const row = await db.createSupplier(body)
    send(res, 200, row)
  },
  'GET /api/v1/suppliers/:id': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const s = await db.getSupplierById(id)
    if (!s) return send(res, 404, { message: 'المورد غير موجود' })
    if (req.auth.role === 'staff') {
      const { balance: _b, ...rest } = s
      return send(res, 200, rest)
    }
    send(res, 200, s)
  },
  'PATCH /api/v1/suppliers/:id': async (req, res, body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const s = await db.getSupplierById(id)
    if (!s) return send(res, 404, { message: 'المورد غير موجود' })
    const row = await db.updateSupplier(id, body)
    send(res, 200, row)
  },
  'DELETE /api/v1/suppliers/:id': async (req, res, _body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const s = await db.getSupplierById(id)
    if (!s) return send(res, 404, { message: 'المورد غير موجود' })
    await db.deleteSupplier(id)
    send(res, 204)
  },
  'GET /api/v1/suppliers/:id/balance': async (req, res, _body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const balance = await db.getSupplierBalance(id)
    send(res, 200, { balance })
  },
  'GET /api/v1/suppliers/:id/purchases': async (req, res, _body, { pathParts, query }) => {
    if (!requireNotStaff(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const limit = Math.min(parseInt(query.limit, 10) || 10, 100)
    const list = await db.getSupplierPurchases(id, limit)
    send(res, 200, { data: list, total: list.length })
  },
  'GET /api/v1/suppliers/:id/purchases-with-items': async (req, res, _body, { pathParts, query }) => {
    if (!requireNotStaff(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const limit = Math.min(parseInt(query.limit, 10) || 10, 100)
    const list = await db.getSupplierPurchasesWithItems(id, limit)
    send(res, 200, { data: list, total: list.length })
  },
  'GET /api/v1/suppliers/:id/payments': async (req, res, _body, { pathParts, query }) => {
    if (!requireNotStaff(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const limit = Math.min(parseInt(query.limit, 10) || 10, 100)
    const list = await db.getSupplierPayments(id, limit)
    send(res, 200, { data: list, total: list.length })
  },

  'POST /api/v1/supplier-purchases': async (req, res, body) => {
    if (!requireNotStaff(req, res)) return
    const row = await db.createSupplierPurchase(body)
    send(res, 200, row)
  },
  'GET /api/v1/supplier-purchases/:id': async (req, res, _body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const p = await db.getSupplierPurchaseById(id)
    if (!p) return send(res, 404, { message: 'الفاتورة غير موجودة' })
    send(res, 200, p)
  },
  'POST /api/v1/supplier-receipts': async (req, res, body) => {
    if (!requireAuth(req, res)) return
    const row = await db.createSupplierReceipt(body)
    send(res, 200, [row])
  },
  'POST /api/v1/supplier-payments': async (req, res, body) => {
    if (!requireNotStaff(req, res)) return
    const row = await db.createSupplierPayment(body)
    send(res, 200, row)
  },

  'GET /api/v1/invoices': async (req, res, _body, { query }) => {
    if (!requireAuth(req, res)) return
    const limit = Math.min(parseInt(query.limit, 10) || 50, 200)
    const unpaidOnly = query.unpaid === '1' || query.unpaid === 'true'
    const warehouseId = query.warehouse_id != null && query.warehouse_id !== '' ? parseInt(query.warehouse_id, 10) : undefined
    const list = await db.getInvoices({
      limit,
      payment_method: query.payment_method || undefined,
      warehouse_id: Number.isFinite(warehouseId) ? warehouseId : undefined,
      client_id: query.client_id ? parseInt(query.client_id, 10) : undefined,
      barn_id: query.barn_id ? parseInt(query.barn_id, 10) : undefined,
      from: query.from || undefined,
      to: query.to || undefined,
      unpaid_only: unpaidOnly,
    })
    if (req.auth.role === 'staff') {
      const data = list.map((inv) => sanitizeInvoiceForStaff(inv))
      return send(res, 200, { data, total: data.length })
    }
    send(res, 200, { data: list, total: list.length })
  },
  'POST /api/v1/invoices': async (req, res, body) => {
    if (!requireAuth(req, res)) return
    const row = await db.createInvoice(body)
    send(res, 200, req.auth.role === 'staff' ? sanitizeInvoiceForStaff(row) : row)
  },
  'GET /api/v1/invoices/:id': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const inv = await db.getInvoiceById(id)
    if (!inv) return send(res, 404, { message: 'الفاتورة غير موجودة' })
    const withMeta = await attachInvoiceEditMeta(inv, req.auth.role)
    send(res, 200, req.auth.role === 'staff' ? sanitizeInvoiceForStaff(withMeta) : withMeta)
  },
  'PATCH /api/v1/invoices/:id': async (req, res, body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const inv = await db.getInvoiceById(id)
    if (!inv) return send(res, 404, { message: 'الفاتورة غير موجودة' })
    try {
      if (body && body.invoice_lifecycle === 'cancelled') {
        if (!requireNotStaff(req, res)) return
        const row = await db.cancelInvoice(id)
        const withMeta = await attachInvoiceEditMeta(row, req.auth.role)
        send(res, 200, req.auth.role === 'staff' ? sanitizeInvoiceForStaff(withMeta) : withMeta)
        return
      }
      if (body && Array.isArray(body.items)) {
        try {
          await db.assertInvoiceReplaceAllowed(id, req.auth.role)
        } catch (e) {
          if (e.code === 'INVOICE_EDIT_WINDOW_EXPIRED') {
            return send(res, 403, {
              error: 'invoice_edit_window_expired',
              message: 'انتهت مدة تعديل هذه الفاتورة',
              edit_window_days: e.edit_window_days,
              invoice_age_days: e.invoice_age_days,
            })
          }
          if (e.code === 'NOT_FOUND') {
            return send(res, 404, { message: e.message })
          }
          throw e
        }
        const { edit_override_reason: overrideReason, ...replaceBody } = body
        const row = await db.replaceInvoice(id, replaceBody)
        const st = await db.getInvoiceEditWindowStatus(id)
        if (req.auth.role === 'super_admin' && st && !st.withinWindow) {
          const uid = parseInt(req.auth.sub, 10)
          await db.recordInvoiceEditOverride(
            id,
            uid,
            overrideReason != null && String(overrideReason).trim() !== ''
              ? String(overrideReason)
              : 'super_admin_outside_edit_window'
          )
        }
        const withMeta = await attachInvoiceEditMeta(row, req.auth.role)
        send(res, 200, req.auth.role === 'staff' ? sanitizeInvoiceForStaff(withMeta) : withMeta)
        return
      }
      const row = await db.updateInvoice(id, body)
      const withMeta = await attachInvoiceEditMeta(row, req.auth.role)
      send(res, 200, req.auth.role === 'staff' ? sanitizeInvoiceForStaff(withMeta) : withMeta)
    } catch (e) {
      send(res, 400, { message: e?.message || 'تعذر تحديث الفاتورة' })
    }
  },
  'DELETE /api/v1/invoices/:id/items/:itemId': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const invoiceId = parseInt(pathParts[1], 10)
    const itemId = parseInt(pathParts[3], 10)
    try {
      const row = await db.deleteInvoiceItem(invoiceId, itemId)
      const withMeta = await attachInvoiceEditMeta(row, req.auth.role)
      send(res, 200, req.auth.role === 'staff' ? sanitizeInvoiceForStaff(withMeta) : withMeta)
    } catch (e) {
      send(res, 400, { message: e?.message || 'تعذر إزالة الصنف' })
    }
  },
  'POST /api/v1/invoices/:id/items/:itemId/return': async (req, res, body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const invoiceId = parseInt(pathParts[1], 10)
    const itemId = parseInt(pathParts[3], 10)
    const returned = body?.returned_quantity ?? body?.quantity
    try {
      const row = await db.returnPartialInvoiceItem(invoiceId, itemId, returned, body?.notes ?? null)
      const withMeta = await attachInvoiceEditMeta(row, req.auth.role)
      send(res, 200, req.auth.role === 'staff' ? sanitizeInvoiceForStaff(withMeta) : withMeta)
    } catch (e) {
      send(res, 400, { message: e?.message || 'تعذر تسجيل الإرجاع' })
    }
  },
  'DELETE /api/v1/invoices/:id': async (req, res, _body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const inv = await db.getInvoiceById(id)
    if (!inv) return send(res, 404, { message: 'الفاتورة غير موجودة' })
    try {
      const row = await db.cancelInvoice(id)
      const withMeta = await attachInvoiceEditMeta(row, req.auth.role)
      send(res, 200, withMeta)
    } catch (e) {
      send(res, 400, { message: e?.message || 'تعذر إلغاء الفاتورة' })
    }
  },

  'GET /api/v1/payments/:id': async (req, res, _body, { pathParts }) => {
    if (!requireAuth(req, res)) return
    const id = parseInt(pathParts[1], 10)
    const row = await db.getPaymentById(id)
    if (!row) return send(res, 404, { message: 'الدفعة غير موجودة' })
    send(res, 200, row)
  },
  'GET /api/v1/payments': async (req, res, _body, { query }) => {
    if (!requireAuth(req, res)) return
    const limit = Math.min(parseInt(query.limit, 10) || 50, 200)
    const list = await db.getPayments(limit)
    send(res, 200, { data: list, total: list.length })
  },
  'POST /api/v1/payments': async (req, res, body) => {
    if (!requireNotStaff(req, res)) return
    try {
      const row = await db.createPayment(body)
      send(res, 200, row)
    } catch (e) {
      send(res, 400, { message: e?.message || 'تعذر تسجيل الدفعة' })
    }
  },

  'GET /api/v1/safe/balance': async (req, res) => {
    if (!requireNotStaff(req, res)) return
    const balance = await db.getSafeBalance()
    send(res, 200, { balance })
  },
  'GET /api/v1/safe/transactions': async (req, res, _body, { query }) => {
    if (!requireNotStaff(req, res)) return
    const limit = Math.min(parseInt(query.limit, 10) || 50, 100)
    const list = await db.getSafeTransactions(limit)
    send(res, 200, { data: list, total: list.length })
  },
  'POST /api/v1/safe/initial': async (req, res, body) => {
    if (!requireNotStaff(req, res)) return
    await db.createSafeInitial(body)
    send(res, 204)
  },
  'POST /api/v1/safe/adjustment': async (req, res, body) => {
    if (!requireNotStaff(req, res)) return
    await db.createSafeAdjustment(body)
    send(res, 204)
  },
  'DELETE /api/v1/safe/transactions/:id': async (req, res, _body, { pathParts }) => {
    if (!requireNotStaff(req, res)) return
    const id = parseInt(pathParts[2], 10)
    try {
      const ok = await db.deleteSafeTransaction(id)
      if (!ok) return send(res, 404, { message: 'الحركة غير موجودة' })
      send(res, 204)
    } catch (e) {
      send(res, 400, { message: e.message || 'لا يمكن حذف هذه الحركة' })
    }
  },
  'POST /api/v1/safe/clear-history': async (req, res) => {
    if (!requireNotStaff(req, res)) return
    const deleted = await db.clearDeletableSafeTransactions()
    send(res, 200, { deleted })
  },

  'GET /api/v1/reports/by-category': async (req, res, _body, { query }) => {
    if (!requireNotStaff(req, res)) return
    const from = query.from || undefined
    const to = query.to || undefined
    const rows = await db.getSalesByCategory(from, to)
    send(res, 200, { data: rows, total: rows.length })
  },
  'GET /api/v1/reports/top-products': async (req, res, _body, { query }) => {
    if (!requireNotStaff(req, res)) return
    const from = query.from || undefined
    const to = query.to || undefined
    const limit = query.limit ? parseInt(query.limit, 10) : 10
    const whRaw = query.warehouse_id
    const warehouseId =
      whRaw != null && whRaw !== '' ? parseInt(String(whRaw), 10) : null
    const rows = await db.getTopProducts(
      from,
      to,
      limit,
      Number.isFinite(warehouseId) ? warehouseId : null
    )
    send(res, 200, { data: rows, total: rows.length })
  },
  'GET /api/v1/reports/sales-by-day': async (req, res, _body, { query }) => {
    if (!requireNotStaff(req, res)) return
    const from = query.from || undefined
    const to = query.to || undefined
    let rows
    if (from && to) {
      rows = await db.getDailyInvoiceTotalsForRange(from, to)
    } else {
      const days = Math.min(Math.max(parseInt(query.days, 10) || 30, 1), 90)
      rows = await db.getDailyInvoiceTotals(days)
    }
    send(res, 200, { data: rows, total: rows.length })
  },

  'GET /api/v1/account-statement/client/:id': async (req, res, _body, { pathParts, query }) => {
    if (!requireNotStaff(req, res)) return
    const ci = pathParts.indexOf('client')
    const clientId = ci >= 0 ? parseInt(pathParts[ci + 1], 10) : NaN
    if (!Number.isFinite(clientId)) return send(res, 400, { message: 'معرف العميل غير صالح' })
    const from = query.from || undefined
    const to = query.to || undefined
    const result = await db.getAccountStatementClient(clientId, from, to)
    if (process.env.NODE_ENV !== 'production') {
      console.log('[account-statement client]', { clientId, from, to, rows: result.rows?.length })
    }
    send(res, 200, result)
  },
  'GET /api/v1/account-statement/barn/:id': async (req, res, _body, { pathParts, query }) => {
    if (!requireNotStaff(req, res)) return
    const bi = pathParts.indexOf('barn')
    const barnId = bi >= 0 ? parseInt(pathParts[bi + 1], 10) : NaN
    if (!Number.isFinite(barnId)) return send(res, 400, { message: 'معرف العنبر غير صالح' })
    const from = query.from || undefined
    const to = query.to || undefined
    const result = await db.getAccountStatementBarn(barnId, from, to)
    if (process.env.NODE_ENV !== 'production') {
      console.log('[account-statement barn]', { barnId, from, to, rows: result.rows?.length })
    }
    send(res, 200, result)
  },
  'GET /api/v1/settings': async (req, res) => {
    if (!requireNotStaff(req, res)) return
    send(res, 200, await db.getAllSettings())
  },
  'PATCH /api/v1/settings': async (req, res, body) => {
    if (!requireNotStaff(req, res)) return
    if (body && typeof body === 'object') {
      for (const [k, v] of Object.entries(body)) {
        if (k === 'invoice_edit_window_days') {
          const n = parseInt(String(v), 10)
          if (!Number.isFinite(n) || n < 1 || n > 365) {
            return send(res, 400, {
              message: 'مدة تعديل الفاتورة يجب أن تكون رقماً صحيحاً بين 1 و 365',
            })
          }
          await db.setSetting(k, String(n))
        } else {
          await db.setSetting(k, v)
        }
      }
    }
    send(res, 200, await db.getAllSettings())
  },
}

function routeKey(method, path) {
  const base = '/api/v1'
  const rest = stripApiV1Prefix(path)
  const parts = rest.split('/').filter(Boolean)
  if (parts.length === 0) return `${method} ${base}`
  if (parts[0] === 'clients' && parts.length === 3 && parts[2] === 'account-statement') {
    return `${method} ${base}/clients/:id/account-statement`
  }
  if (parts[0] === 'clients' && parts.length === 3 && parts[2] === 'statement') {
    return `${method} ${base}/clients/:id/statement`
  }
  if (parts[0] === 'clients' && parts.length === 3 && parts[2] === 'statement-after-cycle') {
    return `${method} ${base}/clients/:id/statement-after-cycle`
  }
  if (parts[0] === 'clients' && parts.length === 4 && parts[2] === 'billing-cycles' && parts[3] === 'start') {
    return `${method} ${base}/clients/:id/billing-cycles/start`
  }
  if (parts[0] === 'clients' && parts.length === 4 && parts[2] === 'billing-cycles' && parts[3] === 'end') {
    return `${method} ${base}/clients/:id/billing-cycles/end`
  }
  if (parts[0] === 'clients' && parts.length === 3 && parts[2] === 'billing-cycles') {
    return `${method} ${base}/clients/:id/billing-cycles`
  }
  if (parts[0] === 'billing-cycles' && parts.length === 3 && parts[2] === 'account-statement') {
    return `${method} ${base}/billing-cycles/:id/account-statement`
  }
  if (parts[0] === 'barn-billing-cycles' && parts.length === 3 && parts[2] === 'account-statement') {
    return `${method} ${base}/barn-billing-cycles/:id/account-statement`
  }
  if (parts[0] === 'barns' && parts.length === 3 && parts[2] === 'statement-after-cycle') {
    return `${method} ${base}/barns/:id/statement-after-cycle`
  }
  if (parts[0] === 'barns' && parts.length === 4 && parts[2] === 'billing-cycles' && parts[3] === 'start') {
    return `${method} ${base}/barns/:id/billing-cycles/start`
  }
  if (parts[0] === 'barns' && parts.length === 4 && parts[2] === 'billing-cycles' && parts[3] === 'end') {
    return `${method} ${base}/barns/:id/billing-cycles/end`
  }
  if (parts[0] === 'barns' && parts.length === 3 && parts[2] === 'billing-cycles') {
    return `${method} ${base}/barns/:id/billing-cycles`
  }
  if (parts[0] === 'clients' && parts.length >= 2) {
    if (parts[2] === 'balance' || parts[2] === 'barns' || parts[2] === 'pin' || parts[2] === 'favorite') return `${method} ${base}/clients/:id/${parts[2] || ''}`
    if (parts[2] === 'barns') return `${method} ${base}/clients/:id/barns`
    return `${method} ${base}/clients/:id`
  }
  if (parts[0] === 'clients' && parts[1] === undefined) return `${method} ${base}/clients`
  if (parts[0] === 'barns' && parts.length === 3 && parts[2] === 'account-statement') {
    return `${method} ${base}/barns/:id/account-statement`
  }
  if (parts[0] === 'barns' && parts.length === 3 && parts[2] === 'statement') {
    return `${method} ${base}/barns/:id/statement`
  }
  if (parts[0] === 'settings') return `${method} ${base}/settings`
  if (parts[0] === 'bag-instances' && parts[1]) return `${method} ${base}/bag-instances/:id`
  if (parts[0] === 'batches' && parts[1]) return `${method} ${base}/batches/:id`
  if (parts[0] === 'barns' && parts.length >= 2) return `${method} ${base}/barns/:id`
  if (parts[0] === 'warehouses' && parts.length >= 3) {
    if (parts[2] === 'stock-map') return `${method} ${base}/warehouses/:id/stock-map`
    if (parts[2] === 'products-with-stock') return `${method} ${base}/warehouses/:id/products-with-stock`
    if (parts[2] === 'batches') return `${method} ${base}/warehouses/:id/batches`
  }
  if (parts[0] === 'warehouses') return `${method} ${base}/warehouses`
  if (parts[0] === 'categories') {
    if (parts[1] === 'options') return `${method} ${base}/categories/options`
    return `${method} ${base}/categories`
  }
  if (parts[0] === 'products' && parts[1] === 'batches' && parts[2]) {
    return `${method} ${base}/products/batches/:batchId`
  }
  if (parts[0] === 'products') {
    if (parts[1] === 'by-barcode') return `${method} ${base}/products/by-barcode`
    if (
      parts[2] === 'stock' ||
      parts[2] === 'stock-adjustment' ||
      parts[2] === 'batches' ||
      parts[2] === 'bags' ||
      parts[2] === 'initial-bulk-stock'
    ) {
      return `${method} ${base}/products/:id/${parts[2]}`
    }
    if (parts[1]) return `${method} ${base}/products/:id`
    return `${method} ${base}/products`
  }
  if (parts[0] === 'suppliers' && parts.length >= 2) {
    if (parts[2] === 'balance') return `${method} ${base}/suppliers/:id/balance`
    if ((parts[2] === 'purchases' && parts[3] === 'with-items') || parts[2] === 'purchases-with-items') {
      return `${method} ${base}/suppliers/:id/purchases-with-items`
    }
    if (parts[2] === 'purchases') return `${method} ${base}/suppliers/:id/purchases`
    if (parts[2] === 'payments') return `${method} ${base}/suppliers/:id/payments`
    return `${method} ${base}/suppliers/:id`
  }
  if (parts[0] === 'suppliers') return `${method} ${base}/suppliers`
  if (parts[0] === 'supplier-purchases' && parts[1]) return `${method} ${base}/supplier-purchases/:id`
  if (parts[0] === 'inventory-transfers') return `${method} ${base}/inventory-transfers`
  if (parts[0] === 'invoices' && parts.length === 5 && parts[2] === 'items' && parts[4] === 'return') {
    return `${method} ${base}/invoices/:id/items/:itemId/return`
  }
  if (parts[0] === 'invoices' && parts.length === 4 && parts[2] === 'items') {
    return `${method} ${base}/invoices/:id/items/:itemId`
  }
  if (parts[0] === 'invoices' && parts[1]) return `${method} ${base}/invoices/:id`
  if (parts[0] === 'invoices') return `${method} ${base}/invoices`
  if (parts[0] === 'payments' && parts[1]) return `${method} ${base}/payments/:id`
  if (parts[0] === 'payments') return `${method} ${base}/payments`
  if (parts[0] === 'safe') {
    if (parts[1] === 'clear-history') return `${method} ${base}/safe/clear-history`
    if (parts[1] === 'transactions' && parts[2]) return `${method} ${base}/safe/transactions/:id`
    if (parts[1] === 'balance') return `${method} ${base}/safe/balance`
    if (parts[1] === 'transactions') return `${method} ${base}/safe/transactions`
    if (parts[1] === 'initial') return `${method} ${base}/safe/initial`
    if (parts[1] === 'adjustment') return `${method} ${base}/safe/adjustment`
    return `${method} ${base}/safe/transactions`
  }
  if (parts[0] === 'reports') {
    if (parts[1] === 'by-category') return `${method} ${base}/reports/by-category`
    if (parts[1] === 'top-products') return `${method} ${base}/reports/top-products`
    if (parts[1] === 'sales-by-day') return `${method} ${base}/reports/sales-by-day`
  }
  if (parts[0] === 'account-statement' && parts[1] === 'client') return `${method} ${base}/account-statement/client/:id`
  if (parts[0] === 'account-statement' && parts[1] === 'barn') return `${method} ${base}/account-statement/barn/:id`
  if (parts[0] === 'users' && parts[1]) return `${method} ${base}/users/:id`
  if (parts[0] === 'users') return `${method} ${base}/users`
  return `${method} ${path.split('?')[0]}`
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', corsAllowOrigin(req))
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const { path, pathParts, query } = parseUrl(req)
  const key = routeKey(req.method, path)
  const handler = handlers[key]
  let body
  try { body = await parseBody(req) } catch (_) { body = {} }

  if (handler) {
    try {
      await handler(req, res, body, { pathParts, query })
    } catch (e) {
      send(res, 500, { message: e.message || 'Internal error' })
    }
  } else if (
    process.env.NODE_ENV === 'production' &&
    !path.startsWith('/api') &&
    (req.method === 'GET' || req.method === 'HEAD')
  ) {
    serveProductionStatic(req, res, path)
  } else {
    send(res, 404, { message: 'Not found', key })
  }
})

server.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`)
  console.log(`Database: ${db.dbPath}`)
  console.log('Auth: users in DB; first visit /login creates super_admin if no users exist')
})
