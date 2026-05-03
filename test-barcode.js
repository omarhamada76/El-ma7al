import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
)

async function run() {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, barcode')
    .or('barcode.ilike.%56%,name.ilike.%56%,barcode.ilike.%418%,name.ilike.%418%')
  console.log("Found products:", JSON.stringify(data, null, 2))
}

run()
