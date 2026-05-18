import { getProductCountFiltered, getProducts } from '../server/pgdb.js';

async function test() {
  console.log("Total Count without filters:", await getProductCountFiltered(undefined, undefined, null, false, false, false, false, false));
  const products = await getProducts(undefined, undefined, 50, 0, null, false, false, false, false, false);
  console.log("Products length:", products.length);
  process.exit(0);
}
test();
