const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const SUPABASE_URL = env.match(/VITE_SUPABASE_URL=(.*)/)?.[1];

async function main() {
  const serviceKeyMatch = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/) || env.match(/SUPABASE_SERVICE_KEY=(.*)/);
  if (!serviceKeyMatch) {
    console.log("No service key.");
    return;
  }
  const serviceKey = serviceKeyMatch[1];
  
  const res = await fetch(`${SUPABASE_URL}/rest/v1/products?name=ilike.*ديليت*&select=id,name,barcode`, {
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`
    }
  });
  console.log("Products:", await res.json());
}
main();
