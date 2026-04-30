import * as db from './pgdb.js';

async function check() {
  try {
    const stats = await db.getDashboardStats();
    console.log('Stats:', stats);
    
    // Check batches directly - use pool from stats or import correctly
    // Actually pgdb.js doesn't export pool, but it uses it internally.
    // I already verified getDashboardStats works.
    
    // Let's run a raw query to see some data
    const r = await db.countUsers(); // verify connection works
    console.log('User count:', r);
    
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

check();
