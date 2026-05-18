import http from 'http';

http.get('http://localhost:3001/api/v1/products?limit=50&page=1', (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log('total from API:', parsed.total);
      console.log('data length:', parsed.data?.length);
    } catch (e) {
      console.log('Error parsing JSON:', e.message);
      console.log('Raw data:', data);
    }
  });
}).on('error', err => {
  console.log('Error:', err.message);
});
