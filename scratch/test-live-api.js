import fetch from 'node-fetch';
import 'dotenv/config';

async function testApi() {
  const origin = process.env.VITE_API_ORIGIN;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  console.log("Testing API:", origin);
  
  const response = await fetch(`${origin}/products?limit=1&warehouse_id=1`, {
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`
    }
  });

  const data = await response.json();
  console.log("Total for warehouse 1:", data.total);

  const responseAll = await fetch(`${origin}/products?limit=1`, {
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`
    }
  });

  const dataAll = await responseAll.json();
  console.log("Total for all warehouses:", dataAll.total);
}

testApi();
