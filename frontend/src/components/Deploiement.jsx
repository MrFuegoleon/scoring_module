import './Deploiement.css'
import { useState, useEffect, useCallback, useRef } from 'react'

const MODEL_META = {
  logit:         { name: 'Régression Logistique', color: '#6366f1', icon: '📈' },
  xgboost:       { name: 'XGBoost',               color: '#f59e0b', icon: '🌲' },
  lightgbm:      { name: 'LightGBM',              color: '#10b981', icon: '⚡' },
  random_forest: { name: 'Random Forest',         color: '#3b82f6', icon: '🌳' },
}

function metaOf(t) { return MODEL_META[t] || { name: t, color: '#6b7280', icon: '🤖' } }

// ── Jauge de score ────────────────────────────────────────────────────────────
function ScoreGauge({ score, threshold, decision, positive }) {
  const pct = Math.round(score * 100)
  const thrPct = Math.round(threshold * 100)
  return (
    <div className="dep-gauge">
      <div className="dep-gauge-top">
        <span className="dep-gauge-score" style={{ color: positive ? '#ef4444' : '#10b981' }}>{pct}%</span>
        <span className={`dep-decision ${positive ? 'pos' : 'neg'}`}>{decision}</span>
      </div>
      <div className="dep-gauge-track">
        <div className="dep-gauge-fill" style={{ width: `${pct}%`, background: positive ? '#ef4444' : '#10b981' }} />
        <div className="dep-gauge-thr" style={{ left: `${thrPct}%` }} title={`Seuil ${threshold}`} />
      </div>
      <div className="dep-gauge-legend">
        <span>probabilité prédite</span>
        <span>seuil de décision : <strong>{threshold}</strong></span>
      </div>
    </div>
  )
}

