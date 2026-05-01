const axios = require('axios');

async function checkApi() {
  try {
    const res = await axios.get('http://localhost:3001/api/v1/products?limit=1', {
      headers: {
        'Authorization': 'Bearer ' + process.env.TOKEN // I'll need a token
      }
    });
    console.log('API Response Sample:');
    console.log(JSON.stringify(res.data.data[0], null, 2));
  } catch (err) {
    console.error('API Error:', err.message);
  }
}

checkApi();
