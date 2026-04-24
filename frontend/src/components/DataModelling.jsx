import { useState } from 'react'
import './DataModelling.css'

// ── Dataset Preview ───────────────────────────────────────────────────────────
const KIND_META = {
  numeric:     { label: 'num',  color: '#3b82f6' },
  categorical: { label: 'cat',  color: '#f59e0b' },
  datetime:    { label: 'date', color: '#10b981' },
}

function DatasetPreview({ colProfiles, preview, stats }) {
  const [open, setOpen] = useState(true)
  if (!preview || !colProfiles) return null

  const columns = Object.keys(colProfiles)

  return (
    <div className="ds-preview-wrap">
      <button className="ds-preview-toggle" onClick={() => setOpen(o => !o)}>
        <span>🗂 Aperçu du dataset</span>
        <div className="ds-preview-toggle-right">
          <span className="ds-stat-chip">{stats.rows_count.toLocaleString()} lignes</span>
          <span className="ds-stat-chip">{stats.cols_count} colonnes</span>
          <span className="ds-chevron">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <>
          {/* Profil des colonnes */}
          <div className="ds-col-profiles">
            {columns.map(col => {
              const p    = colProfiles[col]
              const meta = KIND_META[p.kind] || { label: p.kind, color: '#9ca3af' }
              return (
                <div key={col} className="ds-col-chip">
                  <span className="ds-col-name">{col}</span>
                  <span className="ds-col-type" style={{ color: meta.color, borderColor: meta.color + '44' }}>
                    {meta.label}
                  </span>
                  {p.n_missing > 0 && (
                    <span className="ds-col-missing">{(100 - p.fill_rate).toFixed(0)}% NaN</span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Table des données */}
          <div className="ds-table-scroll">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="ds-th-idx">#</th>
                  {columns.map(col => {
                    const p    = colProfiles[col]
                    const meta = KIND_META[p.kind] || { label: p.kind, color: '#9ca3af' }
                    return (
                      <th key={col}>
                        <div className="ds-th-inner">
                          <span>{col}</span>
                          <span className="ds-th-type" style={{ color: meta.color }}>{meta.label}</span>
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i}>
                    <td className="ds-td-idx">{i + 1}</td>
                    {columns.map(col => {
                      const val = row[col]
                      const isNull = val === null || val === undefined
                      return (
                        <td key={col} className={isNull ? 'ds-td-null' : ''}>
                          {isNull ? <span className="ds-null-tag">NaN</span> : String(val)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── WOE Dataset Preview ───────────────────────────────────────────────────────
function WoeDatasetPreview({ columns, preview, targetCol }) {
  const [open, setOpen] = useState(true)

  const isTarget  = col => col === targetCol
  const isWoe     = col => col.endsWith('_woe')

  return (
    <div className="ds-preview-wrap" style={{ marginTop: '1.5rem' }}>
      <button className="ds-preview-toggle" onClick={() => setOpen(o => !o)}>
        <span>📐 Dataset transformé (WOE)</span>
        <div className="ds-preview-toggle-right">
          <span className="ds-stat-chip">{columns.length} colonnes</span>
          <span className="ds-stat-chip woe-chip">valeurs WOE</span>
          <span className="ds-chevron">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="ds-table-scroll">
          <table className="ds-table">
            <thead>
              <tr>
                <th className="ds-th-idx">#</th>
                {columns.map(col => (
                  <th key={col} className={isTarget(col) ? 'woe-th-target' : isWoe(col) ? 'woe-th-woe' : ''}>
                    <div className="ds-th-inner">
                      <span>{col}</span>
                      {isTarget(col) && <span className="ds-th-type" style={{ color: '#6366f1' }}>cible</span>}
                      {isWoe(col)    && <span className="ds-th-type" style={{ color: '#10b981' }}>WOE</span>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i}>
                  <td className="ds-td-idx">{i + 1}</td>
                  {columns.map(col => {
                    const val    = row[col]
                    const isNull = val === null || val === undefined
                    const woe    = isWoe(col) && !isNull
                    return (
                      <td
                        key={col}
                        className={isNull ? 'ds-td-null' : isTarget(col) ? 'woe-td-target' : ''}
                      >
                        {isNull
                          ? <span className="ds-null-tag">NaN</span>
                          : woe
                            ? <span className={`woe-cell-val ${val >= 0 ? 'woe-pos' : 'woe-neg'}`}>
                                {val >= 0 ? '+' : ''}{Number(val).toFixed(4)}
                              </span>
                            : String(val)
                        }
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function IVBadge({ label, color, iv }) {
  return (
    <span className="iv-badge" style={{ background: color + '22', color }}>
      {label} · {iv.toFixed(3)}
    </span>
  )
}

function WoeBinTable({ bins }) {
  return (
    <div className="woe-bin-table-wrap">
      <table className="woe-bin-table">
        <thead>
          <tr>
            <th>Bin</th>
            <th>N</th>
            <th>Événements</th>
            <th>Non-événements</th>
            <th>Taux événement</th>
            <th>WOE</th>
            <th>IV contrib</th>
          </tr>
        </thead>
        <tbody>
          {bins.map((b, i) => (
            <tr key={i} className={b.is_missing ? 'bin-row-missing' : ''}>
              <td className="bin-label">
                {b.is_missing
                  ? <span className="missing-tag">manquant</span>
                  : b.bin}
              </td>
              <td>{b.n_total.toLocaleString()}</td>
              <td>{b.n_events}</td>
              <td>{b.n_non_events}</td>
              <td>{(b.event_rate * 100).toFixed(1)}%</td>
              <td>
                <span className="woe-value" style={{ color: b.woe >= 0 ? '#10b981' : '#ef4444' }}>
                  {b.woe >= 0 ? '+' : ''}{b.woe.toFixed(3)}
                </span>
              </td>
              <td style={{ color: '#6366f1', fontWeight: 600 }}>
                {b.iv_contrib.toFixed(4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TargetCard({ candidate, selected, onSelect }) {
  const pct = (candidate.event_rate * 100).toFixed(1)
  const isBalanced = candidate.balance < 0.15
  return (
    <div
      className={`target-card ${selected ? 'target-card-selected' : ''}`}
      onClick={() => onSelect(candidate.column)}
    >
      <div className="target-card-top">
        <span className="target-col-name">{candidate.column}</span>
        {selected && <span className="target-selected-dot" />}
      </div>
      <div className="target-values">
        {candidate.values.map(v => (
          <span key={v} className="target-val-chip">{v}</span>
        ))}
      </div>
      <div className="target-rate-bar-wrap">
        <div className="target-rate-bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="target-rate-label">
        <span>Taux événement : <strong>{pct}%</strong></span>
        {isBalanced
          ? <span className="target-tag-ok">Équilibré</span>
          : <span className="target-tag-warn">Déséquilibré</span>}
      </div>
      {candidate.n_missing > 0 && (
        <div className="target-missing-warn">
          ⚠ {candidate.n_missing} valeur{candidate.n_missing > 1 ? 's' : ''} manquante{candidate.n_missing > 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function DataModelling({ cleaningSession }) {
  const [phase,          setPhase]          = useState('idle')
  const [error,          setError]          = useState(null)
  const [stats,          setStats]          = useState(null)
  const [colProfiles,    setColProfiles]    = useState(null)
  const [preview,        setPreview]        = useState(null)
  const [targetCands,    setTargetCands]    = useState([])
  const [selectedTarget, setSelectedTarget] = useState(null)
  const [woeReport,      setWoeReport]      = useState(null)
  const [woePreview,     setWoePreview]     = useState(null)
  const [woeColumns,     setWoeColumns]     = useState([])
  const [ivSummary,      setIvSummary]      = useState(null)
  const [expandedCol,    setExpandedCol]    = useState(null)
  const [nBins,          setNBins]          = useState(10)

  // ── Init : détection des candidats cibles ────────────────────────────────
  async function initModelling() {
    if (!cleaningSession) return
    setPhase('loading')
    setError(null)
    try {
      const fd = new FormData()
      fd.append('session_id', cleaningSession)
      const res  = await fetch('/api/data-modelling/init', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || `Erreur HTTP ${res.status}`)
      setTargetCands(data.target_candidates)
      setStats(data.statistics)
      setColProfiles(data.col_profiles)
      setPreview(data.preview)
      setPhase('target')
    } catch (e) {
      setError(e.message)
      setPhase('idle')
    }
  }

  // ── Calcul WOE / IV ───────────────────────────────────────────────────────
  async function computeWoe() {
    if (!selectedTarget) return
    setPhase('computing')
    setError(null)
    try {
      const fd = new FormData()
      fd.append('session_id', cleaningSession)
      fd.append('target_col', selectedTarget)
      fd.append('n_bins', String(nBins))
      const res  = await fetch('/api/data-modelling/woe/compute', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || `Erreur HTTP ${res.status}`)
      setWoeReport(data.woe_report)
      setWoePreview(data.woe_preview)
      setWoeColumns(data.woe_columns)
      setIvSummary(data.iv_summary)
      setPhase('woe')
    } catch (e) {
      setError(e.message)
      setPhase('target')
    }
  }

  const toggleExpand = (col) => setExpandedCol(prev => prev === col ? null : col)

  // ── Rendu : pas de session ────────────────────────────────────────────────
  if (!cleaningSession) {
    return (
      <div className="dm-page">
        <div className="dm-header">
          <h1>🤖 Data Modelling</h1>
          <p>Feature engineering et analyse prédictive</p>
        </div>
        <div className="dm-no-session">
          <div className="dm-no-session-icon">🔗</div>
          <h3>Pipeline Data Cleaning requis</h3>
          <p>Terminez le pipeline Data Cleaning pour transmettre le dataset nettoyé à ce module.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="dm-page">
      <div className="dm-header">
        <h1>🤖 Data Modelling</h1>
        <p>Feature engineering et analyse prédictive</p>
        {stats && (
          <div className="dm-session-info">
            <span className="dm-session-dot" />
            Session active · {stats.rows_count.toLocaleString()} lignes · {stats.cols_count} colonnes
          </div>
        )}
      </div>

      {error && <div className="dm-error">⚠ {error}</div>}

      {['target', 'woe', 'computing'].includes(phase) && (
        <DatasetPreview colProfiles={colProfiles} preview={preview} stats={stats} />
      )}

      {/* ── IDLE ── */}
      {phase === 'idle' && (
        <div className="dm-card dm-launch-card">
          <div className="dm-launch-icon">📊</div>
          <h3>Analyse WOE / IV</h3>
          <p>
            Calcule le <strong>Weight of Evidence</strong> et l'<strong>Information Value</strong> pour
            chaque variable. Les valeurs manquantes sont traitées comme un bin distinct — aucune imputation
            requise.
          </p>
          <div className="dm-launch-steps">
            <div className="dm-step"><span>1</span> Sélectionner la variable cible (binaire)</div>
            <div className="dm-step"><span>2</span> Calculer WOE / IV par variable</div>
            <div className="dm-step"><span>3</span> Sélectionner les variables prédictives</div>
          </div>
          <button className="btn-dm-launch" onClick={initModelling}>
            Démarrer l'analyse →
          </button>
        </div>
      )}

      {/* ── LOADING ── */}
      {phase === 'loading' && (
        <div className="dm-loading">
          <div className="dm-spinner" />
          <span>Analyse du dataset…</span>
        </div>
      )}

      {/* ── COMPUTING ── */}
      {phase === 'computing' && (
        <div className="dm-loading">
          <div className="dm-spinner" />
          <span>Calcul WOE / IV en cours…</span>
        </div>
      )}

      {/* ── TARGET SELECTION ── */}
      {phase === 'target' && (
        <div className="dm-section">
          <div className="dm-section-header">
            <h2>1 · Variable cible</h2>
            <p>
              Sélectionnez la colonne binaire à prédire.
              {targetCands.length === 0 && ' Aucune colonne binaire détectée dans le dataset.'}
            </p>
          </div>

          {targetCands.length > 0 ? (
            <>
              <div className="target-cards-grid">
                {targetCands.map(c => (
                  <TargetCard
                    key={c.column}
                    candidate={c}
                    selected={selectedTarget === c.column}
                    onSelect={setSelectedTarget}
                  />
                ))}
              </div>

              <div className="dm-bins-control">
                <label>Nombre de bins (variables continues)</label>
                <div className="dm-bins-row">
                  {[5, 10, 15, 20].map(n => (
                    <button
                      key={n}
                      className={`dm-bins-btn ${nBins === n ? 'active' : ''}`}
                      onClick={() => setNBins(n)}
                    >{n}</button>
                  ))}
                </div>
              </div>

              <button
                className="btn-dm-launch"
                onClick={computeWoe}
                disabled={!selectedTarget}
              >
                Calculer WOE / IV →
              </button>
            </>
          ) : (
            <div className="dm-no-session">
              <p>Aucune variable binaire détectée. Vérifiez vos données ou revenez au Data Cleaning.</p>
            </div>
          )}
        </div>
      )}

      {/* ── WOE / IV RESULTS ── */}
      {phase === 'woe' && woeReport && (
        <div className="dm-section">
          <div className="dm-section-header">
            <h2>2 · WOE / IV — Résultats</h2>
            <p>Variable cible : <strong>{selectedTarget}</strong> · {Object.keys(woeReport).length} variables analysées</p>
          </div>

          {/* Distribution IV */}
          {ivSummary && (
            <div className="iv-summary-row">
              {Object.entries(ivSummary).filter(([, n]) => n > 0).map(([label, n]) => {
                const colors = { Inutile: '#9ca3af', Faible: '#f59e0b', Moyen: '#3b82f6', Fort: '#10b981', Suspect: '#ef4444' }
                return (
                  <div key={label} className="iv-summary-chip" style={{ borderColor: colors[label] }}>
                    <span style={{ color: colors[label], fontWeight: 700 }}>{n}</span>
                    <span>{label}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Légende IV */}
          <div className="iv-legend">
            <span>IV :</span>
            {[['< 0.02', '#9ca3af', 'Inutile'], ['0.02–0.1', '#f59e0b', 'Faible'],
              ['0.1–0.3', '#3b82f6', 'Moyen'], ['0.3–0.5', '#10b981', 'Fort'], ['> 0.5', '#ef4444', 'Suspect']
            ].map(([range, color, label]) => (
              <span key={label} className="iv-legend-item">
                <span className="iv-legend-dot" style={{ background: color }} />
                {label} ({range})
              </span>
            ))}
          </div>

          {/* Table des variables */}
          <div className="woe-features-list">
            {Object.entries(woeReport).map(([col, info]) => (
              <div key={col} className="woe-feature-row">
                <div
                  className="woe-feature-header"
                  onClick={() => toggleExpand(col)}
                >
                  <div className="woe-feature-left">
                    <span className="woe-feature-name">{col}</span>
                    <span className="woe-type-chip">{info.var_type}</span>
                    {info.has_missing_bin && (
                      <span className="woe-missing-chip">bin manquant</span>
                    )}
                  </div>
                  <div className="woe-feature-right">
                    <div className="woe-iv-bar-wrap">
                      <div
                        className="woe-iv-bar"
                        style={{
                          width: `${Math.min(info.iv / 0.5 * 100, 100)}%`,
                          background: info.iv_color,
                        }}
                      />
                    </div>
                    <IVBadge label={info.iv_label} color={info.iv_color} iv={info.iv} />
                    <span className="woe-expand-icon">{expandedCol === col ? '▲' : '▼'}</span>
                  </div>
                </div>

                {expandedCol === col && (
                  <WoeBinTable bins={info.bins} />
                )}
              </div>
            ))}
          </div>

          {/* Dataset transformé WOE */}
          {woePreview && woeColumns.length > 0 && (
            <WoeDatasetPreview
              columns={woeColumns}
              preview={woePreview}
              targetCol={selectedTarget}
            />
          )}

          <button className="btn-dm-back" onClick={() => setPhase('target')}>
            ← Changer de cible
          </button>
        </div>
      )}
    </div>
  )
}
