/** Thermal receipt roll width (58mm is standard for ESC/POS / pharmacy printers). */
export const RECEIPT_WIDTH_MM = 58

/** Inner padding for receipt content (keep away from physical roll edges). */
export const RECEIPT_MARGIN_MM = 2

/**
 * Extra padding on the inline-start edge (physical right under RTL) — many thermal
 * printers clip that margin; this keeps Arabic line starts visible.
 */
export const RECEIPT_EXTRA_INLINE_START_MM = 1.5

/** Fallback page length when the engine does not support `size: … auto` (long receipts may span pages). */
export const RECEIPT_PAGE_HEIGHT_MM = 297
