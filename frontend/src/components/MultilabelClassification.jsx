import './MultilabelClassification.css'
import { useState, useRef } from 'react'

const API = '/api/multilabel'

const MODEL_OPTIONS = [
  { value: 'random_forest',       label: 'Random Forest',        desc: 'Robuste, importance des features' },
  { value: 'logistic_regression', label: 'Régression Logistique', desc: 'Rapide, interprétable' },
  { value: 'xgboost',             label: 'XGBoost',              desc: 'Performant sur données tabulaires' },
]

const STRATEGY_OPTIONS = [
  {
    value: 'multioutput',
    label: 'MultiOutputClassifier',
    desc: 'Un classifieur indépendant par label. Simple et parallélisable.',
  },
  {
    value: 'chain',
    label: 'ClassifierChain',
    desc: 'Chaîne de classifieurs : chaque modèle voit les prédictions des labels précédents. Capture les corrélations entre labels.',
  },
]

function ScoreBadge({ score }) {
  const color = score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#6b7280'
  return (
    <span className="ml-score-badge" style={{ background: color + '22', color }}>
      {score}%
    </span>
  )
}

function MetricCard({ label, value, sub, color }) {
  return (
    <div className="ml-metric-card">
      <div className="ml-metric-value" style={{ color: color || 'var(--text)' }}>{value}</div>
      <div className="ml-metric-label">{label}</div>
      {sub && <div className="ml-metric-sub">{sub}</div>}
    </div>
  )
}

function FeatureBar({ name, importance, max }) {
  const pct = max > 0 ? (importance / max) * 100 : 0
  return (
    <div className="ml-feat-row">
      <span className="ml-feat-name">{name}</span>
      <div className="ml-feat-bar-wrap">
        <div className="ml-feat-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="ml-feat-val">{(importance * 100).toFixed(2)}%</span>
    </div>
  )
}

// ── Graphiques SVG (même logique que DataModelling) ───────────────────────────
function RocCurve({ roc, color = '#6366f1' }) {
  if (!roc) return null
  const W = 220, H = 160, PAD = 22
  const pts = roc.fpr.map((x, i) => [
    PAD + x * (W - PAD),
    H - PAD - roc.tpr[i] * (H - PAD),
  ])
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ml-svg">
      <line x1={PAD} y1={H - PAD} x2={W} y2={PAD} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4,3" />
      <line x1={PAD} y1={PAD - 4} x2={PAD} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" />
      <line x1={PAD} y1={H - PAD} x2={W + 2} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" />
      <text x={PAD + 4} y={PAD + 10} fontSize="8" fill="#9ca3af">TPR</text>
      <text x={W - 24} y={H - PAD + 11} fontSize="8" fill="#9ca3af">FPR</text>
    </svg>
  )
}

function LiftCurve({ liftData, color = '#6366f1' }) {
  if (!liftData?.x) return null
  const W = 220, H = 160, PAD = 22
  const { x, lift } = liftData
  const maxLift = Math.max(...lift, 1)
  const d = lift.map((v, i) => {
    const sx = PAD + x[i] * (W - 2 * PAD)
    const sy = H - PAD - (v / maxLift) * (H - 2 * PAD)
    return `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`
  }).join(' ')
  const baselineY = H - PAD - (1 / maxLift) * (H - 2 * PAD)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ml-svg">
      <line x1={PAD} y1={PAD - 4} x2={PAD} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" />
      <line x1={PAD} y1={H - PAD} x2={W - PAD + 4} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" />
      <line x1={PAD} y1={baselineY} x2={W - PAD} y2={baselineY} stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="6,4" />
      <text x={W - PAD - 2} y={baselineY - 3} fontSize="7" fill="#9ca3af" textAnchor="end">aléatoire</text>
      <path d={d} fill="none" stroke={color} strokeWidth="2" />
      <text x={PAD + 2} y={PAD + 9} fontSize="8" fill="#9ca3af">{maxLift.toFixed(1)}×</text>
      <text x={PAD} y={H - PAD + 11} fontSize="7" fill="#9ca3af" textAnchor="middle">0%</text>
      <text x={W - PAD} y={H - PAD + 11} fontSize="7" fill="#9ca3af" textAnchor="middle">100%</text>
    </svg>
  )
}

