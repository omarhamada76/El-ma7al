# Phase 19 — Bulk Product Full Flow (شكاير)

Implementation prompt for: grams, initial stock, active bag tracking, supplier receiving, invoicing, auto-open, and alerts.

---

## Mental model (full picture)

### Product creation (first time)

When you create a bulk product you need to set:

- كم كيلو في الشكارة (e.g. 25kg)
- كم شكارة عندك الآن في كل مخزن (initial stock)
- which شكارة is currently open + كم كيلو اتأكل منها

### Receiving from suppliers

- تدخل عدد الشكاير اللي استلمتها
- سعر الكيلو شراءً وبيعاً
- تاريخ الصلاحية
- النظام يحسب: عدد الشكاير × كيلو/شكارة = إجمالي الكيلوات

### Selling (invoice)

- تدخل الكمية بالجرام أو الكيلو
- النظام يحول ويحسب السعر
- يخصم من الشكارة المفتوحة
- لو خلصت يفتح الجاية تلقائياً

---

## PHASE 19 — Bulk Product Full Flow (شكاير): Grams, Initial Stock, Active Bag Tracking

### PHASE 19A — Product creation: initial stock entry

When creating a new product with `unit_type = 'bulk'`, after the user sets `kg_per_bag`, show an initial stock section:

**Per warehouse (show a row for each active warehouse):**

| المخزن | عدد الشكاير | الشكارة المفتوحة | كيلو متبقي في المفتوحة |
|--------|------------|-----------------|----------------------|
| اجهور  | [  4  ]    | [● نعم ○ لا]    | [  18.5  ] كيلو      |
| شبرا   | [  2  ]    | [● نعم ○ لا]    | [  25.0  ] كيلو      |

Rules:

- If `bag_count > 0` for a warehouse → ask if there is currently an open bag for that warehouse
- If "نعم" (open bag exists) → show `kg_remaining` input for it (max = `kg_per_bag`, default = `kg_per_bag` meaning full/untouched)
- If "لا" → system will auto-open the first sealed bag on first sale
- `kg_remaining` cannot exceed `kg_per_bag`

On save, for each warehouse with `bag_count > 0`:

1. Create **one** `product_batches` record:
   - `purchase_price` = entered price (or 0 if not entered at creation, to be set on first supplier purchase)
   - `selling_price` = entered selling price
   - `bag_count` = entered count
   - `kg_per_bag` = from product
   - `kg_remaining` = `(bag_count - 1) * kg_per_bag + open_bag_kg_remaining` (if open bag exists) **or** `bag_count * kg_per_bag` (if no open bag yet)

2. Create `bag_instances`:
   - If open bag exists:
     - bag 1: `status='open'`, `kg_remaining` = entered kg_remaining
     - bags 2..N: `status='sealed'`, `kg_remaining` = `kg_per_bag`
   - If no open bag:
     - bags 1..N: `status='sealed'`, `kg_remaining` = `kg_per_bag`
     - system will open bag 1 on first sale (FEFO)

3. Update `product_warehouse_stock`:
   - `quantity` = total `kg_remaining` across all bags in this warehouse

---

### PHASE 19B — Supplier purchase: receiving شكاير

On the supplier purchase form for a bulk product, show:

```text
┌─────────────────────────────────────────┐
│  المنتج: [اسم المنتج]   نوع: بالكيلو   │
│                                         │
│  المخزن:        [اجهور ▼]               │
│  عدد الشكاير:   [  10  ]               │
│  كيلو/شكارة:    [  25  ] ← from product │
│  إجمالي الكيلو: 250 كيلو ← calculated  │
│                                         │
│  سعر شراء الكيلو:  [    ] ج.م          │
│  سعر بيع الكيلو:   [    ] ج.م          │
│  تاريخ الصلاحية:   [    ]              │
│                                         │
│  إجمالي تكلفة الدفعة: X ج.م           │
│  (عدد الشكاير × كيلو/شكارة × سعر الشراء)│
└─────────────────────────────────────────┘
```

- "إجمالي الكيلو" is calculated live: `bag_count × kg_per_bag`
- "إجمالي تكلفة الدفعة" calculated live: `total_kg × purchase_price`
- `kg_per_bag` is pre-filled from `product.bag_weight_kg` but editable (this batch might have slightly different bag weight)
- On save → batch upsert + create `bag_instances` (all sealed) + auto-open nearest expiry bag if no open bag exists for this product+warehouse

---

### PHASE 19C — Unit of measure: grams support on invoice

When adding a bulk product to an invoice, the quantity input supports both grams and kilos:

```text
┌─────────────────────────────────────┐
│  مونوبيوترين                        │
│                                     │
│  الكمية:  [  500  ]  [كيلو ▼]      │
│                       ├── كيلو      │
│                       └── جرام      │
│                                     │
│  = 0.5 كيلو                        │
│  السعر:  ٥٠ ج.م/كيلو               │
│  الإجمالي: ٢٥.٠٠ ج.م ← live calc  │
└─────────────────────────────────────┘
```

**Conversion logic:**

```javascript
function toKilos(value, unit) {
  if (unit === 'gram') return value / 1000;
  return value; // already kilos
}

function calculateLineTotal(value, unit, pricePerKg) {
  const kg = toKilos(value, unit);
  return kg * pricePerKg;
}
```

**Minimum quantity validation:**

- If unit = gram → minimum 1 gram (0.001 kg)
- Show error if entered grams > (open bag `kg_remaining × 1000`):
  "الكمية المطلوبة تتجاوز المتاح في الشكارة المفتوحة (متاح: X كيلو = Y جرام)"

**`invoice_items` storage:**

- Always store `quantity` in **kilos** (decimal) regardless of input unit
- Store original input for display:

