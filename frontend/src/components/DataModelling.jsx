import { useState, useEffect, useRef } from 'react'
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

// ── ROC Curve SVG ─────────────────────────────────────────────────────────────
function RocCurve({ roc, color = '#6366f1', label }) {
  if (!roc) return null
  const W = 200, H = 160, PAD = 20
  const pts = roc.fpr.map((x, i) => [
    PAD + x * (W - PAD),
    H - PAD - roc.tpr[i] * (H - PAD),
  ])
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="roc-svg">
      {/* Diagonale aléatoire */}
      <line x1={PAD} y1={H - PAD} x2={W} y2={PAD} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4,3" />
      {/* Axes */}
      <line x1={PAD} y1={PAD - 4} x2={PAD} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" />
      <line x1={PAD} y1={H - PAD} x2={W + 2} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" />
      {/* Courbe */}
      <path d={d} fill="none" stroke={color} strokeWidth="2" />
      {/* Label */}
      {label && <text x={PAD + 4} y={PAD + 10} fontSize="9" fill={color}>{label}</text>}
    </svg>
  )
}

// ── Lift Curve SVG ────────────────────────────────────────────────────────────
function LiftCurve({ liftData, color = '#6366f1' }) {
  if (!liftData || !liftData.x) return null
  const W = 260, H = 160, PAD = 24
  const { x, lift } = liftData
  const maxLift = Math.max(...lift, 1)

  const d = lift.map((v, i) => {
    const sx = PAD + x[i] * (W - 2 * PAD)
    const sy = H - PAD - (v / maxLift) * (H - 2 * PAD)
    return `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`
  }).join(' ')

  const baselineY = H - PAD - (1 / maxLift) * (H - 2 * PAD)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="roc-svg--full">
      <line x1={PAD} y1={PAD - 4} x2={PAD} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" />
      <line x1={PAD} y1={H - PAD} x2={W - PAD + 4} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" />
      {/* lift = 1 (aléatoire) */}
      <line x1={PAD} y1={baselineY} x2={W - PAD} y2={baselineY}
            stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="6,4" />
      <text x={W - PAD - 2} y={baselineY - 3} fontSize="8" fill="#9ca3af" textAnchor="end">aléatoire</text>
      <path d={d} fill="none" stroke={color} strokeWidth="2" />
      <text x={PAD + 2} y={PAD + 9} fontSize="8" fill="#9ca3af">{maxLift.toFixed(1)}×</text>
      <text x={PAD}               y={H - PAD + 11} fontSize="8" fill="#9ca3af" textAnchor="middle">0%</text>
      <text x={PAD + (W-2*PAD)/2} y={H - PAD + 11} fontSize="8" fill="#9ca3af" textAnchor="middle">50%</text>
      <text x={W - PAD}           y={H - PAD + 11} fontSize="8" fill="#9ca3af" textAnchor="middle">100%</text>
    </svg>
  )
}

