import { getProductCountFiltered } from '../server/pgdb.js';

async function test() {
  const count1 = await getProductCountFiltered(undefined, undefined, 1, false, false, false, false, false);
  console.log("Count with warehouse 1:", count1);
  const countNull = await getProductCountFiltered(undefined, undefined, null, false, false, false, false, false);
  console.log("Count with warehouse null:", countNull);
  process.exit(0);
}
test();
