/**
 * services/reportStore.js
 * ─────────────────────────────
 * Persistance des rapports ydata_profiling HTML.
 * Stockage : backend/reports/*.html
 * Index    : backend/reports/index.json
 */

import fs   from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.join(__dirname, '..', 'reports')
const INDEX_FILE  = path.join(REPORTS_DIR, 'index.json')

function ensureDir() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true })
}

function readIndex() {
  ensureDir()
  if (!fs.existsSync(INDEX_FILE)) return []
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) }
  catch { return [] }
}

function writeIndex(index) {
  ensureDir()
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8')
}

/** Calcule le SHA-256 du fichier sur disque (Buffer) */
export function computeFileHash(filePath) {
  const buffer = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/** Sauvegarde un rapport HTML sur disque et l'ajoute à l'index */
export function saveReport(fileHash, filename, htmlContent) {
  ensureDir()
  const id          = crypto.randomUUID()
  const generatedAt = new Date().toISOString()
  const htmlFile    = `report_${id}.html`

  fs.writeFileSync(path.join(REPORTS_DIR, htmlFile), htmlContent, 'utf8')

  const index = readIndex()
  index.push({ id, file_hash: fileHash, filename, generated_at: generatedAt, html_file: htmlFile })
  writeIndex(index)

  return { id, generated_at: generatedAt }
}

/** Retourne les rapports pour un hash donné (tri : plus récent en premier) */
export function getReportsByHash(fileHash) {
  return readIndex()
    .filter(r => r.file_hash === fileHash)
    .sort((a, b) => new Date(b.generated_at) - new Date(a.generated_at))
    .map(({ id, filename, generated_at, file_hash }) => ({ id, filename, generated_at, file_hash }))
}

/** Retourne le HTML d'un rapport par son ID, ou null si introuvable */
export function getReportHtml(reportId) {
  const index  = readIndex()
  const report = index.find(r => r.id === reportId)
  if (!report) return null
  const htmlPath = path.join(REPORTS_DIR, report.html_file)
  if (!fs.existsSync(htmlPath)) return null
  return fs.readFileSync(htmlPath, 'utf8')
}

/** Supprime un rapport par ID. Retourne true si supprimé, false si introuvable. */
export function deleteReport(reportId) {
  const index  = readIndex()
  const report = index.find(r => r.id === reportId)
  if (!report) return false
  const htmlPath = path.join(REPORTS_DIR, report.html_file)
  if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath)
  writeIndex(index.filter(r => r.id !== reportId))
  return true
}
