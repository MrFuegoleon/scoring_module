import './App.css'
import { useState, useRef } from 'react'
import ScoreDisplay from './components/ScoreDisplay'
import { ProfileModal, useProfile } from './components/ProfileModal'
// ── Helper ────────────────────────────────────────────────────────────────────
const fmtBytes = (b) => {
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1024 / 1024).toFixed(1) + ' MB'
}

// ── App principale ────────────────────────────────────────────────────────────
export default function App() {
  const [file, setFile]               = useState(null)
  const [dragging, setDragging]       = useState(false)
  const [loading, setLoading]         = useState(false)
  const [loadingMsg, setLoadingMsg]   = useState('')
  const [qualityData, setQualityData] = useState(null)
  const [llmAnalysis, setLlmAnalysis] = useState(null)
  const [systemResult, setSystemResult] = useState(null)
  const [openComp, setOpenComp]       = useState({ quality: true, system: false })
  const [showTextDesc, setShowTextDesc] = useState(false)
  const [textDescription, setTextDescription] = useState('')
  const [descriptionFile, setDescriptionFile] = useState(null)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  
  const fileInputRef = useRef()
  const descFileInputRef = useRef()
  const { openProfile, closeProfile, profileState } = useProfile()

  const toggleComp = (key) => setOpenComp(p => ({ ...p, [key]: !p[key] }))

  // ── Upload handlers ──────────────────────────────────────────────────────
  const handleFileChange = (e) => {
    const f = e.target.files[0]
    if (f) { setFile(f); setQualityData(null) }
  }

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) { setFile(f); setQualityData(null) }
  }

  const clearFile = () => {
    setFile(null); setQualityData(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDescriptionFileChange = (e) => {
    const f = e.target.files[0]
    if (f) setDescriptionFile(f)
  }

  const clearDescription = () => {
    setShowTextDesc(false)
    setTextDescription('')
    setDescriptionFile(null)
    if (descFileInputRef.current) descFileInputRef.current.value = ''
  }

  const handleOpenProfileWithConfirmation = () => {
    if (!file) return
    setPendingAction('profile')
    setShowConfirmation(true)
  }

  const confirmAndExecuteAction = async () => {
    setShowConfirmation(false)
    
    if (pendingAction === 'profile') {
      openProfile(file)
    } else if (pendingAction === 'report') {
      await runReport()
    }
    
    setPendingAction(null)
  }

  // ── Data Quality actions ─────────────────────────────────────────────────
  const runReport = async () => {
    if (!file) return
    setLoading(true); setLoadingMsg('Analyse qualité en cours...')
    const fd = new FormData()
    fd.append('file', file)
    if (textDescription.trim()) fd.append('description', textDescription)
    if (descriptionFile) fd.append('descriptionFile', descriptionFile)
    
    try {
      const res = await fetch('/api/data-quality/report', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setQualityData({ error: err.error || `Erreur HTTP ${res.status}` })
      } else {
        const data = await res.json()
        if (data.success) {
          setQualityData(data)
          // Appeler LLM après le rapport
          setLoadingMsg('Analyse LLM en cours...')
          await runLlmAnalysis(file)
        } else {
          setQualityData({ error: data.error || 'Erreur inconnue' })
        }
      }
    } catch (e) {
      setQualityData({ error: e.message })
    }
    setLoading(false)
  }

  const runLlmAnalysis = async (dataFile) => {
    const fd = new FormData()
    fd.append('file', dataFile)
    if (textDescription.trim()) fd.append('description', textDescription)
    
    try {
      const res = await fetch('/api/data-quality/llm-analyze', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setLlmAnalysis({ error: err.error || `Erreur HTTP ${res.status}` })
      } else {
        const data = await res.json()
        if (data.success) setLlmAnalysis(data.analysis)
        else setLlmAnalysis({ error: data.error || 'Erreur inconnue' })
      }
    } catch (e) {
      setLlmAnalysis({ error: e.message })
    }
  }

  const handleOpenReportWithConfirmation = () => {
    if (!file) return
    setPendingAction('report')
    setShowConfirmation(true)
  }

  const runPreview = async () => {
    if (!file) return
    setLoading(true); setLoadingMsg('Chargement aperçu...')
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/data-quality/preview', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setSystemResult({ error: err.error || `Erreur HTTP ${res.status}` })
      } else {
        setSystemResult(await res.json())
      }
      setOpenComp(p => ({ ...p, system: true }))
    } catch (e) {
      setSystemResult({ error: e.message })
    }
    setLoading(false)
  }

  // ── System tests ─────────────────────────────────────────────────────────
  const testBackend = async () => {
    setLoading(true); setLoadingMsg('Test backend...')
    try {
      const res = await fetch('/api/test')
      if (!res.ok) setSystemResult({ error: `Erreur HTTP ${res.status}` })
      else setSystemResult(await res.json())
    } catch (e) { setSystemResult({ error: e.message }) }
    setLoading(false)
    setOpenComp(p => ({ ...p, system: true }))
  }

  const testPython = async () => {
    setLoading(true); setLoadingMsg('Test Python...')
    try {
      const res = await fetch('/api/python/test')
      if (!res.ok) setSystemResult({ error: `Erreur HTTP ${res.status}` })
      else setSystemResult(await res.json())
    } catch (e) { setSystemResult({ error: e.message }) }
    setLoading(false)
    setOpenComp(p => ({ ...p, system: true }))
  }

  return (
    <>
      <div className="app">

        {/* ── Header ── */}
        <div className="header">
          <div className="header-tag">Scoring Module · v0.1</div>
          <h1>Data Pipeline</h1>
          <div className="header-sub">Interface de test — Compartiments modulaires</div>
        </div>

        {/* ══ Compartiment 1 : Data Quality ══ */}
        <div className="compartment">
          <div className="compartment-header" onClick={() => toggleComp('quality')}>
            <div className="comp-icon quality">🔍</div>
            <span className="comp-title">Data Quality</span>
            <span className="comp-badge badge-active">Actif</span>
            <span className={`comp-chevron ${openComp.quality ? 'open' : ''}`}>▼</span>
          </div>

          {openComp.quality && (
            <div className="compartment-body">

              {/* Drop zone */}
              <div
                className={`drop-zone ${dragging ? 'dragging' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,.json,.parquet"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <div className="drop-icon">📂</div>
                <div className="drop-label">
                  Glisser un fichier ici ou <span>parcourir</span>
                </div>
                <div className="drop-formats">CSV · XLSX · JSON · PARQUET</div>
              </div>
              <div className="compartment-note">
                <span className="note-icon">ℹ</span>
                <span>
                  Règles métiers pour le scoring (ex: description de la data) :
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button 
                    className="btn-desc"
                    onClick={() => { setShowTextDesc(false); setTextDescription(''); if (descFileInputRef.current) descFileInputRef.current.click() }}
                    style={{ flex: 1 }}
                  >
                    📎 Uploader un fichier
                  </button>
                  <button 
                    className="btn-desc"
                    onClick={() => { setShowTextDesc(true); setDescriptionFile(null); if (descFileInputRef.current) descFileInputRef.current.value = '' }}
                    style={{ flex: 1 }}
                  >
                    ✏️ Écrire du texte
                  </button>
                  <button 
                    className="btn-desc"
                    onClick={clearDescription}
                    style={{ flex: 0.5 }}
                    title="Effacer la description"
                  >
                    ✕
                  </button>
                </div>
                <input
                  ref={descFileInputRef}
                  type="file"
                  accept=".txt,.md,.pdf,.doc,.docx"
                  onChange={handleDescriptionFileChange}
                  style={{ display: 'none' }}
                />
              </div>
              
              {/* Affichage de la description textuelle */}
              {showTextDesc && (
                <div className="text-description">
                  <textarea
                    placeholder="Entrez une description textuelle de la data et des règles métiers..."
                    value={textDescription}
                    onChange={(e) => setTextDescription(e.target.value)}
                    rows="4"
                  />
                </div>
              )}
              
              {/* Affichage du fichier description sélectionné */}
              {descriptionFile && (
                <div className="file-selected" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  <span>📄</span>
                  <span className="file-name">{descriptionFile.name}</span>
                  <span className="file-size">{fmtBytes(descriptionFile.size)}</span>
                </div>
              )}

              {/* Fichier sélectionné */}
              {file && (
                <div className="file-selected">
                  <span>📄</span>
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">{fmtBytes(file.size)}</span>
                  <button className="file-clear" onClick={(e) => { e.stopPropagation(); clearFile() }}>✕</button>
                </div>
              )}

              {/* Panneau de confirmation */}
              {showConfirmation && (
                <div className="confirmation-panel">
                  <div className="confirmation-content">
                    <h3>✓ Confirmer la description</h3>
                    <div className="confirmation-summary">
                      <div className="summary-item">
                        <span className="summary-label">📄 Dataset :</span>
                        <span className="summary-value">{file?.name} ({fmtBytes(file?.size || 0)})</span>
                      </div>
                      <div className="summary-item">
                        <span className="summary-label">📝 Description :</span>
                        <span className="summary-value">
                          {textDescription.trim() ? (
                            <>Texte ({textDescription.length} caractères)</>
                          ) : descriptionFile ? (
                            <>Fichier: {descriptionFile.name}</>
                          ) : (
                            <span style={{ color: 'var(--muted)' }}>Aucune</span>
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="confirmation-actions">
                      <button className="btn-cancel" onClick={() => setShowConfirmation(false)}>
                        Annuler
                      </button>
                      <button className="btn-confirm" onClick={confirmAndExecuteAction} disabled={loading}>
                        ✓ Confirmer
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="action-row">
                <button className="btn-primary" onClick={handleOpenReportWithConfirmation} disabled={!file || loading}>
                  🔍 Rapport complet
                </button>
                <button className="btn-secondary" onClick={runPreview} disabled={!file || loading}>
                  👁 Aperçu rapide
                </button>
                <button className="btn-profile" onClick={handleOpenProfileWithConfirmation} disabled={!file || loading}>
                  📊 Voir rapport détaillé
                </button>
              </div>

              {/* Loader */}
              {loading && (
                <div className="loader">
                  <div className="spinner" />
                  {loadingMsg}
                </div>
              )}

              {/* Résultat qualité */}
              {qualityData && !qualityData.error && <ScoreDisplay data={qualityData} />}
              {qualityData?.error && (
                <div className="alert-item alert-warning" style={{ marginTop: '0.75rem' }}>
                  <span className="alert-icon">⚠</span>
                  <span className="alert-msg">{qualityData.error}</span>
                </div>
              )}

              {/* Analyse LLM - Problèmes potentiels */}
              {llmAnalysis && !llmAnalysis.error && (
                <div className="llm-analysis-section" style={{ marginTop: '2rem' }}>
                  <div className="section-title">🤖 Analyse LLM - Problèmes Potentiels</div>
                  
                  {/* Évaluation globale */}
                  {llmAnalysis.overall_assessment && (
                    <div className="llm-assessment" style={{ background: 'rgba(108,99,255,0.05)', border: '1px solid rgba(108,99,255,0.2)', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text)', lineHeight: '1.6' }}>
                        {llmAnalysis.overall_assessment}
                      </p>
                    </div>
                  )}

                  {/* Problèmes par pilier */}
                  {['accuracy', 'coherence', 'validity'].map(pillar => {
                    const pillarData = llmAnalysis[pillar]
                    if (!pillarData?.issues?.length) return null
                    const pillarNames = { accuracy: '🎯 Précision', coherence: '⚙ Cohérence', validity: '✅ Validité' }
                    // Calculer le score basé sur les vrais pourcentages
                    const avgPercentage = pillarData.issues.reduce((sum, issue) => sum + (issue.percentage || 0), 0) / pillarData.issues.length
                    const score = Math.max(0, 100 - avgPercentage)
                    const color = score >= 80 ? '#00d4aa' : score >= 60 ? '#f59e0b' : '#ff6b6b'
                    
                    return (
                      <div key={pillar} style={{ marginBottom: '1.25rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{pillarNames[pillar]}</span>
                          <div style={{ background: color + '20', color: color, padding: '2px 8px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 600 }}>
                            {score.toFixed(1)}%
                          </div>
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {pillarData.issues.map((issue, idx) => (
                            <div key={idx} className={`llm-issue severity-${issue.severity}`} style={{ background: issue.severity === 'high' ? 'rgba(255,107,107,0.08)' : issue.severity === 'medium' ? 'rgba(245,158,11,0.08)' : 'rgba(108,99,255,0.08)', border: `1px solid ${issue.severity === 'high' ? 'rgba(255,107,107,0.25)' : issue.severity === 'medium' ? 'rgba(245,158,11,0.25)' : 'rgba(108,99,255,0.15)'}`, borderRadius: '6px', padding: '0.75rem' }}>
                              <div style={{ display: 'flex', alignItems: 'start', gap: '0.5rem' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: issue.severity === 'high' ? '#ff9090' : issue.severity === 'medium' ? '#f59e0b' : 'var(--accent)' }}>
                                  {issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🔵'}
                                </span>
                                <div style={{ flex: 1 }}>
                                  <p style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.25rem' }}>{issue.description}</p>
                                  {issue.affected_columns?.length > 0 && (
                                    <p style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                                      Colonnes affectées: <span style={{ color: 'var(--accent2)' }}>{issue.affected_columns.join(', ')}</span>
                                    </p>
                                  )}
                                  <p style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                                    Pourcentage affecté: <span style={{ color: issue.severity === 'high' ? '#ff9090' : issue.severity === 'medium' ? '#f59e0b' : 'var(--accent)', fontWeight: 600 }}>{issue.percentage}%</span>
                                  </p>
                                  {issue.examples?.length > 0 && (
                                    <p style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.3rem' }}>
                                      Exemples: <span style={{ fontFamily: 'monospace', fontSize: '0.65rem' }}>{issue.examples.slice(0, 2).join(', ')}</span>
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}

                  {/* Recommandations */}
                  {llmAnalysis.recommendations?.length > 0 && (
                    <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                      <div className="section-title">💡 Recommandations</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {llmAnalysis.recommendations.map((rec, idx) => (
                          <div key={idx} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem', fontSize: '0.78rem' }}>
                            <div style={{ fontWeight: 600, marginBottom: '0.3rem', color: rec.priority === 'high' ? '#ff9090' : rec.priority === 'medium' ? '#f59e0b' : 'var(--accent2)' }}>
                              {rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢'} {rec.action}
                            </div>
                            {rec.target_columns?.length > 0 && (
                              <p style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Cibles: {rec.target_columns.join(', ')}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {llmAnalysis?.error && (
                <div className="alert-item alert-warning" style={{ marginTop: '1.5rem' }}>
                  <span className="alert-icon">⚠</span>
                  <span className="alert-msg">LLM Analysis: {llmAnalysis.error}</span>
                </div>
              )}

            </div>
          )}
        </div>

        {/* ══ Compartiments futurs (locked) ══ */}
        {[
          { key: 'cleaning',  icon: '🧹', label: 'Data Cleaning' },
          { key: 'features',  icon: '⚙',  label: 'Feature Engineering' },
          { key: 'modeling',  icon: '🤖', label: 'Modeling' },
          { key: 'pipeline',  icon: '🔗', label: 'Pipeline Complet' },
        ].map(c => (
          <div key={c.key} className="compartment" style={{ opacity: 0.5 }}>
            <div className="compartment-header" style={{ cursor: 'default' }}>
              <div className="comp-icon disabled">{c.icon}</div>
              <span className="comp-title" style={{ color: 'var(--muted)' }}>{c.label}</span>
              <span className="comp-badge badge-soon">Bientôt</span>
            </div>
          </div>
        ))}

        {/* ══ Compartiment Système (tests) ══ */}
        <div className="compartment">
          <div className="compartment-header" onClick={() => toggleComp('system')}>
            <div className="comp-icon system">⚡</div>
            <span className="comp-title">Tests Système</span>
            <span className="comp-badge badge-active">Dev</span>
            <span className={`comp-chevron ${openComp.system ? 'open' : ''}`}>▼</span>
          </div>

          {openComp.system && (
            <div className="compartment-body">
              <div className="test-grid">
                <button className="test-btn" onClick={testBackend} disabled={loading}>
                  <span>⚡</span> Test Express
                </button>
                <button className="test-btn" onClick={testPython} disabled={loading}>
                  <span>🐍</span> Test Flask
                </button>
              </div>

              {systemResult && (
                <pre className="raw-result">
                  {JSON.stringify(systemResult, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>

      </div>
      <ProfileModal state={profileState} onClose={closeProfile} />
    </>
  )
}
