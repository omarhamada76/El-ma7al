import 'dotenv/config';
import { getAccountStatementClient } from '../server/pgdb.js';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DB_URL || process.env.SUPABASE_DB_URL });

async function runTest() {
  try {
    console.log("--- Scanning DB for highest-activity Client ---");
    const clients = await pool.query('SELECT id, name FROM clients');
    
    let target = null;
    let targetRes = null;
    
    for (const c of clients.rows) {
      const res = await getAccountStatementClient(c.id);
      // We look for a client that has at least some flow elements (Invoices/Payments)
      if (res.rows.length > 0) {
        target = c;
        targetRes = res;
        break; 
      }
    }
    
    if (targetRes) {
      console.log(`\n=> Found Active Client: ${target.name} (ID: ${target.id})`);
      console.log(`Opening Balance: ${targetRes.opening_balance} EGP`);
      console.log(`Total Ledger Actions: ${targetRes.rows.length}`);
      
      console.log("\n[First Action in Ledger]");
      console.dir(targetRes.rows[0], { depth: null });
      
      console.log("\n[Most Recent Action in Ledger]");
      console.dir(targetRes.rows[targetRes.rows.length - 1], { depth: null });
      
      console.log(`\n=> Calculated Final Closing Balance: ${targetRes.closing_balance} EGP`);
    } else {
      console.log("No active clients with invoices/payments were found in the database to display.");
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

runTest();