function ProbDistribution({ dist, label }) {
  if (!dist?.group_0) return null
  const W = 220, H = 160, PAD = 22
  const { group_0, group_1, x } = dist
  const xArr = x ?? Array.from({ length: group_0.length }, (_, i) => i / (group_0.length - 1))
  const maxD = Math.max(...group_0, ...group_1) || 1
  const C0 = '#10b981', C1 = '#ef4444'
  function toPoints(kde) {
    return kde.map((d, i) => [PAD + xArr[i] * (W - 2 * PAD), H - PAD - (d / maxD) * (H - 2 * PAD)])
  }
  function linePath(pts) {
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  }
  function areaPath(pts) {
    const first = pts[0], last = pts[pts.length - 1]
    return `M${first[0].toFixed(1)},${H - PAD} ` + pts.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ` L${last[0].toFixed(1)},${H - PAD} Z`
  }
  const p0 = toPoints(group_0), p1 = toPoints(group_1)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ml-svg">
      <line x1={PAD} y1={PAD - 4} x2={PAD} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" />
      <line x1={PAD} y1={H - PAD} x2={W - PAD + 4} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" />
      <path d={areaPath(p0)} fill={C0} fillOpacity="0.15" />
      <path d={areaPath(p1)} fill={C1} fillOpacity="0.15" />
      <path d={linePath(p0)} fill="none" stroke={C0} strokeWidth="1.8" />
      <path d={linePath(p1)} fill="none" stroke={C1} strokeWidth="1.8" />
      <rect x={W - 80} y={PAD} width="7" height="7" rx="1" fill={C0} />
      <text x={W - 70} y={PAD + 6.5} fontSize="8" fill="#6b7280">Classe 0</text>
      <rect x={W - 80} y={PAD + 12} width="7" height="7" rx="1" fill={C1} />
      <text x={W - 70} y={PAD + 18.5} fontSize="8" fill="#6b7280">Classe 1</text>
      <text x={PAD} y={H - PAD + 11} fontSize="7" fill="#9ca3af" textAnchor="middle">0</text>
      <text x={PAD + (W - 2 * PAD) / 2} y={H - PAD + 11} fontSize="7" fill="#9ca3af" textAnchor="middle">0.5</text>
      <text x={W - PAD} y={H - PAD + 11} fontSize="7" fill="#9ca3af" textAnchor="middle">1</text>
    </svg>
  )
}

function ConfusionMatrix({ cm }) {
  if (!cm) return null
  const [[tn, fp], [fn, tp]] = cm
  const total = tn + fp + fn + tp
  return (
    <div className="ml-conf-matrix">
      <div className="ml-conf-row ml-conf-header">
        <span />
        <span className="ml-conf-pred">Prédit False</span>
        <span className="ml-conf-pred">Prédit True</span>
      </div>
      {[['Réel False', tn, fp, '#10b981', '#ef4444'],
        ['Réel True',  fn, tp, '#ef4444', '#10b981']].map(([lbl, a, b, ca, cb]) => (
        <div key={lbl} className="ml-conf-row">
          <span className="ml-conf-real">{lbl}</span>
          <span className="ml-conf-cell" style={{ background: ca + '22', color: ca }}>
            {a}<span className="ml-conf-pct"> {total ? (a / total * 100).toFixed(0) : 0}%</span>
          </span>
          <span className="ml-conf-cell" style={{ background: cb + '22', color: cb }}>
            {b}<span className="ml-conf-pct"> {total ? (b / total * 100).toFixed(0) : 0}%</span>
          </span>
        </div>
      ))}
    </div>
  )
}

const LABEL_TABS = ['ROC', 'Lift', 'Distribution', 'Matrice']

