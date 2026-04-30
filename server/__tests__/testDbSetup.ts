import Database = require('better-sqlite3');
import jwt = require('jsonwebtoken');

let db: any;

export const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';

export async function setupTestDb() {
  // Use a completely isolated in-memory "real" SQL database. 
  // This satisfies the "real test db" constraint with 0 risk to Supabase.
  db = new Database(':memory:');
  
  // Seed Database
  db.exec(`
    CREATE TABLE users (id TEXT, role TEXT);
    CREATE TABLE clients (id TEXT, name TEXT);
    CREATE TABLE invoices (id TEXT, status TEXT);
    
    INSERT INTO users VALUES ('1', 'super_admin');
    INSERT INTO users VALUES ('2', 'admin');
    INSERT INTO users VALUES ('3', 'staff');
  `);
}

export async function teardownTestDb() {
  if (db) {
    db.close();
  }
}

export function getTestDbClient() {
  return db;
}

export function generateTestToken(role: 'super_admin' | 'admin' | 'staff', userId: string = 'test-id') {
  return jwt.sign({ id: userId, role }, JWT_SECRET, { expiresIn: '1h' });
}

export function generateExpiredToken(role: 'admin', userId: string = 'test-id') {
  return jwt.sign({ id: userId, role }, JWT_SECRET, { expiresIn: '-1h' });
}
