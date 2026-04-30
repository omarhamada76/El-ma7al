# Module 6 — Manual QA Checklist

## 1. Arabic invoice PDF — RTL layout correctness in Chrome print preview
- [ ] Open an existing invoice.
- [ ] Click the "Print/PDF" button.
- [ ] When the Chrome print preview opens, inspect the layout.
- **Expected Result:** The document flows correctly from Right-to-Left natively, Arabic text is connected properly (no disjointed letters), and the table columns align with RTL standard reading patterns.

## 2. Account statement PDF — correct page breaks and running balance across multiple pages
- [ ] Find a client with over 50 past invoices/payments (ensuring a multi-page statement).
- [ ] Generate the Account Statement PDF.
- [ ] Scroll through the generated PDF pages.
- **Expected Result:** Content gracefully wraps to new pages without cutting text in half. The "Running Balance" correctly carries over its total at the top/bottom of the page breaks.

## 3. PDF generation on mobile Chrome (responsive layout)
- [ ] Access the dashboard from Chrome on an Android/iOS device (or use Chrome DevTools Mobile Emulation).
- [ ] Navigate to the Reports tab and generate a comprehensive PDF report.
- [ ] Open the resulting PDF.
- **Expected Result:** The generated PDF should not exhibit scaled or microscopic fonts, maintaining legibility and adhering to standard A4 printing constraints regardless of the device that ordered its creation.

## 4. Staff user: profit report generate button is absent from UI
- [ ] Log in using staff credentials (`staff@example.com` / `password`).
- [ ] Navigate to the Reports/Sidebar area.
- [ ] Look for the "Generate Profit Report" or "Profit Summary" section.
- **Expected Result:** The button, link, or tab for Profit Reports is entirely absent from the DOM, and navigating directly via URL is rejected.

## 5. Barcode in product PDF decodes correctly when scanned
- [ ] Navigate to a Product Details page.
- [ ] Click the toggle to generate standard Barcode Labels (PDF).
- [ ] Try scanning the barcode on your screen using a physical scanner or a generic smartphone barcode app.
- **Expected Result:** The scanner must instantly decode the correct 12-13 digit alphanumeric ID associated with the specific product variant. 

## 6. PDF statement closing balance matches client dashboard balance on screen
- [ ] Go to a Client's details page and note their exact total Debt/Balance showing in the dashboard header.
- [ ] Immediately generate this client's Account Statement PDF.
- [ ] Compare the closing figure on the Document vs the UI.
- **Expected Result:** Both numbers match precisely to two decimal places, accounting for any unsaved draft states or partial payments.
