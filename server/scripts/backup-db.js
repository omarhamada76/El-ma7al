#!/usr/bin/env node
/**
 * Copy data/vet-pharmacy.sqlite to data/backups/vet-pharmacy-<timestamp>.sqlite
 * Run: npm run db:backup
 * Schedule on the server (cron) for DR; stop the API or copy WAL safely for hot backup.
 */
import { copyFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..', '..')
const dbPath = join(root, 'data', 'vet-pharmacy.sqlite')
const backupDir = join(root, 'data', 'backups')

if (!existsSync(dbPath)) {
  console.error('Database file not found:', dbPath)
  process.exit(1)
}
if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const dest = join(backupDir, `vet-pharmacy-${stamp}.sqlite`)
copyFileSync(dbPath, dest)
console.log('Backup OK:', dest)
