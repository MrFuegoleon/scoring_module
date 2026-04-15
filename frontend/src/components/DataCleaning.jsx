import './DataCleaning.css'
import { useState } from 'react'

// ── Utilitaires ───────────────────────────────────────────────────────────────
const fmtBytes = (b) => {
  if (!b) return '—'
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1024 / 1024).toFixed(1) + ' MB'
}

// ── Options de type pour le dropdown ─────────────────────────────────────────
const TYPE_OPTIONS = [
  { value: 'int8',             label: 'ℤ int8    · entier  (-128 à 127)'   },
  { value: 'int16',            label: 'ℤ int16   · entier  (-32k à 32k)'   },
  { value: 'int32',            label: 'ℤ int32   · entier  (-2M à 2M)'     },
  { value: 'int64',            label: 'ℤ int64   · grand entier'           },
  { value: 'float32',          label: 'ℝ float32 · décimal 32 bits'        },
  { value: 'float64',          label: 'ℝ float64 · décimal 64 bits'        },
  { value: 'bool',             label: '✓ bool    · booléen (True / False)' },
  { value: 'datetime64[ns]',   label: '📅 datetime · date et heure'        },
  { value: 'category',         label: '🏷 category · faible cardinalité'   },
  { value: 'object',           label: '○ object  · texte libre'            },
  { value: 'object (ID/Code)', label: '🔑 ID/Code · garder comme texte'   },
]

// ── Méta visuelle par type ────────────────────────────────────────────────────
const getTypeMeta = (typeStr) => {
  if (!typeStr) return { label: 'Inconnu',    color: '#6b7280', icon: '○' }
  const t = typeStr.toLowerCase()
  if (t.includes('datetime'))        return { label: 'Date',          color: '#3b82f6', icon: '📅' }
  if (t === 'bool')                  return { label: 'Booléen',       color: '#8b5cf6', icon: '✓'  }
  if (t === 'category')              return { label: 'Catégorie',     color: '#f59e0b', icon: '🏷'  }
  if (t.includes('id/code'))         return { label: 'ID / Code',     color: '#64748b', icon: '🔑' }
  if (t.includes('id/string'))       return { label: 'ID / Texte',    color: '#64748b', icon: '🔤' }
  if (/^int(8|16|32|64)?$/.test(t))  return { label: `Entier · ${t}`,  color: '#6366f1', icon: 'ℤ'  }
  if (/^float(32|64)?$/.test(t))     return { label: `Flottant · ${t}`, color: '#818cf8', icon: 'ℝ'  }
  if (/^(uint|int|float)/.test(t))   return { label: 'Numérique',     color: '#6366f1', icon: '#'  }
  return { label: 'Texte', color: '#6b7280', icon: '○' }
}

// ── Sous-composants partagés ──────────────────────────────────────────────────
function StatChip({ value, label, color }) {
  return (
    <div className="stat-chip">
      <span className="stat-chip-num" style={color ? { color } : {}}>{value}</span>
      <span className="stat-chip-label">{label}</span>
    </div>
  )
}

function HeroBanner({ icon, variant, title, sub }) {
  return (
    <div className={`hero-banner hero-${variant}`}>
      <span className="hero-icon">{icon}</span>
      <div>
        <div className="hero-title">{title}</div>
        {sub && <div className="hero-sub">{sub}</div>}
      </div>
    </div>
  )
}

