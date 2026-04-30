---
name: Calibrate Horizontal Center
overview: Add printer-specific horizontal calibration by shifting label content 2.0mm left in print-only layout while preserving current size/readability settings.
todos:
  - id: add-horizontal-left-shift
    content: Apply a print-only 2.0mm left calibration offset
    status: pending
  - id: preserve-current-sizing
    content: Keep barcode width/height and expiry readability settings unchanged
    status: pending
  - id: check-visibility-after-shift
    content: Validate no clipping after horizontal shift
    status: pending
  - id: lint-check-label-component
    content: Run diagnostics for ProductLabelPrint.tsx
    status: pending
isProject: false
---

# Calibrate horizontal centering

## Goal
Fix persistent right-side bias in printed labels by applying a print-only left shift so left and right white space are visually equal on your XP-370B output.

## File to update
- [ProductLabelPrint.tsx](/Users/omarmahmoud/Developer/web-dashboard/src/components/ProductLabelPrint.tsx)

## Implementation steps
1. Add an explicit print calibration offset for horizontal positioning in `.label-print-page` (or equivalent print container) using a `-2.0mm` X-axis shift.
2. Keep current barcode size and expiry readability settings unchanged.
3. Preserve existing vertical offset behavior so only horizontal centering is adjusted.
4. Ensure the shift is print-only and does not affect screen preview.
5. Verify lint diagnostics for the touched file.

## Verification
- Print preview/test print shows equal left/right spacing by eye.
- Barcode/date remain fully visible (no clipping).
- `ReadLints` reports no errors for the updated file.