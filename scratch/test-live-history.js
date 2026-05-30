import 'dotenv/config';
import crypto from 'crypto';

// Helper to sign a JWT using the HMAC secret in Node.js
function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  
  const base64UrlEncode = (str) => {
    return Buffer.from(str)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64url');

  return `${signatureInput}.${signature}`;
}

async function run() {
  const origin = process.env.VITE_API_ORIGIN;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const secret = process.env.JWT_SECRET;

  if (!origin || !anonKey || !secret) {
    console.error('Missing required environment variables in .env');
    return;
  }

  // Create JWT for user admin@elm7l.com (role: super_admin, id: 85)
  const token = signJWT({ id: 85, email: 'admin@elm7l.com', role: 'super_admin' }, secret);
  console.log('Generated JWT:', token);

  const productId = process.argv[2] ? parseInt(process.argv[2], 10) : 281;
  const url = `${origin}/products/${productId}/history`;
  console.log('Fetching:', url);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('Response status:', res.status);
    const body = await res.text();
    console.log('Response body:', body);
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

run();
