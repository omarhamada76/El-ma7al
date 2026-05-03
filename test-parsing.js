const stripInvisible = (s) => s.replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '');

function parseScannedBarcode(raw) {
  const s = stripInvisible((raw || '').trim());
  if (!s) return { kind: 'product', code: '' };

  const batchM = /^B(\d+)$/i.exec(s);
  if (batchM) return { kind: 'batch', batchId: parseInt(batchM[1], 10) };

  const numericBatchM = /^\d{4,6}$/.exec(s);
  if (numericBatchM) return { kind: 'batch', batchId: parseInt(numericBatchM[0], 10) };

  return { kind: 'product', code: s };
}

console.log('0056 ->', parseScannedBarcode('0056'));
console.log('0418 ->', parseScannedBarcode('0418'));
console.log('418 ->', parseScannedBarcode('418'));
console.log('B418 ->', parseScannedBarcode('B418'));
