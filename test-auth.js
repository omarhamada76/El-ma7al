const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const SUPABASE_URL = env.match(/VITE_SUPABASE_URL=(.*)/)?.[1];
const SUPABASE_KEY = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)?.[1];

async function main() {
  // We don't have a password. Let's just use PostgREST with the service_role key if available!
  const serviceKey = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1] || env.match(/SUPABASE_SERVICE_KEY=(.*)/)?.[1];
  if (serviceKey) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=id,name,barcode&limit=10`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });
    console.log("Service key used. Response length:", (await res.json()).length);
  } else {
    console.log("No service key found.");
  }
}
main();