// ── Probability Distribution KDE ─────────────────────────────────────────────
function ProbDistribution({ dist }) {
  if (!dist || !dist.group_0) return null
  const W = 260, H = 160, PAD = 24
  const kde_0 = dist.group_0
  const kde_1 = dist.group_1
  const x = dist.x ?? Array.from({ length: kde_0.length }, (_, i) => i / (kde_0.length - 1))
  const maxD = Math.max(...kde_0, ...kde_1) || 1
  const C0 = '#10b981', C1 = '#ef4444'

  function toPoints(kde) {
    return kde.map((d, i) => [
      PAD + x[i] * (W - 2 * PAD),
      H - PAD - (d / maxD) * (H - 2 * PAD),
    ])
  }

  function linePath(pts) {
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  }

  function areaPath(pts) {
    const first = pts[0], last = pts[pts.length - 1]
    return `M${first[0].toFixed(1)},${H - PAD} `
      + pts.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
      + ` L${last[0].toFixed(1)},${H - PAD} Z`
  }

  const p0 = toPoints(kde_0)
  const p1 = toPoints(kde_1)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="roc-svg--full">
      <line x1={PAD} y1={PAD - 4} x2={PAD} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" />
      <line x1={PAD} y1={H - PAD} x2={W - PAD + 4} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" />
      <path d={areaPath(p0)} fill={C0} fillOpacity="0.15" />
      <path d={areaPath(p1)} fill={C1} fillOpacity="0.15" />
      <path d={linePath(p0)} fill="none" stroke={C0} strokeWidth="1.8" />
      <path d={linePath(p1)} fill="none" stroke={C1} strokeWidth="1.8" />
      <rect x={W - PAD - 72} y={PAD}      width="7" height="7" rx="1" fill={C0} />
      <text x={W - PAD - 61} y={PAD + 6.5} fontSize="9" fill="#6b7280">Non-Churn</text>
      <rect x={W - PAD - 72} y={PAD + 13} width="7" height="7" rx="1" fill={C1} />
      <text x={W - PAD - 61} y={PAD + 19.5} fontSize="9" fill="#6b7280">Churn</text>
      <text x={PAD}               y={H - PAD + 11} fontSize="8" fill="#9ca3af" textAnchor="middle">0</text>
      <text x={PAD + (W-2*PAD)/2} y={H - PAD + 11} fontSize="8" fill="#9ca3af" textAnchor="middle">0.5</text>
      <text x={W - PAD}           y={H - PAD + 11} fontSize="8" fill="#9ca3af" textAnchor="middle">1</text>
    </svg>
  )
}

