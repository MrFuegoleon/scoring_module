import { useState, useRef } from 'react'
import ScoreDisplay from './ScoreDisplay'
import { ProfileModal, useProfile } from './ProfileModal'

const fmtBytes = (b) => {
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1024 / 1024).toFixed(1) + ' MB'
}

const STEPS = [
  { id: 'upload',   label: 'Upload Dataset',    icon: '📁' },
  { id: 'quality',  label: 'Quality Analysis',  icon: '📊' },
  { id: 'llm',      label: 'LLM Analysis',      icon: '🤖' },
  { id: 'results',  label: 'Results',            icon: '✅' },
]

export default function DataQuality() {
  const [currentStep, setCurrentStep] = useState(0)

  // Data
  const [file, setFile]                     = useState(null)
  const [dragging, setDragging]             = useState(false)
  const [loading, setLoading]               = useState(false)
  const [loadingMsg, setLoadingMsg]         = useState('')
  const [qualityData, setQualityData]       = useState(null)
  const [llmAnalysis, setLlmAnalysis]       = useState(null)
  const [systemResult, setSystemResult]     = useState(null)
  const [showTextDesc, setShowTextDesc]     = useState(false)
  const [textDescription, setTextDescription] = useState('')
  const [descriptionFile, setDescriptionFile] = useState(null)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [pendingAction, setPendingAction]   = useState(null)

  const fileInputRef    = useRef()
  const descFileInputRef = useRef()
  const { openProfile, closeProfile, profileState } = useProfile()

  // ── File handlers ───────────────────────────────────────────────────────────
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

  const handleDescFileChange = (e) => {
    const f = e.target.files[0]
    if (f) setDescriptionFile(f)
  }

  // ── API calls ───────────────────────────────────────────────────────────────
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
    fd.append('file', dataFile || file)
    if (textDescription.trim()) fd.append('description', textDescription)
    try {
      const res = await fetch('/api/data-quality/llm-analyze', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setLlmAnalysis({ error: err.error || `Erreur HTTP ${res.status}` })
      } else {
        const data = await res.json()
        if (data.success) {
          const raw = data.analysis || {}
          setLlmAnalysis({
            ...raw,
            ...raw.executed,
            ...raw.initial,
            overall_assessment: raw.overall_assessment || raw.initial?.overall_assessment || raw.executed?.overall_assessment,
            recommendations: raw.recommendations || raw.initial?.recommendations || [],
            coherence: raw.coherence || raw.consistency || raw.executed?.consistency || raw.initial?.consistency,
          })
        } else setLlmAnalysis({ error: data.error || 'Erreur inconnue' })
      }
    } catch (e) {
      setLlmAnalysis({ error: e.message })
    }
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
    } catch (e) {
      setSystemResult({ error: e.message })
    }
    setLoading(false)
  }

  // ── Confirmation ─────────────────────────────────────────────────────────────
  const confirmAndExecute = async () => {
    setShowConfirmation(false)
    if (pendingAction === 'profile') openProfile(file)
    else if (pendingAction === 'report') await runReport()
    setPendingAction(null)
  }

  // ── Navigation ───────────────────────────────────────────────────────────────
  const goToStep = (i) => { if (i >= 0 && i < STEPS.length) setCurrentStep(i) }
  const nextStep = () => goToStep(currentStep + 1)
  const prevStep = () => goToStep(currentStep - 1)

  // ── Step content ─────────────────────────────────────────────────────────────
  const renderStep = () => {
    switch (currentStep) {

      case 0: // Upload
        return (
          <div className="step-content">
            <div className="upload-section">
              <div
                className={`upload-area ${dragging ? 'dragging' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="upload-content">
                  <div className="upload-icon">📁</div>
                  <h3>Upload votre dataset</h3>
                  <p>Glissez-déposez votre fichier CSV, Excel, JSON ou Parquet</p>
                  <p className="upload-or">— ou —</p>
                  <button className="upload-btn" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}>
                    Parcourir les fichiers
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,.json,.parquet"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />
                  <p style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
                    CSV · XLSX · JSON · PARQUET
                  </p>
                </div>
              </div>

              {file && (
                <div className="file-info">
                  <span>📄</span>
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">{fmtBytes(file.size)}</span>
                  <button className="clear-btn" onClick={(e) => { e.stopPropagation(); clearFile() }}>✕</button>
                </div>
              )}

              {/* Description optionnelle */}
              <div style={{ background: 'rgba(0,212,170,0.04)', border: '1px solid rgba(0,212,170,0.15)', borderRadius: '8px', padding: '0.85rem', fontSize: '0.78rem' }}>
                <span style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--muted)' }}>
                  ℹ Règles métiers pour le scoring (optionnel) :
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: '0.72rem', padding: '0.4rem 0.75rem' }}
                    onClick={() => { setShowTextDesc(false); setDescriptionFile(null); descFileInputRef.current?.click() }}
                  >
                    📎 Fichier
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: '0.72rem', padding: '0.4rem 0.75rem' }}
                    onClick={() => { setShowTextDesc(!showTextDesc); setDescriptionFile(null) }}
                  >
                    ✏️ Texte
                  </button>
                  {(showTextDesc || descriptionFile || textDescription) && (
                    <button
                      className="btn-secondary"
                      style={{ fontSize: '0.72rem', padding: '0.4rem 0.75rem', color: 'var(--accent3)', borderColor: 'rgba(255,107,107,0.3)' }}
                      onClick={() => { setShowTextDesc(false); setTextDescription(''); setDescriptionFile(null); if (descFileInputRef.current) descFileInputRef.current.value = '' }}
                    >
                      ✕ Effacer
                    </button>
                  )}
                </div>
                <input ref={descFileInputRef} type="file" accept=".txt,.md,.pdf,.doc,.docx" onChange={handleDescFileChange} style={{ display: 'none' }} />

                {descriptionFile && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--accent2)' }}>
                    📄 {descriptionFile.name}
                  </div>
                )}

                {showTextDesc && (
                  <textarea
                    style={{ marginTop: '0.5rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.6rem', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: '0.73rem', resize: 'vertical', width: '100%', minHeight: '80px' }}
                    placeholder="Description du dataset et règles métiers..."
                    value={textDescription}
                    onChange={(e) => setTextDescription(e.target.value)}
                  />
                )}
              </div>
            </div>
          </div>
        )

      case 1: // Quality Analysis
        return (
          <div className="step-content">
            <div className="analysis-section">
              <h3>Analyse de la qualité des données</h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                Lance un rapport complet : complétude, unicité, validité, cohérence, précision.
              </p>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  className="action-btn"
                  onClick={() => { setPendingAction('report'); setShowConfirmation(true) }}
                  disabled={!file || loading}
                >
                  {loading ? '🔄 Analyse...' : '🔍 Rapport complet'}
                </button>
                <button
                  className="btn-secondary"
                  style={{ fontSize: '0.78rem' }}
                  onClick={runPreview}
                  disabled={!file || loading}
                >
                  👁 Aperçu rapide
                </button>
                <button
                  className="btn-profile"
                  style={{ fontSize: '0.78rem' }}
                  onClick={() => { setPendingAction('profile'); setShowConfirmation(true) }}
                  disabled={!file || loading}
                >
                  📊 Rapport détaillé
                </button>
              </div>

              {loading && (
                <div className="loader">
                  <div className="spinner" />
                  {loadingMsg}
                </div>
              )}

              {qualityData && !qualityData.error && (
                <div className="results-container">
                  <ScoreDisplay data={qualityData} />
                </div>
              )}
              {qualityData?.error && (
                <div className="alert-item alert-warning" style={{ marginTop: '0.75rem' }}>
                  <span className="alert-icon">⚠</span>
                  <span className="alert-msg">{qualityData.error}</span>
                </div>
              )}
            </div>
          </div>
        )

      case 2: // LLM Analysis
        return (
          <div className="step-content">
            <div className="llm-section">
              <h3>Analyse LLM — Problèmes potentiels</h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                Détection intelligente d'anomalies, incohérences et recommandations.
              </p>

              <button
                className="action-btn llm-btn"
                onClick={() => runLlmAnalysis(null)}
                disabled={!file || loading}
              >
                {loading ? '🔄 Analyse LLM...' : '🤖 Lancer analyse LLM'}
              </button>

              {loading && (
                <div className="loader">
                  <div className="spinner" />
                  {loadingMsg}
                </div>
              )}

              {llmAnalysis && !llmAnalysis.error && (
                <div className="llm-results">
                  {llmAnalysis.overall_assessment && (
                    <div className="llm-assessment">
                      <h4>Évaluation globale</h4>
                      <p>{llmAnalysis.overall_assessment}</p>
                    </div>
                  )}

                  {['accuracy', 'coherence', 'validity'].map(pillar => {
                    const data = llmAnalysis[pillar]
                    if (!data?.issues?.length) return null
                    const names = { accuracy: '🎯 Précision', coherence: '⚙ Cohérence', validity: '✅ Validité' }
                    const avgPct = data.issues.reduce((s, i) => s + (i.percentage || 0), 0) / data.issues.length
                    const score = Math.max(0, 100 - avgPct)
                    const color = score >= 80 ? '#00d4aa' : score >= 60 ? '#f59e0b' : '#ff6b6b'
                    return (
                      <div key={pillar} className="pillar-result">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem' }}>
                          <h5>{names[pillar]}</h5>
                          <span style={{ background: color + '20', color, padding: '1px 8px', borderRadius: '10px', fontSize: '0.65rem', fontWeight: 600 }}>
                            {score.toFixed(1)}%
                          </span>
                        </div>
                        {data.issues.map((issue, idx) => (
                          <div key={idx} className="issue">
                            <span className={`severity ${issue.severity}`}>{issue.severity}</span>
                            <span>{issue.description || issue.title}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })}

                  {llmAnalysis.recommendations?.length > 0 && (
                    <div className="pillar-result">
                      <h5 style={{ marginBottom: '0.6rem' }}>💡 Recommandations</h5>
                      {llmAnalysis.recommendations.map((rec, idx) => (
                        <div key={idx} className="issue">
                          <span className={`severity ${rec.priority}`}>{rec.priority}</span>
                          <span>{rec.action}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {!llmAnalysis.recommendations?.length && !['accuracy','coherence','validity'].some(p => llmAnalysis[p]?.issues?.length) && (
                    <div className="alert-item alert-success">
                      <span className="alert-icon">✓</span>
                      <span>Aucune anomalie significative détectée.</span>
                    </div>
                  )}
                </div>
              )}

              {llmAnalysis?.error && (
                <div className="alert-item alert-warning" style={{ marginTop: '0.75rem' }}>
                  <span className="alert-icon">⚠</span>
                  <span className="alert-msg">LLM: {llmAnalysis.error}</span>
                </div>
              )}
            </div>
          </div>
        )

      case 3: // Results
        return (
          <div className="step-content">
            <div className="results-section">
              <h3>Résultats complets</h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                Aperçu rapide des données brutes et statistiques système.
              </p>

              <button
                className="action-btn"
                onClick={runPreview}
                disabled={!file || loading}
              >
                {loading ? '🔄 Chargement...' : '📋 Aperçu des données'}
              </button>

              {loading && (
                <div className="loader">
                  <div className="spinner" />
                  {loadingMsg}
                </div>
              )}

              {systemResult && !systemResult.error && (
                <pre className="raw-result">
                  {JSON.stringify(systemResult, null, 2)}
                </pre>
              )}
              {systemResult?.error && (
                <div className="alert-item alert-warning" style={{ marginTop: '0.75rem' }}>
                  <span className="alert-icon">⚠</span>
                  <span className="alert-msg">{systemResult.error}</span>
                </div>
              )}

              {/* Résumé final */}
              {(qualityData || llmAnalysis) && (
                <div style={{ marginTop: '1.5rem', background: 'rgba(0,212,170,0.06)', border: '1px solid rgba(0,212,170,0.2)', borderRadius: '10px', padding: '1.25rem' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--accent2)', fontWeight: 600, marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    ✅ Récapitulatif de l'analyse
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.78rem' }}>
                    {qualityData && !qualityData.error && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--muted)' }}>Rapport qualité</span>
                        <span style={{ color: 'var(--accent2)' }}>✓ Complété</span>
                      </div>
                    )}
                    {llmAnalysis && !llmAnalysis.error && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--muted)' }}>Analyse LLM</span>
                        <span style={{ color: 'var(--accent2)' }}>✓ Complété</span>
                      </div>
                    )}
                    {file && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--muted)' }}>Dataset</span>
                        <span style={{ color: 'var(--text)' }}>{file.name}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )

      default: return null
    }
  }

  return (
    <div className="data-quality-page">
      <div className="page-header">
        <h1>🔍 Data Quality</h1>
        <p>Analyse complète de la qualité des données avec insights IA</p>
      </div>

      {/* Steps Progress */}
      <div className="steps-progress">
        {STEPS.map((step, i) => (
          <div
            key={step.id}
            className={`step ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'completed' : ''}`}
            onClick={() => goToStep(i)}
          >
            <span className="step-icon">{i < currentStep ? '✓' : step.icon}</span>
            <span className="step-label">{step.label}</span>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="content-area">
        {renderStep()}
      </div>

      {/* Navigation Buttons */}
      <div className="navigation-buttons">
        <button className="nav-btn prev-btn" onClick={prevStep} disabled={currentStep === 0}>
          ← Précédent
        </button>

        <div className="step-indicator">
          <span>Étape {currentStep + 1} / {STEPS.length}</span>
          <div className="step-dots">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`step-dot ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'completed' : ''}`}
                onClick={() => goToStep(i)}
                style={{ cursor: 'pointer' }}
              />
            ))}
          </div>
        </div>

        <button className="nav-btn next-btn" onClick={nextStep} disabled={currentStep === STEPS.length - 1}>
          Suivant →
        </button>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmation && (
        <div className="loading-overlay" onClick={() => setShowConfirmation(false)}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem', maxWidth: '420px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
               onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: 'var(--font-sans)', fontSize: '1rem', fontWeight: 700, marginBottom: '1.25rem' }}>
              ✓ Confirmer l'action
            </h3>
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted)' }}>Dataset</span>
                <span>{file?.name} ({fmtBytes(file?.size || 0)})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted)' }}>Description</span>
                <span style={{ color: textDescription.trim() ? 'var(--text)' : descriptionFile ? 'var(--text)' : 'var(--muted)' }}>
                  {textDescription.trim() ? `Texte (${textDescription.length} car.)` : descriptionFile ? descriptionFile.name : 'Aucune'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center', display: 'flex' }} onClick={() => setShowConfirmation(false)}>
                Annuler
              </button>
              <button className="btn-confirm" style={{ flex: 1 }} onClick={confirmAndExecute} disabled={loading}>
                ✓ Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      <ProfileModal state={profileState} onClose={closeProfile} />
    </div>
  )
}