```sql
ALTER TABLE invoice_items ADD COLUMN display_quantity REAL;
ALTER TABLE invoice_items ADD COLUMN display_unit TEXT DEFAULT 'kg';
-- display_unit: 'kg' | 'gram'
```

- On invoice view/print: show original input unit e.g. "500 جرام" not "0.5 كيلو" if that's what was entered

---

### PHASE 19D — Active bag tracking display

On the product detail page for bulk products, show a **"الشكارة الحالية"** status card prominently at the top:

```text
┌─────────────────────────────────────────┐
│  🟢 الشكارة المفتوحة — اجهور            │
│                                         │
│  متبقي:  ████████░░░░  18.5 كيلو       │
│          (74% من 25 كيلو)               │
│                                         │
│  الصلاحية: 2027-03-23                  │
│  الدفعة:   #7                           │
│                                         │
│  في الانتظار: 3 شكاير مغلقة            │
│  إجمالي المخزون: 93.5 كيلو             │
└─────────────────────────────────────────┘
```

Progress bar: `kg_remaining / kg_per_bag` as percentage.

Color:

- \> 50% → green
- 20–50% → amber
- \< 20% → red (low stock warning)

If multiple warehouses have stock → show one card per warehouse.

---

### PHASE 19E — Auto-open next bag logic

When a sale causes an open bag's `kg_remaining` to reach 0:

```javascript
async function autoOpenNextBag(productId, warehouseId, db) {
  // Mark current open bag as empty
  await db.run(
    `UPDATE bag_instances SET status = 'empty'
     WHERE product_id = ? AND warehouse_id = ? AND status = 'open'`,
    [productId, warehouseId]
  );

  // Find next sealed bag (FEFO — nearest expiry first)
  const nextBag = await db.get(
    `SELECT * FROM bag_instances
     WHERE product_id = ? AND warehouse_id = ? AND status = 'sealed'
     ORDER BY expiry_date ASC NULLS LAST, id ASC
     LIMIT 1`,
    [productId, warehouseId]
  );

  if (nextBag) {
    await db.run(
      `UPDATE bag_instances
       SET status = 'open', opened_at = datetime('now')
       WHERE id = ?`,
      [nextBag.id]
    );
    // Notify frontend
    return { opened: true, bag: nextBag };
  } else {
    // No more bags — trigger low stock alert
    await createStockAlert(productId, warehouseId, 'out_of_stock', db);
    return { opened: false };
  }
}
```

**Frontend notification after auto-open:**

Show a toast on the invoice screen:

"تم فتح شكارة جديدة تلقائياً — [اسم المنتج] الصلاحية: YYYY-MM-DD | المخزن: اجهور"

If no more bags:

"⚠️ تنبيه: لا يوجد مخزون متبقي من [اسم المنتج] في اجهور"

---

### PHASE 19F — Low stock alert for bulk products

The existing low_stock alert system uses `alert_level` (unit count). For bulk products, add `alert_level_kg`:

```sql
ALTER TABLE products ADD COLUMN alert_level_kg REAL;
-- e.g. 50.0 → alert when total kg_remaining < 50kg
```

On the product form for bulk products, replace "مستوى التنبيه (وحدات)" with "مستوى التنبيه (كيلو)".

Dashboard low stock check for bulk:

```sql
SELECT p.*, SUM(bi.kg_remaining) as total_kg
FROM products p
JOIN bag_instances bi ON bi.product_id = p.id
WHERE p.unit_type = 'bulk'
AND bi.status != 'empty'
GROUP BY p.id
HAVING total_kg < p.alert_level_kg
```

---

### PHASE 19G — Inventory list display for bulk

In the products table, bulk products show:

| المنتج | الفئة | سعر الكيلو | المخزون | |
|--------|-------|-----------|---------|---|
| اسم المنتج | فئة | ٤٨ — ٥٠ ج.م/كيلو | 93.5 كيلو (4 شكاير) | تفاصيل |

Format: `{total_kg} كيلو ({sealed_count + 1} شكاير)` where the +1 accounts for the open bag.

If `kg_remaining` on the open bag \< 20% of `kg_per_bag` → add amber badge: "الشكارة المفتوحة على وشك الانتهاء"

---

### Constraints

- All invoice quantity storage is in **kilos** (decimal, 3 decimal places precision to support grams: 0.001 = 1 gram)
- `display_quantity` + `display_unit` on `invoice_items` for showing original input to user
- `kg_per_bag` on `bag_instances` can differ from `product.bag_weight_kg` (some deliveries may have slightly different weights — store actual)
- Auto-open logic runs inside the invoice save DB transaction — either the sale **and** the bag open both succeed or neither does
- Initial stock entry at product creation bypasses supplier purchase flow but still creates proper `batch` + `bag_instance` records
- If `product.bag_weight_kg` is updated after batches exist → only affects **new** batches; existing `bag_instances` keep their original `kg_per_bag` value

---

## الخلاصة

- **إنشاء المنتج** → تحدد كم شكارة عندك دلوقتي في كل مخزن + هل في شكارة مفتوحة وكم كيلو باقي فيها
- **الاستلام من الموردين** → تدخل عدد الشكاير فقط، النظام يحسب الكيلوات تلقائياً
- **البيع** → تقدر تدخل جرام أو كيلو، النظام يحوّل ويحسب السعر لحظياً
- **الشكارة المفتوحة** → بيعرف إيه اللي مفتوح ودايماً بيحسب المتبقي مع progress bar
- **فتح شكارة جديدة** → أوتوماتيك لما المفتوحة تخلص مع إشعار فوري
- **التنبيهات** → بالكيلو مش بالوحدات للمنتجات الثقيلة