export default function Deploiement({ active, onNavigate }) {
  const [models, setModels]       = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [selected, setSelected]   = useState(null)
  const [schema, setSchema]       = useState(null)
  const [form, setForm]           = useState({})
  const [tab, setTab]             = useState('form')
  const [predLoading, setPredLoading] = useState(false)
  const [single, setSingle]       = useState(null)
  const [batch, setBatch]         = useState(null)
  const [warning, setWarning]     = useState(null)
  const fileRef = useRef(null)

  const loadModels = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/deployment/models')
      console.log('Réponse du serveur :', r)
      const d = await r.json()
      if (!r.ok || !d.success) throw new Error(d.error || 'Erreur de chargement')
      setModels(d.models || [])
      setSelected(s => (s && d.models.some(m => m.model_id === s)) ? s : (d.models[0]?.model_id || null))
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { if (active) loadModels() }, [active, loadModels])

  // Charge le schéma du modèle sélectionné
  useEffect(() => {
    if (!selected) { setSchema(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/deployment/models/${selected}/schema`)
        const d = await r.json()
        if (!r.ok || !d.success) throw new Error(d.error || 'Schéma indisponible')
        if (cancelled) return
        setSchema(d)
        const init = {}
        for (const f of d.raw_schema) init[f.name] = f.kind === 'numeric' ? (f.median ?? '') : (f.categories?.[0] ?? '')
        setForm(init)
        setSingle(null); setBatch(null); setWarning(null)
      } catch (e) { if (!cancelled) setError(e.message) }
    })()
    return () => { cancelled = true }
  }, [selected])

  async function predictSingle() {
    setPredLoading(true); setError(null); setSingle(null)
    try {
      const fd = new FormData()
      fd.append('model_id', selected)
      fd.append('record', JSON.stringify(form))
      const r = await fetch('/api/deployment/predict', { method: 'POST', body: fd })
      const d = await r.json()
      if (!r.ok || !d.success) throw new Error(d.error || 'Erreur de prédiction')
      setSingle(d); setWarning(d.version_warning)
    } catch (e) { setError(e.message) } finally { setPredLoading(false) }
  }

  async function predictBatch(file) {
    if (!file) return
    setPredLoading(true); setError(null); setBatch(null)
    try {
      const fd = new FormData()
      fd.append('model_id', selected)
      fd.append('file', file)
      const r = await fetch('/api/deployment/predict', { method: 'POST', body: fd })
      const d = await r.json()
      if (!r.ok || !d.success) throw new Error(d.error || 'Erreur de prédiction')
      setBatch(d); setWarning(d.version_warning)
    } catch (e) { setError(e.message) } finally { setPredLoading(false) }
  }

  async function removeModel(id, e) {
    e.stopPropagation()
    if (!window.confirm('Supprimer ce modèle déployé ?')) return
    await fetch(`/api/deployment/models/${id}`, { method: 'DELETE' })
    loadModels()
  }

  const selectedMeta = models.find(m => m.model_id === selected)

  return (
    <div className="dep-page">
      <div className="dep-header">
        <div>
          <h1>🚀 Déploiement</h1>
          <p>Scorer de nouveaux clients avec un modèle entraîné et exporté</p>
        </div>
        <button className="dep-refresh" onClick={loadModels} disabled={loading}>↻ Rafraîchir</button>
      </div>

      {error && <div className="dep-error">⚠ {error}</div>}

      {/* Aucun modèle */}
      {!loading && models.length === 0 && (
        <div className="dep-empty">
          <div className="dep-empty-icon">📦</div>
          <h3>Aucun modèle déployé</h3>
          <p>Entraînez des modèles dans <strong>Data Modelling</strong>, puis cliquez sur <strong>🚀 Déployer</strong> dans la comparaison des modèles.</p>
          <button className="dep-btn-primary" onClick={() => onNavigate?.('modelling')}>Aller à Data Modelling →</button>
        </div>
      )}

      {models.length > 0 && (
        <div className="dep-layout">
          {/* ── Modèles déployés ── */}
          <div className="dep-models">
            <div className="dep-models-title">Modèles déployés ({models.length})</div>
            {models.map(m => {
              const meta = metaOf(m.model_type)
              const sel  = m.model_id === selected
              return (
                <div
                  key={m.model_id}
                  className={`dep-model-card ${sel ? 'selected' : ''}`}
                  style={sel ? { '--mc': meta.color } : {}}
                  onClick={() => setSelected(m.model_id)}
                >
                  <div className="dep-model-top">
                    <span className="dep-model-name" style={{ color: meta.color }}>{meta.icon} {meta.name}</span>
                    {m.meta?.auc_test != null && <span className="dep-model-auc">AUC {(m.meta.auc_test * 100).toFixed(1)}%</span>}
                  </div>
                  <div className="dep-model-sub">
                    <span>cible : <strong>{m.target_col}</strong></span>
                    {m.created_at && <span>{m.created_at.slice(0, 10)}</span>}
                  </div>
                  <div className="dep-model-actions">
                    <a className="dep-mini-link" href={`/api/deployment/models/${m.model_id}/download`} download onClick={e => e.stopPropagation()}>⬇ .joblib</a>
                    <button className="dep-mini-link danger" onClick={e => removeModel(m.model_id, e)}>🗑 supprimer</button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Panneau de prédiction ── */}
          <div className="dep-panel">
            {!schema ? (
              <div className="dep-panel-empty">Sélectionnez un modèle…</div>
            ) : (
              <>
                <div className="dep-panel-head">
                  <span className="dep-panel-title">
                    {metaOf(selectedMeta?.model_type).icon} Prédiction · {metaOf(selectedMeta?.model_type).name}
                  </span>
                  <span className="dep-panel-sub">{schema.raw_schema.length} variables · seuil {schema.threshold}</span>
                </div>

                {warning && <div className="dep-warning">⚠ Versions différentes — {warning}</div>}

                <div className="dep-tabs">
                  <button className={`dep-tab ${tab === 'form' ? 'active' : ''}`} onClick={() => setTab('form')}>👤 Un client</button>
                  <button className={`dep-tab ${tab === 'csv' ? 'active' : ''}`} onClick={() => setTab('csv')}>📄 Lot (CSV)</button>
                </div>

                {/* Formulaire */}
                {tab === 'form' && (
                  <div className="dep-form-wrap">
                    <div className="dep-form-grid">
                      {schema.raw_schema.map(f => (
                        <label key={f.name} className="dep-field">
                          <span className="dep-field-label">{f.name}</span>
                          {f.kind === 'numeric' ? (
                            <input
                              type="number" step="any"
                              value={form[f.name] ?? ''}
                              placeholder={f.median != null ? `méd. ${f.median}` : ''}
                              onChange={e => setForm(s => ({ ...s, [f.name]: e.target.value }))}
                            />
                          ) : (
                            <select value={form[f.name] ?? ''} onChange={e => setForm(s => ({ ...s, [f.name]: e.target.value }))}>
                              {(f.categories || []).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          )}
                        </label>
                      ))}
                    </div>
                    <button className="dep-btn-primary" onClick={predictSingle} disabled={predLoading}>
                      {predLoading ? '⏳ Calcul…' : 'Prédire le score'}
                    </button>
                    {single && (
                      <ScoreGauge score={single.score} threshold={single.threshold} decision={single.decision} positive={single.positive} />
                    )}
                  </div>
                )}

                {/* CSV */}
                {tab === 'csv' && (
                  <div className="dep-csv-wrap">
                    <div
                      className="dep-drop"
                      onClick={() => fileRef.current?.click()}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => { e.preventDefault(); predictBatch(e.dataTransfer.files?.[0]) }}
                    >
                      <input ref={fileRef} type="file" accept=".csv" hidden onChange={e => predictBatch(e.target.files?.[0])} />
                      <span className="dep-drop-icon">📄</span>
                      <span>{predLoading ? 'Scoring en cours…' : 'Glissez un CSV de clients (mêmes colonnes brutes) ou cliquez'}</span>
                    </div>

                    {batch && (
                      <>
                        <div className="dep-batch-stats">
                          <div className="dep-stat"><span className="dep-stat-val">{batch.n_rows}</span><span className="dep-stat-lbl">lignes</span></div>
                          <div className="dep-stat"><span className="dep-stat-val" style={{ color: '#ef4444' }}>{batch.n_positive}</span><span className="dep-stat-lbl">positifs</span></div>
                          <div className="dep-stat"><span className="dep-stat-val">{(batch.rate * 100).toFixed(1)}%</span><span className="dep-stat-lbl">taux</span></div>
                          <div className="dep-stat"><span className="dep-stat-val">{batch.threshold}</span><span className="dep-stat-lbl">seuil</span></div>
                        </div>
                        {batch.download_id && (
                          <a
                            className="dep-btn-primary dep-download-btn"
                            href={`/api/deployment/results/${batch.download_id}/download`}
                            download
                          >
                            ⬇ Télécharger le dataset scoré (trié par score décroissant + déciles)
                          </a>
                        )}
                        <div className="dep-table-scroll">
                          <table className="dep-table">
                            <thead>
                              <tr>
                                <th>#</th>
                                {batch.columns.map(c => <th key={c}>{c}</th>)}
                                <th className="dep-th-score">score</th>
                                <th className="dep-th-score">décile</th>
                              </tr>
                            </thead>
                            <tbody>
                              {batch.preview.map((row, i) => (
                                <tr key={i}>
                                  <td className="dep-td-idx">{i + 1}</td>
                                  {batch.columns.map(c => <td key={c}>{row[c] == null ? '—' : String(row[c])}</td>)}
                                  <td className="dep-td-score">{(row.score * 100).toFixed(1)}%</td>
                                  <td>
                                    <span className={`dep-decile dec-${row.Dp}`} title={`Décile ${row.Dp} (1 = probas les plus élevées)`}>D{row.Dp}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {batch.n_rows > batch.preview.length && (
                          <div className="dep-table-note">Aperçu des {batch.preview.length} premières lignes sur {batch.n_rows}.</div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
