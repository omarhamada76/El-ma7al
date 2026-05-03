import { parseScannedBarcode } from '../src/lib/scanCodes';

const testCodes = ['0418', 'B123', 'G45', 'PROD|10|Test', '0056'];

console.log('Testing barcode parsing:');
testCodes.forEach(code => {
  const result = parseScannedBarcode(code);
  console.log(`Input: "${code}" -> Kind: ${result.kind}, rawToken: "${result.rawToken}"`);
});