function PreviewTable({ rows }) {
  if (!rows || rows.length === 0) return null
  const cols = Object.keys(rows[0])
  return (
    <details className="preview-details">
      <summary>👁 Aperçu des données (5 premières lignes)</summary>
      <div className="preview-table-wrap">
        <table className="preview-table">
          <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {cols.map((c, j) => (
                  <td key={j}>
                    {row[c] == null
                      ? <span className="cell-null">null</span>
                      : String(row[c]).length > 32 ? String(row[c]).slice(0, 30) + '…' : String(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

// ── Section types dans le modal ───────────────────────────────────────────────
function TypesReviewSection({ detectData, userTypes, onTypeChange }) {
  if (!detectData) return null
  const entries   = Object.entries(detectData.type_report || {})
  const nModified = entries.filter(([col]) =>
    userTypes[col] !== detectData.type_report[col]?.detected_type
  ).length

  return (
    <div className="modal-section">
      <div className="modal-section-header">
        <h3>🔧 Correction des types</h3>
        <div className="modal-section-chips">
          <span className="rsummary-chip rsummary-info">
            {entries.length} colonnes · {detectData.statistics?.rows_count ?? '—'} lignes
          </span>
          {nModified > 0 && (
            <span className="rsummary-chip rsummary-mod">
              ✏ {nModified} modifié{nModified > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="review-table">
        <div className="review-table-head">
          <span>Colonne</span>
          <span>Type original</span>
          <span>Proposé par le système</span>
          <span>Confiance</span>
          <span>Type à appliquer</span>
        </div>
        <div className="review-table-body">
          {entries.map(([col, report]) => {
            const proposed   = report.detected_type
            const selected   = userTypes[col] ?? proposed
            const isModified = selected !== proposed
            const meta       = getTypeMeta(proposed)
            const conf       = report.confidence ?? 0
            const confColor  = conf >= 90 ? '#10b981' : conf >= 70 ? '#f59e0b' : '#ef4444'

            return (
              <div key={col} className={`review-table-row ${isModified ? 'row-modified' : ''}`}>
                <span className="rcol-name" title={col}>
                  {isModified && <span className="modified-dot" title="Type modifié par l'utilisateur" />}
                  {col}
                </span>
                <code className="rcol-orig">{report.original_dtype}</code>
                <div className="rcol-proposed">
                  <span className="type-chip" style={{ '--chip-color': meta.color }}>
                    {meta.icon} {meta.label}
                  </span>
                </div>
                <div className="rcol-conf">
                  <div className="conf-bar-track">
                    <div className="conf-bar-fill" style={{ width: `${conf}%`, background: confColor }} />
                  </div>
                  <span className="conf-pct" style={{ color: confColor }}>{conf}%</span>
                </div>
                <select
                  className={`type-select ${isModified ? 'select-modified' : ''}`}
                  value={selected}
                  onChange={e => onTypeChange(col, e.target.value)}
                >
                  {TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Section doublons dans le modal ────────────────────────────────────────────
function DoublonsReviewSection({ doublonsData }) {
  if (!doublonsData) return null
  const { report = {} } = doublonsData
  const found = report.duplicates_found ?? 0
  const pct   = report.percentage_removed ?? 0

  return (
    <div className="modal-section">
      <div className="modal-section-header">
        <h3>🔁 Suppression des doublons</h3>
        <span className="rsummary-chip rsummary-info">Traitement automatique</span>
      </div>

      <div className={`doublon-hero ${found > 0 ? 'doublon-hero-warn' : 'doublon-hero-ok'}`}>
        <span className="doublon-hero-icon">{found > 0 ? '⚠' : '✓'}</span>
        <div>
          <div className="doublon-hero-title">
            {found > 0
              ? `${found} doublon${found > 1 ? 's' : ''} détecté${found > 1 ? 's' : ''} — seront supprimés à la confirmation`
              : 'Aucun doublon détecté — données déjà uniques'}
          </div>
          {found > 0 && (
            <div className="doublon-hero-sub">
              {report.initial_rows} lignes → {report.rows_after} lignes ({pct}% supprimé)
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Résultats : types appliqués ───────────────────────────────────────────────
function TypesApplied({ applyData }) {
  const entries = Object.entries(applyData.apply_report || {})
  const nOk     = entries.filter(([, r]) => r.success).length
  const nFail   = entries.filter(([, r]) => !r.success).length

  return (
    <div className="result-content">
      <HeroBanner
        icon={nFail === 0 ? '✓' : '⚠'}
        variant={nFail === 0 ? 'success' : 'warning'}
        title={`${nOk} colonne${nOk > 1 ? 's' : ''} converti${nOk > 1 ? 'es' : 'e'} avec succès`}
        sub={nFail > 0 ? `${nFail} colonne${nFail > 1 ? 's' : ''} en échec` : null}
      />
      <div className="result-stats-row">
        <StatChip value={applyData.statistics?.rows_count ?? '—'} label="lignes" />
        <StatChip value={nOk} label="conversions OK" color="#10b981" />
        {nFail > 0 && <StatChip value={nFail} label="échecs" color="#ef4444" />}
        <StatChip value={(applyData.statistics?.memory_usage_kb ?? '—') + ' KB'} label="mémoire" />
      </div>
      <div className="types-table">
        <div className="types-table-head types-table-head-4">
          <span>Colonne</span><span>Avant</span><span>Après</span><span>Statut</span>
        </div>
        <div className="types-table-body">
          {entries.map(([col, rep]) => {
            const meta = getTypeMeta(rep.applied_type)
            return (
              <div key={col} className="types-table-row types-table-row-4">
                <span className="tcol-name">{col}</span>
                <code className="tcol-orig">{rep.original_dtype}</code>
                <span className="tcol-type">
                  <span className="type-chip" style={{ '--chip-color': meta.color }}>
                    {meta.icon} {meta.label}
                  </span>
                </span>
                <span className="tcol-status" style={{ color: rep.success ? '#10b981' : '#ef4444' }}>
                  {rep.success ? '✓ OK' : `✗ ${rep.error || 'Erreur'}`}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      <PreviewTable rows={applyData.preview || []} />
    </div>
  )
}

// ── Résultats : doublons ──────────────────────────────────────────────────────
function ResultDoublons({ data }) {
  const { report = {}, statistics = {} } = data
  const found = report.duplicates_found ?? 0
  const pct   = report.percentage_removed ?? 0

  return (
    <div className="result-content">
      <HeroBanner
        icon={found > 0 ? '⚠' : '✓'}
        variant={found > 0 ? 'warning' : 'success'}
        title={found > 0
          ? `${found} doublon${found > 1 ? 's' : ''} supprimé${found > 1 ? 's' : ''}`
          : 'Aucun doublon — données uniques'}
        sub={found > 0 ? `${pct}% des lignes supprimées` : null}
      />
      <div className="result-stats-row">
        <StatChip value={report.initial_rows ?? '—'} label="lignes initiales" />
        <StatChip value={found} label="doublons" color="#ef4444" />
        <StatChip value={report.rows_after ?? '—'} label="lignes finales" color="#10b981" />
        <StatChip value={(statistics.memory_usage_kb ?? '—') + ' KB'} label="mémoire" />
      </div>
      {found > 0 && (
        <div className="result-progress-wrap">
          <div className="result-progress-track">
            <div className="result-progress-fill" style={{ width: `${pct}%`, background: '#ef4444' }} />
          </div>
          <span className="result-progress-lbl">{pct}% supprimé</span>
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ═════════════════════════════════════════════════════════════════════════════
export default function DataCleaning({ activeFile }) {

  // pipelineState : idle | running | modal | applying | done
  const [pipelineState, setPipelineState] = useState('idle')

  const [detectData,   setDetectData]   = useState(null)   // réponse detect-types
  const [userTypes,    setUserTypes]    = useState({})     // types confirmés par user
  const [doublonsData, setDoublonsData] = useState(null)   // réponse doublons

  const [typesResult,  setTypesResult]  = useState(null)   // réponse apply-types
  const [finalDoublon, setFinalDoublon] = useState(null)   // doublons à afficher dans résultats

  const [activeTab,  setActiveTab]  = useState('types')
  const [logs,       setLogs]       = useState([])

  const addLog = (key, status, msg) =>
    setLogs(prev => [
      { id: `${key}-${Date.now()}`, key, status, msg, time: new Date().toLocaleTimeString() },
      ...prev,
    ])

  // ── ÉTAPE 1 : Lancement du pipeline (analyses en parallèle) ──────────────
  async function launchPipeline() {
    if (!activeFile || pipelineState === 'running' || pipelineState === 'applying') return

    // Reset
    setDetectData(null); setDoublonsData(null)
    setTypesResult(null); setFinalDoublon(null)
    setPipelineState('running')
    addLog('pipeline', 'running', 'Lancement des analyses en parallèle…')

    const fd1 = new FormData(); fd1.append('file', activeFile)
    const fd2 = new FormData(); fd2.append('file', activeFile)

    try {
      const [tRes, dRes] = await Promise.allSettled([
        fetch('/api/data-cleaning/detect-types', { method: 'POST', body: fd1 }).then(r => r.json()),
        fetch('/api/data-cleaning/doublons',     { method: 'POST', body: fd2 }).then(r => r.json()),
      ])

      let typesOk = false, doublonsOk = false

      if (tRes.status === 'fulfilled' && tRes.value.success) {
        setDetectData(tRes.value)
        const init = {}
        Object.entries(tRes.value.type_report || {}).forEach(([col, r]) => { init[col] = r.detected_type })
        setUserTypes(init)
        typesOk = true
        addLog('types', 'success', `Types analysés — ${Object.keys(init).length} colonnes`)
      } else {
        addLog('types', 'error', `Analyse types échouée : ${tRes.reason?.message || tRes.value?.error || '?'}`)
      }

      if (dRes.status === 'fulfilled' && dRes.value.success) {
        setDoublonsData(dRes.value)
        doublonsOk = true
        addLog('doublons', 'success', `Doublons analysés — ${dRes.value.report?.duplicates_found ?? 0} trouvés`)
      } else {
        addLog('doublons', 'error', `Analyse doublons échouée`)
      }

      if (typesOk || doublonsOk) {
        addLog('pipeline', 'success', 'Analyses terminées — révision requise')
        setPipelineState('modal')
      } else {
        setPipelineState('idle')
      }
    } catch (e) {
      addLog('pipeline', 'error', `Erreur pipeline : ${e.message}`)
      setPipelineState('idle')
    }
  }

  // ── ÉTAPE 2 : Confirmation dans le modal → application ───────────────────
  async function confirmAndApply() {
    if (!activeFile) return
    setPipelineState('applying')
    addLog('types', 'running', 'Application des types confirmés…')

    const fd = new FormData()
    fd.append('file', activeFile)
    fd.append('confirmed_types', JSON.stringify(userTypes))

    try {
      const res  = await fetch('/api/data-cleaning/apply-types', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Erreur HTTP ${res.status}`)

      const nOk = Object.values(data.apply_report || {}).filter(r => r.success).length
      setTypesResult(data)
      setFinalDoublon(doublonsData)
      addLog('types', 'success', `${nOk} colonnes converties avec succès`)
      setPipelineState('done')
      setActiveTab('types')
    } catch (e) {
      addLog('types', 'error', `Application échouée : ${e.message}`)
      setPipelineState('modal')   // revenir au modal en cas d'erreur
    }
  }

  // ── États visuels des cartes ──────────────────────────────────────────────
  const CARD_BADGE = {
    idle:     { label: 'En attente',              cls: 'badge-idle'    },
    running:  { label: 'Analyse en cours…',       cls: 'badge-running' },
    pending:  { label: '⚠ En attente de révision', cls: 'badge-pending' },
    applying: { label: 'Application en cours…',   cls: 'badge-running' },
    done:     { label: 'Terminé ✓',              cls: 'badge-done'    },
  }

  const typesBadge    = CARD_BADGE[{
    idle: 'idle', running: 'running', modal: 'pending',
    applying: 'applying', done: 'done',
  }[pipelineState]]

  const doublonsBadge = CARD_BADGE[{
    idle: 'idle', running: 'running', modal: 'done',
    applying: 'done', done: 'done',
  }[pipelineState]]

  const completed = (pipelineState === 'done' ? 2 : 0)
  const progress  = (completed / 2) * 100

  // ─────────────────────────────────────────────────────────────────────────
  // RENDU
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="cleaning-page">

      {/* ── Header ── */}
      <div className="cleaning-header">
        <div>
          <h1>🧹 Data Cleaning</h1>
          <p className="cleaning-subtitle">Pipeline semi-automatique — analyse, révision, application</p>
        </div>
        <div className="cleaning-header-right">
          {activeFile && (
            <div className="file-badge">
              <span className="file-dot" />
              <span>{activeFile.name}</span>
              <span className="file-size">({fmtBytes(activeFile.size)})</span>
            </div>
          )}
          <button
            className="run-all-btn"
            onClick={pipelineState === 'done' ? launchPipeline : launchPipeline}
            disabled={!activeFile || pipelineState === 'running' || pipelineState === 'applying'}
          >
            {pipelineState === 'running'
              ? <><span className="btn-spinner" /> Analyse en cours…</>
              : pipelineState === 'done'
                ? '↺ Recommencer'
                : '🚀 Lancer le pipeline'}
          </button>
        </div>
      </div>

      {/* ── Alerte pas de fichier ── */}
      {!activeFile && (
        <div className="no-file-alert">
          <span>⚠</span>
          <span>
            Aucun dataset actif. Chargez un fichier CSV depuis le module <strong>Data Quality</strong>.
          </span>
        </div>
      )}

      {/* ── Progression ── */}
      {pipelineState === 'done' && (
        <div className="pipeline-progress">
          <span className="pipeline-progress-label">Pipeline complété</span>
          <div className="pipeline-progress-track">
            <div className="pipeline-progress-fill" style={{ width: '100%' }} />
          </div>
          <span className="pipeline-progress-pct">100%</span>
        </div>
      )}

      {/* ── Cartes de statut (indicateurs uniquement) ── */}
      <div className="tasks-grid">

        <div
          className={`task-card ${pipelineState === 'done' ? 'card-done' : ''} ${pipelineState === 'running' || pipelineState === 'applying' ? 'card-running' : ''} ${pipelineState === 'modal' ? 'card-pending' : ''}`}
          style={{ '--tc': '#6366f1' }}
        >
          <div className="task-card-top">
            <div className="task-icon" style={{ background: '#6366f118', color: '#6366f1' }}>🔧</div>
            <span className={`task-badge ${typesBadge.cls}`}>
              {(pipelineState === 'running' || pipelineState === 'applying') && <span className="badge-spin" />}
              {typesBadge.label}
            </span>
          </div>
          <div className="task-card-body">
            <h3 className="task-title">Correction des types</h3>
            <p className="task-desc">
              Détection automatique · révision manuelle · confirmation utilisateur
            </p>
            {pipelineState === 'modal' && (
              <p className="task-hint">💡 Le modal de révision est ouvert — confirmez les types.</p>
            )}
          </div>
          {pipelineState === 'done' && typesResult && (
            <div className="task-card-footer">
              <button className="btn-view" onClick={() => setActiveTab('types')}>
                👁 Voir les résultats
              </button>
            </div>
          )}
        </div>

        <div
          className={`task-card ${['modal','applying','done'].includes(pipelineState) ? 'card-done' : ''} ${pipelineState === 'running' ? 'card-running' : ''}`}
          style={{ '--tc': '#f59e0b' }}
        >
          <div className="task-card-top">
            <div className="task-icon" style={{ background: '#f59e0b18', color: '#f59e0b' }}>🔁</div>
            <span className={`task-badge ${doublonsBadge.cls}`}>
              {pipelineState === 'running' && <span className="badge-spin" />}
              {doublonsBadge.label}
            </span>
          </div>
          <div className="task-card-body">
            <h3 className="task-title">Suppression des doublons</h3>
            <p className="task-desc">
              Identification et suppression automatique des lignes dupliquées
            </p>
          </div>
          {pipelineState === 'done' && finalDoublon && (
            <div className="task-card-footer">
              <button className="btn-view" onClick={() => setActiveTab('doublons')}>
                👁 Voir les résultats
              </button>
            </div>
          )}
        </div>

      </div>

      {/* ── Résultats (après application) ── */}
      {pipelineState === 'done' && (typesResult || finalDoublon) && (
        <div className="results-panel">
          <div className="results-panel-header">
            <h2>📊 Résultats du pipeline</h2>
            <div className="results-tabs">
              {typesResult && (
                <button
                  className={`rtab ${activeTab === 'types' ? 'rtab-active' : ''}`}
                  style={activeTab === 'types' ? { '--rtab-c': '#6366f1' } : {}}
                  onClick={() => setActiveTab('types')}
                >🔧 Types</button>
              )}
              {finalDoublon && (
                <button
                  className={`rtab ${activeTab === 'doublons' ? 'rtab-active' : ''}`}
                  style={activeTab === 'doublons' ? { '--rtab-c': '#f59e0b' } : {}}
                  onClick={() => setActiveTab('doublons')}
                >🔁 Doublons</button>
              )}
            </div>
          </div>
          <div className="results-panel-body">
            {activeTab === 'types'    && typesResult  && <TypesApplied  applyData={typesResult}   />}
            {activeTab === 'doublons' && finalDoublon && <ResultDoublons data={finalDoublon}       />}
          </div>
        </div>
      )}

      {/* ── Journal ── */}
      <div className="log-panel">
        <div className="log-panel-header">
          <h2>📜 Journal</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {logs.length > 0 && (
              <button className="log-clear-btn" onClick={() => setLogs([])}>Effacer</button>
            )}
            <span className="log-count">{logs.length}</span>
          </div>
        </div>
        <div className="log-panel-body">
          {logs.length === 0
            ? <div className="log-empty">Aucune opération lancée pour l'instant…</div>
            : logs.map(log => (
              <div key={log.id} className={`log-entry log-${log.status}`}>
                <span className="log-time">{log.time}</span>
                <span className={`log-dot ld-${log.status}`} />
                <span className="log-msg">{log.msg}</span>
              </div>
            ))
          }
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL DE RÉVISION
          ══════════════════════════════════════════════════════════════════ */}
      {pipelineState === 'modal' && (
        <div className="modal-overlay" onClick={() => setPipelineState('idle')}>
          <div className="pipeline-modal" onClick={e => e.stopPropagation()}>

            {/* Header modal */}
            <div className="modal-header">
              <div>
                <h2 className="modal-title">📋 Révision du pipeline</h2>
                <p className="modal-subtitle">
                  Vérifiez les types proposés, modifiez si nécessaire, puis confirmez.
                </p>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setPipelineState('idle')}
                title="Annuler"
              >✕</button>
            </div>

            {/* Body modal (scrollable) */}
            <div className="modal-body">
              <TypesReviewSection
                detectData={detectData}
                userTypes={userTypes}
                onTypeChange={(col, type) => setUserTypes(prev => ({ ...prev, [col]: type }))}
              />
              <DoublonsReviewSection doublonsData={doublonsData} />
            </div>

            {/* Footer modal */}
            <div className="modal-footer">
              <button
                className="btn-modal-cancel"
                onClick={() => setPipelineState('idle')}
              >
                Annuler
              </button>
              <button
                className="btn-modal-confirm"
                onClick={confirmAndApply}
              >
                ✓ Confirmer et appliquer
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Overlay applying (spinner pendant l'application) */}
      {pipelineState === 'applying' && (
        <div className="modal-overlay">
          <div className="applying-card">
            <span className="applying-spinner" />
            <div>
              <div className="applying-title">Application en cours…</div>
              <div className="applying-sub">Conversion des types selon vos choix</div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