// ── Confusion Matrix ──────────────────────────────────────────────────────────
function ConfusionMatrix({ cm }) {
  if (!cm) return null
  const [[tn, fp], [fn, tp]] = cm
  const total = tn + fp + fn + tp
  return (
    <div className="conf-matrix">
      <div className="conf-matrix-label-row">
        <span />
        <span className="conf-pred-label">Prédit 0</span>
        <span className="conf-pred-label">Prédit 1</span>
      </div>
      {[['Réel 0', tn, fp, '#10b981', '#ef4444'],
        ['Réel 1', fn, tp, '#ef4444', '#10b981']].map(([lbl, a, b, ca, cb]) => (
        <div key={lbl} className="conf-matrix-row">
          <span className="conf-real-label">{lbl}</span>
          <span className="conf-cell" style={{ background: ca + '22', color: ca }}>
            {a}<span className="conf-pct"> {(a/total*100).toFixed(0)}%</span>
          </span>
          <span className="conf-cell" style={{ background: cb + '22', color: cb }}>
            {b}<span className="conf-pct"> {(b/total*100).toFixed(0)}%</span>
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Feature Importance ────────────────────────────────────────────────────────
function FeatureImportance({ features, impType }) {
  if (!features || features.length === 0) return null
  const max = features[0].importance || 1
  return (
    <div className="feat-imp-list">
      <div className="feat-imp-title">{impType}</div>
      {features.slice(0, 10).map(({ feature, importance }) => (
        <div key={feature} className="feat-imp-row">
          <span className="feat-imp-name" title={feature}>{feature}</span>
          <div className="feat-imp-bar-track">
            <div
              className="feat-imp-bar"
              style={{ width: `${(importance / max) * 100}%` }}
            />
          </div>
          <span className="feat-imp-val">{importance.toFixed(3)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Model Result Card ─────────────────────────────────────────────────────────
const MODEL_META = {
  logit:         { name: 'Régression Logistique', color: '#6366f1', icon: '📈' },
  xgboost:       { name: 'XGBoost',               color: '#f59e0b', icon: '🌲' },
  lightgbm:      { name: 'LightGBM',              color: '#10b981', icon: '⚡' },
  random_forest: { name: 'Random Forest',         color: '#3b82f6', icon: '🌳' },
}

function ModelResultCard({ modelType, result, error, running }) {
  const [tab, setTab] = useState('metrics')
  const meta = MODEL_META[modelType] || { name: modelType, color: '#6b7280', icon: '🤖' }

  return (
    <div className="model-result-card" style={{ '--mc': meta.color }}>
      <div className="model-result-header">
        <span className="model-result-icon">{meta.icon}</span>
        <span className="model-result-name">{meta.name}</span>
        {running && <span className="model-result-spinner" />}
        {result && <span className="model-result-ok">✓</span>}
        {error && <span className="model-result-err">✗</span>}
      </div>

      {running && (
        <div className="model-result-loading">Entraînement en cours…</div>
      )}

      {error && !running && (
        <div className="model-result-error">⚠ {error}</div>
      )}

      {result && !running && (
        <>
          {/* Métriques CV (train) */}
          <div className="model-metrics-section-label">Validation croisée (train)</div>
          <div className="model-metrics-row">
            {[['AUC', result.results.auc],
              ['Gini', result.results.gini],
              ['KS',   result.results.ks]].map(([k, v]) => (
              <div key={k} className="model-metric-chip">
                <span className="model-metric-val" style={{ color: meta.color }}>
                  {(v * 100).toFixed(1)}%
                </span>
                <span className="model-metric-label">{k}</span>
              </div>
            ))}
          </div>

          {/* Métriques test (hold-out) */}
          <div className="model-metrics-section-label">Test set (hold-out)</div>
          <div className="model-metrics-row">
            {[['AUC', result.results.auc_test],
              ['Gini', result.results.gini_test],
              ['KS',   result.results.ks_test]].map(([k, v]) => (
              <div key={k} className="model-metric-chip model-metric-chip--test">
                <span className="model-metric-val" style={{ color: meta.color }}>
                  {(v * 100).toFixed(1)}%
                </span>
                <span className="model-metric-label">{k}</span>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="model-tabs">
            {[['metrics', 'ROC + Matrice'], ['importance', 'Variables'], ['distribution', 'Distribution'], ['lift', 'Lift']].map(([k, l]) => (
              <button
                key={k}
                className={`model-tab ${tab === k ? 'active' : ''}`}
                style={tab === k ? { '--mtc': meta.color } : {}}
                onClick={() => setTab(k)}
              >{l}</button>
            ))}
          </div>

          {tab === 'metrics' && (
            <div className="model-detail-row">
              <div>
                <div className="model-detail-label">Courbe ROC</div>
                <RocCurve roc={result.results.roc_curve} color={meta.color} />
              </div>
              <div>
                <div className="model-detail-label">Matrice de confusion</div>
                <ConfusionMatrix cm={result.results.confusion_matrix} />
                <div className="model-cv-note">
                  CV {result.results.cv_folds} folds · train {result.results.n_train} obs · test {result.results.n_test} obs · {result.results.n_features} features
                </div>
                {result.pca_report && (
                  <div className="model-pca-note">
                    ACP : {result.pca_report.n_components} composantes
                    ({(result.pca_report.total_variance_kept * 100).toFixed(0)}% variance)
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'importance' && (
            <FeatureImportance
              features={result.results.feature_importance}
              impType={result.results.importance_type}
            />
          )}

          {tab === 'distribution' && (
            <div>
              <div className="model-detail-label">Distribution des probabilités — test set</div>
              <ProbDistribution dist={result.results.prob_distribution} />
            </div>
          )}

          {tab === 'lift' && (
            <LiftCurve liftData={result.results.lift_curve} color={meta.color} />
          )}
        </>
      )}
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function DataModelling({ cleaningSession }) {
  const [phase,        setPhase]        = useState('idle')
  const [error,        setError]        = useState(null)
  const [datamartInfo, setDatamartInfo] = useState(null)   // { target_col, logit, tree }
  const [resetNotif,   setResetNotif]   = useState(false)

  // ── Training state ────────────────────────────────────────────────────────
  const [trainConfig, setTrainConfig] = useState({
    rawModels:   { xgboost: true, lightgbm: true, random_forest: true },
    usePca:      false,
    nComponents: null,
  })
  const [trainResults, setTrainResults] = useState({})
  const [trainRunning, setTrainRunning] = useState({})
  const [trainErrors,  setTrainErrors]  = useState({})

  const prevSessionRef = useRef(null)

  // ── Reset centralisé ──────────────────────────────────────────────────────
  function resetModelling() {
    setPhase('idle')
    setError(null)
    setDatamartInfo(null)
    setTrainResults({})
    setTrainRunning({})
    setTrainErrors({})
  }

  // ── Auto-reset quand la session de cleaning change ────────────────────────
  useEffect(() => {
    if (!cleaningSession) return
    if (prevSessionRef.current && prevSessionRef.current !== cleaningSession) {
      resetModelling()
      setResetNotif(true)
      const t = setTimeout(() => setResetNotif(false), 5000)
      return () => clearTimeout(t)
    }
    prevSessionRef.current = cleaningSession
  }, [cleaningSession])

  // ── Init : vérifie les datamarts et récupère leurs infos ─────────────────
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
      setDatamartInfo(data)
      setPhase('ready')
    } catch (e) {
      setError(e.message)
      setPhase('idle')
    }
  }

  // ── Entraînement d'un modèle ──────────────────────────────────────────────
  async function trainModel(modelType) {
    setTrainRunning(prev => ({ ...prev, [modelType]: true }))
    setTrainErrors(prev => ({ ...prev, [modelType]: null }))

    const fd = new FormData()
    fd.append('session_id', cleaningSession)
    fd.append('model_type', modelType)
    fd.append('use_pca',    String(trainConfig.usePca))
    if (trainConfig.nComponents) fd.append('n_components', String(trainConfig.nComponents))

    try {
      const res  = await fetch('/api/data-modelling/train', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || `Erreur HTTP ${res.status}`)
      setTrainResults(prev => ({ ...prev, [modelType]: data }))
    } catch (e) {
      setTrainErrors(prev => ({ ...prev, [modelType]: e.message }))
    } finally {
      setTrainRunning(prev => ({ ...prev, [modelType]: false }))
    }
  }

  async function launchTraining() {
    setPhase('training')
    setTrainResults({})
    setTrainErrors({})
    trainModel('logit')
    Object.entries(trainConfig.rawModels).forEach(([m, enabled]) => {
      if (enabled) trainModel(m)
    })
  }

  // ── Rendu : pas de session ────────────────────────────────────────────────
  if (!cleaningSession) {
    return (
      <div className="dm-page">
        <div className="dm-header">
          <h1>🤖 Data Modelling</h1>
          <p>Entraînement et évaluation des modèles</p>
        </div>
        <div className="dm-no-session">
          <div className="dm-no-session-icon">🔗</div>
          <h3>Pipeline Data Cleaning requis</h3>
          <p>Terminez le pipeline Data Cleaning et construisez les datamarts pour accéder à ce module.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="dm-page">
      <div className="dm-header">
        <div className="dm-header-left">
          <h1>🤖 Data Modelling</h1>
          <p>Entraînement et évaluation des modèles</p>
          {datamartInfo && (
            <div className="dm-session-info">
              <span className="dm-session-dot" />
              Cible : <strong>{datamartInfo.target_col}</strong> ·
              Logit {datamartInfo.logit.n_cols - 1} features ·
              Tree {datamartInfo.tree.n_cols - 1} features
            </div>
          )}
        </div>
        {phase !== 'idle' && (
          <button className="btn-dm-reset" onClick={resetModelling} title="Réinitialiser">
            ↺ Réinitialiser
          </button>
        )}
      </div>

      {resetNotif && (
        <div className="dm-reset-notif">
          ⚠ Modélisation réinitialisée — nouvelle session de nettoyage détectée.
        </div>
      )}

      {error && <div className="dm-error">⚠ {error}</div>}

      {/* ── IDLE ── */}
      {phase === 'idle' && (
        <div className="dm-card dm-launch-card">
          <div className="dm-launch-icon">🎯</div>
          <h3>Entraînement des modèles</h3>
          <p>
            Les datamarts construits en Data Cleaning sont utilisés directement.
            Pipeline <strong>WOE → Logit</strong> et pipeline <strong>Tree-based</strong> (OHE + Target Encoding).
          </p>
          <div className="dm-launch-steps">
            <div className="dm-step"><span>1</span> Vérifier les datamarts disponibles</div>
            <div className="dm-step"><span>2</span> Configurer les modèles à entraîner</div>
            <div className="dm-step"><span>3</span> Comparer AUC · Gini · KS</div>
          </div>
          <button className="btn-dm-launch" onClick={initModelling}>
            Analyser les datamarts →
          </button>
        </div>
      )}

      {/* ── LOADING ── */}
      {phase === 'loading' && (
        <div className="dm-loading">
          <div className="dm-spinner" />
          <span>Vérification des datamarts…</span>
        </div>
      )}

      {/* ── READY + TRAINING ── */}
      {(phase === 'ready' || phase === 'training') && datamartInfo && (
        <div className="dm-section">
          <div className="dm-section-header">
            <h2>Entraînement des modèles</h2>
            <p>Variable cible : <strong>{datamartInfo.target_col}</strong></p>
          </div>

          {/* Info datamarts */}
          <div className="train-config-grid" style={{ marginBottom: '1rem' }}>
            <div className="train-config-card train-card-woe">
              <div className="train-card-header">
                <span className="train-card-icon">📈</span>
                <div>
                  <div className="train-card-title">Pipeline Logit · WOE</div>
                  <div className="train-card-sub">
                    {datamartInfo.logit.n_rows.toLocaleString()} obs · {datamartInfo.logit.n_cols - 1} features WOE
                  </div>
                </div>
              </div>
              <button
                className="btn-train-run"
                style={{ '--btnc': '#6366f1' }}
                disabled={!!trainRunning['logit']}
                onClick={() => trainModel('logit')}
              >
                {trainRunning['logit'] ? '⏳ En cours…' : '↺ Relancer Logit'}
              </button>
            </div>

            <div className="train-config-card train-card-tree">
              <div className="train-card-header">
                <span className="train-card-icon">🌲</span>
                <div>
                  <div className="train-card-title">Pipeline Tree-based</div>
                  <div className="train-card-sub">
                    {datamartInfo.tree.n_rows.toLocaleString()} obs · {datamartInfo.tree.n_cols - 1} features
                  </div>
                </div>
              </div>
              <div className="train-config-field">
                <label>Modèles</label>
                <div className="train-model-checks">
                  {[['xgboost', '🌲 XGBoost'], ['lightgbm', '⚡ LightGBM'], ['random_forest', '🌳 Random Forest']].map(([m, l]) => (
                    <label key={m} className="train-check-label">
                      <input
                        type="checkbox"
                        checked={!!trainConfig.rawModels[m]}
                        onChange={e => setTrainConfig(c => ({
                          ...c, rawModels: { ...c.rawModels, [m]: e.target.checked }
                        }))}
                      />
                      {l}
                    </label>
                  ))}
                </div>
              </div>
              <div className="train-config-field">
                <label className="train-check-label">
                  <input
                    type="checkbox"
                    checked={trainConfig.usePca}
                    onChange={e => setTrainConfig(c => ({ ...c, usePca: e.target.checked }))}
                  />
                  Appliquer l'ACP (auto 95% variance)
                </label>
                {trainConfig.usePca && (
                  <input
                    className="train-ncomp-input"
                    type="number"
                    placeholder="Nombre de composantes (auto si vide)"
                    min={1}
                    value={trainConfig.nComponents ?? ''}
                    onChange={e => setTrainConfig(c => ({
                      ...c, nComponents: e.target.value ? parseInt(e.target.value) : null
                    }))}
                  />
                )}
              </div>
              <button
                className="btn-train-run"
                style={{ '--btnc': '#f59e0b' }}
                disabled={Object.values(trainRunning).some(Boolean)}
                onClick={() => Object.entries(trainConfig.rawModels).forEach(([m, en]) => {
                  if (en) trainModel(m)
                })}
              >
                ↺ Relancer tree-based
              </button>
            </div>
          </div>

          {phase === 'ready' && Object.keys(trainResults).length === 0 && (
            <button className="btn-dm-launch" onClick={launchTraining}>
              Entraîner tous les modèles →
            </button>
          )}

          {/* Résultats */}
          <div className="train-results-grid">
            {['logit', 'xgboost', 'lightgbm', 'random_forest'].map(m => {
              const hasResult = !!trainResults[m]
              const hasError  = !!trainErrors[m]
              const isRunning = !!trainRunning[m]
              if (!hasResult && !hasError && !isRunning) return null
              return (
                <ModelResultCard
                  key={m}
                  modelType={m}
                  result={trainResults[m]}
                  error={trainErrors[m]}
                  running={isRunning}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