function LabelDetailCard({ row }) {
  const [open, setOpen]     = useState(false)
  const [tab, setTab]       = useState('ROC')

  const qualityColor = row.f1 >= 0.8 ? '#10b981' : row.f1 >= 0.6 ? '#f59e0b' : '#ef4444'
  const qualityLabel = row.f1 >= 0.8 ? 'Bon' : row.f1 >= 0.6 ? 'Moyen' : 'Faible'

  return (
    <div className={`ml-label-card ${open ? 'open' : ''}`}>
      {/* En-tête cliquable */}
      <button className="ml-label-card-header" onClick={() => setOpen(o => !o)}>
        <div className="ml-label-card-left">
          <span className="ml-chevron">{open ? '▾' : '▸'}</span>
          <code className="ml-col-name">{row.label}</code>
          <span className="ml-quality-badge" style={{ color: qualityColor, background: qualityColor + '20' }}>
            {qualityLabel}
          </span>
        </div>
        <div className="ml-label-card-metrics">
          <span className="ml-inline-metric">
            <span className="ml-inline-metric-label">AUC</span>
            <span className="ml-inline-metric-val" style={{ color: '#6366f1' }}>
              {row.auc != null ? (row.auc * 100).toFixed(1) + '%' : '—'}
            </span>
          </span>
          <span className="ml-inline-metric">
            <span className="ml-inline-metric-label">Gini</span>
            <span className="ml-inline-metric-val" style={{ color: '#8b5cf6' }}>
              {row.gini != null ? (row.gini * 100).toFixed(1) + '%' : '—'}
            </span>
          </span>
          <span className="ml-inline-metric">
            <span className="ml-inline-metric-label">KS</span>
            <span className="ml-inline-metric-val" style={{ color: '#3b82f6' }}>
              {row.ks != null ? (row.ks * 100).toFixed(1) + '%' : '—'}
            </span>
          </span>
          <span className="ml-inline-metric">
            <span className="ml-inline-metric-label">F1</span>
            <span className="ml-inline-metric-val">
              {(row.f1 * 100).toFixed(1)}%
            </span>
          </span>
          <span className="ml-inline-metric">
            <span className="ml-inline-metric-label">Support</span>
            <span className="ml-inline-metric-val">{row.support}</span>
          </span>
        </div>
      </button>

      {/* Corps déroulable */}
      {open && (
        <div className="ml-label-card-body">
          {row.optimal_threshold != null && (
            <div className="ml-threshold-hint">
              Seuil optimal : <strong>{row.optimal_threshold}</strong>
              {row.optimal_threshold !== 0.5 && <span className="ml-threshold-note"> (≠ 0.5 — ajusté automatiquement)</span>}
            </div>
          )}

          {/* Onglets */}
          <div className="ml-tabs">
            {LABEL_TABS.map(t => (
              <button
                key={t}
                className={`ml-tab ${tab === t ? 'active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="ml-tab-content">
            {tab === 'ROC' && (
              <div className="ml-chart-wrap">
                <RocCurve roc={row.roc_curve} color="#6366f1" />
                <div className="ml-chart-legend">
                  <span>AUC = <strong>{row.auc != null ? (row.auc * 100).toFixed(1) + '%' : '—'}</strong></span>
                  <span>Gini = <strong>{row.gini != null ? (row.gini * 100).toFixed(1) + '%' : '—'}</strong></span>
                </div>
              </div>
            )}
            {tab === 'Lift' && (
              <div className="ml-chart-wrap">
                <LiftCurve liftData={row.lift_curve} color="#6366f1" />
                <div className="ml-chart-legend">
                  <span>KS = <strong>{row.ks != null ? (row.ks * 100).toFixed(1) + '%' : '—'}</strong></span>
                </div>
              </div>
            )}
            {tab === 'Distribution' && (
              <div className="ml-chart-wrap">
                <ProbDistribution dist={row.prob_distribution} label={row.label} />
                <div className="ml-chart-legend">
                  <span>Distribution des probabilités prédites par classe réelle</span>
                </div>
              </div>
            )}
            {tab === 'Matrice' && (
              <div className="ml-chart-wrap">
                <ConfusionMatrix cm={row.confusion_matrix} />
                <div className="ml-threshold-hint" style={{ marginTop: '0.5rem' }}>
                  Seuil : <strong>{row.optimal_threshold}</strong>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function MultilabelClassification({ cleaningSession, theme }) {
  const [step, setStep]               = useState(0) // 0=idle, 1=detecting, 2=selecting, 3=training, 4=results
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)

  const [datasetInfo, setDatasetInfo] = useState(null)
  const [candidates, setCandidates]   = useState([])
  const [excluded, setExcluded]       = useState([])
  const [selected, setSelected]       = useState([])

  const [modelType, setModelType]     = useState('random_forest')
  const [strategy, setStrategy]       = useState('multioutput')
  const [results, setResults]         = useState(null)

  const trainAbortRef = useRef(null)

  // ── Step 1 : Détecter les cibles ──────────────────────────────────────────
  async function handleDetect() {
    if (!cleaningSession) return
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('session_id', cleaningSession)
      const r = await fetch(`${API}/detect-targets`, { method: 'POST', body: fd })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Erreur serveur')

      setDatasetInfo({ n_rows: data.n_rows, n_cols: data.n_cols })
      setCandidates(data.candidates || [])
      setExcluded(data.excluded || [])
      setSelected((data.candidates || []).filter(c => c.score >= 70).map(c => c.name))
      setStep(2)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2 : Entraîner ────────────────────────────────────────────────────
  async function handleTrain() {
    if (!selected.length) return
    const controller = new AbortController()
    trainAbortRef.current = controller
    setLoading(true)
    setError(null)
    setStep(3)
    try {
      const fd = new FormData()
      fd.append('session_id', cleaningSession)
      fd.append('target_cols', selected.join(','))
      fd.append('model_type', modelType)
      fd.append('strategy', strategy)
      const r = await fetch(`${API}/train`, { method: 'POST', body: fd, signal: controller.signal })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Erreur serveur')
      setResults(data)
      setStep(4)
    } catch (e) {
      if (e.name !== 'AbortError') {
        setError(e.message)
        setStep(2)
      }
    } finally {
      trainAbortRef.current = null
      setLoading(false)
    }
  }

  function toggleTarget(name) {
    setSelected(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    )
  }

  function reset() {
    if (trainAbortRef.current) trainAbortRef.current.abort()
    setStep(0); setError(null); setCandidates([]); setSelected([])
    setResults(null); setDatasetInfo(null); setStrategy('multioutput')
  }

  const noSession = !cleaningSession

  return (
    <div className="ml-page">

      {/* ── En-tête ── */}
      <div className="ml-header">
        <div>
          <h1>Multilabel Classification</h1>
          <p className="ml-subtitle">
            Détection automatique des cibles binaires · Entraînement multi-sorties
          </p>
        </div>
        {datasetInfo && (
          <div className="ml-header-right">
            <span className="ml-dataset-chip">
              <span className="ml-dot" />
              {datasetInfo.n_rows.toLocaleString()} lignes · {datasetInfo.n_cols} colonnes
            </span>
          </div>
        )}
      </div>

      {/* ── Pas de session ── */}
      {noSession && (
        <div className="ml-empty-state">
          <div className="ml-empty-icon">🔗</div>
          <div className="ml-empty-title">Aucune session active</div>
          <div className="ml-empty-sub">
            Chargez et nettoyez un dataset dans le module <strong>Data Cleaning</strong> avant de continuer.
          </div>
        </div>
      )}

      {/* ── Étape 0 : Lancer la détection ── */}
      {!noSession && step === 0 && (
        <div className="ml-launch-card">
          <div className="ml-launch-icon">🎯</div>
          <div className="ml-launch-title">Détection des cibles potentielles</div>
          <div className="ml-launch-desc">
            Le système va analyser chaque colonne du dataset nettoyé et lui attribuer un <strong>score de probabilité</strong> d'être une variable cible (cardinalité, type binaire, nom évocateur, déséquilibre de classes).
          </div>
          <button className="ml-btn-primary" onClick={handleDetect} disabled={loading}>
            {loading ? '⏳ Analyse en cours…' : '🔍 Détecter les cibles'}
          </button>
        </div>
      )}

      {/* ── Étape 2 : Sélection des cibles ── */}
      {step >= 2 && step < 4 && (
        <div className="ml-section">
          <div className="ml-section-header">
            <span className="ml-step-num">1</span>
            <div>
              <div className="ml-section-title">Colonnes candidates</div>
              <div className="ml-section-sub">{candidates.length} candidate(s) détectée(s) · {selected.length} sélectionnée(s)</div>
            </div>
          </div>

          {candidates.length === 0 && (
            <div className="ml-warn">
              Aucune colonne candidate détectée. Vérifiez que le dataset contient des colonnes binaires ou à faible cardinalité.
            </div>
          )}

          <div className="ml-candidates-grid">
            {candidates.map(c => {
              const checked = selected.includes(c.name)
              return (
                <label key={c.name} className={`ml-candidate-card ${checked ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTarget(c.name)}
                    className="ml-checkbox"
                  />
                  <div className="ml-cand-top">
                    <span className="ml-cand-name">{c.name}</span>
                    <ScoreBadge score={c.score} />
                  </div>
                  <div className="ml-cand-meta">
                    <span className="ml-tag">{c.dtype}</span>
                    <span className="ml-tag">{c.n_unique} valeurs</span>
                    {c.class_ratio != null && (
                      <span className="ml-tag">{(c.class_ratio * 100).toFixed(1)}% positifs</span>
                    )}
                  </div>
                  <div className="ml-cand-reasons">
                    {(c.reasons || []).map(r => (
                      <span key={r} className="ml-reason">{r}</span>
                    ))}
                  </div>
                </label>
              )
            })}
          </div>

          {/* Fix #6 : avertissement cibles non-binaires sélectionnées */}
          {(() => {
            const nonBinary = candidates.filter(c => selected.includes(c.name) && c.n_unique > 2)
            return nonBinary.length > 0 ? (
              <div className="ml-warn">
                ⚠ {nonBinary.map(c => c.name).join(', ')} {nonBinary.length > 1 ? 'ont' : 'a'} plus de 2 valeurs uniques — seules les cibles binaires (0/1) sont supportées. L'entraînement échouera.
              </div>
            ) : null
          })()}

          {excluded.length > 0 && (
            <details className="ml-excluded">
              <summary>Colonnes exclues ({excluded.length})</summary>
              <div className="ml-excluded-list">
                {excluded.map(e => (
                  <span key={e.name} className="ml-excl-chip" title={e.reason}>
                    {e.name} · <em>{e.reason}</em>
                  </span>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ── Étape 2 : Config modèle ── */}
      {step >= 2 && step < 4 && (
        <div className="ml-section">
          <div className="ml-section-header">
            <span className="ml-step-num">2</span>
            <div>
              <div className="ml-section-title">Stratégie multilabel</div>
              <div className="ml-section-sub">Comment les labels sont traités ensemble</div>
            </div>
          </div>

          <div className="ml-strategy-grid">
            {STRATEGY_OPTIONS.map(s => (
              <label key={s.value} className={`ml-strategy-card ${strategy === s.value ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="strategy"
                  value={s.value}
                  checked={strategy === s.value}
                  onChange={() => setStrategy(s.value)}
                  className="ml-radio"
                />
                <div className="ml-model-label">{s.label}</div>
                <div className="ml-model-desc">{s.desc}</div>
              </label>
            ))}
          </div>

          {strategy === 'chain' && selected.length < 2 && (
            <div className="ml-warn">
              ClassifierChain nécessite au moins 2 labels sélectionnés.
            </div>
          )}

          <div className="ml-section-header" style={{ marginTop: '0.5rem' }}>
            <span className="ml-step-num">3</span>
            <div>
              <div className="ml-section-title">Estimateur de base</div>
              <div className="ml-section-sub">Algorithme utilisé pour chaque classifieur</div>
            </div>
          </div>

          <div className="ml-model-grid">
            {MODEL_OPTIONS.map(m => (
              <label key={m.value} className={`ml-model-card ${modelType === m.value ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="model_type"
                  value={m.value}
                  checked={modelType === m.value}
                  onChange={() => setModelType(m.value)}
                  className="ml-radio"
                />
                <div className="ml-model-label">{m.label}</div>
                <div className="ml-model-desc">{m.desc}</div>
              </label>
            ))}
          </div>

          {error && <div className="ml-error">{error}</div>}

          <div className="ml-actions">
            <button className="ml-btn-secondary" onClick={reset}>
              Recommencer
            </button>
            <button
              className="ml-btn-primary"
              onClick={handleTrain}
              disabled={loading || selected.length === 0 || (strategy === 'chain' && selected.length < 2)}
            >
              {loading ? '⏳ Entraînement…' : `Entraîner (${selected.length} cible${selected.length > 1 ? 's' : ''})`}
            </button>
          </div>
        </div>
      )}

      {/* ── Étape 3 : Loading ── */}
      {step === 3 && loading && (
        <div className="ml-loading-card">
          <div className="ml-spinner" />
          <div className="ml-loading-title">Entraînement en cours…</div>
          <div className="ml-loading-sub">
            {strategy === 'chain' ? 'ClassifierChain' : 'MultiOutputClassifier'} · {selected.length} cible(s) · {modelType.replace(/_/g, ' ')}
          </div>
        </div>
      )}

      {/* ── Étape 4 : Résultats ── */}
      {step === 4 && results && (
        <>
          {/* Métriques globales */}
          <div className="ml-section">
            <div className="ml-section-header">
              <span className="ml-step-num">✓</span>
              <div>
                <div className="ml-section-title">Métriques globales</div>
                <div className="ml-section-sub">
                  {results.n_train} train · {results.n_test} test · {results.n_features} features
                  {' · '}<span className="ml-strategy-pill">{results.strategy === 'chain' ? 'ClassifierChain' : 'MultiOutputClassifier'}</span>
                </div>
              </div>
            </div>

            <div className="ml-metrics-grid">
              <MetricCard
                label="Hamming Loss"
                value={results.global_metrics.hamming_loss}
                sub="↓ plus bas = mieux"
                color={results.global_metrics.hamming_loss < 0.1 ? '#10b981' : '#f59e0b'}
              />
              <MetricCard
                label="Subset Accuracy"
                value={(results.global_metrics.subset_accuracy * 100).toFixed(1) + '%'}
                sub="Labels exacts"
                color="#6366f1"
              />
              <MetricCard
                label="F1 Micro"
                value={(results.global_metrics.f1_micro * 100).toFixed(1) + '%'}
                sub="Agrégé globalement"
                color="#3b82f6"
              />
              <MetricCard
                label="F1 Macro"
                value={(results.global_metrics.f1_macro * 100).toFixed(1) + '%'}
                sub="Moyenne par label"
                color="#8b5cf6"
              />
            </div>
          </div>

          {/* Résultats détaillés par label */}
          <div className="ml-section">
            <div className="ml-section-header">
              <span className="ml-step-num">2</span>
              <div>
                <div className="ml-section-title">Performances par label</div>
                <div className="ml-section-sub">Cliquer sur un label pour afficher ROC, Lift, Distribution, Matrice</div>
              </div>
            </div>
            <div className="ml-label-cards">
              {results.per_label.map(row => (
                <LabelDetailCard key={row.label} row={row} />
              ))}
            </div>
          </div>

          {/* Feature importance */}
          {results.feature_importance?.length > 0 && (
            <div className="ml-section">
              <div className="ml-section-header">
                <span className="ml-step-num">3</span>
                <div>
                  <div className="ml-section-title">Importance des features</div>
                  <div className="ml-section-sub">Top 15 · moyenne sur toutes les cibles</div>
                </div>
              </div>
              <div className="ml-feat-list">
                {(() => {
                  const maxImp = results.feature_importance[0]?.importance || 1
                  return results.feature_importance.map(f => (
                    <FeatureBar key={f.feature} name={f.feature} importance={f.importance} max={maxImp} />
                  ))
                })()}
              </div>
            </div>
          )}

          <div className="ml-actions">
            <button className="ml-btn-secondary" onClick={() => { setStep(2); setResults(null) }}>
              Modifier la sélection
            </button>
            <button className="ml-btn-secondary" onClick={reset}>
              Nouvelle analyse
            </button>
          </div>
        </>
      )}

      {/* Erreur globale */}
      {error && step === 0 && (
        <div className="ml-error">{error}</div>
      )}
    </div>
  )
}
