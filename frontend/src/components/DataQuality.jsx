import { useState, useRef } from 'react'
import ScoreDisplay from './ScoreDisplay'
import { ProfileModal, useProfile } from './ProfileModal'

const fmtBytes = (b) => {
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1024 / 1024).toFixed(1) + ' MB'
}

// Parse la réponse preview en { columns, rows } quelle que soit la forme
const parsePreview = (data) => {
  if (!data) return null

  // Format { columns, data: [[...]] }
  if (Array.isArray(data.columns) && Array.isArray(data.data)) {
    return { columns: data.columns, rows: data.data }
  }
  // Format { columns, rows }
  if (Array.isArray(data.columns) && Array.isArray(data.rows)) {
    return { columns: data.columns, rows: data.rows }
  }
  // Format tableau d'objets (records) — direct ou sous une clé
  const records = Array.isArray(data)
    ? data
    : data.preview || data.records || data.sample || data.data

  if (Array.isArray(records) && records.length > 0 && typeof records[0] === 'object') {
    const columns = Object.keys(records[0])
    const rows = records.map(r => columns.map(c => r[c]))
    return { columns, rows }
  }
  // Format pandas orient=split  { index, columns, data }
  if (Array.isArray(data.columns) && Array.isArray(data.data)) {
    return { columns: data.columns, rows: data.data }
  }
  return null
}

const STEPS = [
  { id: 'upload',  label: 'Upload Dataset',   icon: '📁' },
  { id: 'quality', label: 'Quality Analysis', icon: '📊' },
]

// activeFile et setActiveFile viennent de App.jsx — ils persistent entre modules
export default function DataQuality({ activeFile, setActiveFile, theme = 'light' }) {
  const [currentStep, setCurrentStep] = useState(0)

  // Upload local (avant confirmation)
  const [pendingFile, setPendingFile]   = useState(null)
  const [dragging, setDragging]         = useState(false)

  // Preview — stocke TOUTES les lignes reçues, slice à l'affichage
  const [previewRows, setPreviewRows]   = useState(10)
  const [allPreviewData, setAllPreviewData] = useState(null)  // { columns, rows: all }
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(null)

  // Analyses
  const [loading, setLoading]           = useState(false)
  const [loadingMsg, setLoadingMsg]     = useState('')
  const [qualityData, setQualityData]   = useState(null)

  // Confirmation
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [pendingAction, setPendingAction]       = useState(null)

  const fileInputRef     = useRef()
  const { openProfile, generateNewReport, loadSavedReport, deleteReport, backToPicker, closeProfile, profileState } = useProfile()

  // Les lignes à afficher = slice du total reçu
  const displayedRows = allPreviewData
    ? { columns: allPreviewData.columns, rows: allPreviewData.rows.slice(0, previewRows) }
    : null

  // ── Handlers fichier ────────────────────────────────────────────────────────
  const handleFileChange = (e) => {
    const f = e.target.files[0]
    if (f) {
      setPendingFile(f)
      setAllPreviewData(null)
      setPreviewError(null)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) {
      setPendingFile(f)
      setAllPreviewData(null)
      setPreviewError(null)
    }
  }

  const confirmDataset = () => {
    setActiveFile(pendingFile)
    setPendingFile(null)
    setQualityData(null)
    setAllPreviewData(null)
  }

  const removeDataset = () => {
    setActiveFile(null)
    setPendingFile(null)
    setAllPreviewData(null)
    setPreviewError(null)
    setQualityData(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const changeDataset = () => {
    setActiveFile(null)
    setPendingFile(null)
    setAllPreviewData(null)
    setPreviewError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Aperçu rapide ─────────────────────────────────────────────────────────
  // Envoie n_rows=500 pour récupérer un max de lignes côté serveur,
  // puis on slice à previewRows côté frontend (réponse instantanée au changement)
  const runPreview = async () => {
    const f = activeFile || pendingFile
    if (!f) return
    setPreviewLoading(true)
    setPreviewError(null)
    setAllPreviewData(null)
    const fd = new FormData()
    fd.append('file', f)
    fd.append('n_rows', 500)   // récupère jusqu'à 500 lignes côté serveur
    try {
      const res = await fetch('/api/data-quality/preview', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setPreviewError(err.error || `Erreur HTTP ${res.status}`)
      } else {
        const data = await res.json()
        const parsed = parsePreview(data)
        if (parsed) setAllPreviewData(parsed)
        else setPreviewError('Format de réponse non reconnu. Vérifier la console.')
      }
    } catch (e) {
      setPreviewError(e.message)
    }
    setPreviewLoading(false)
  }

  // ── Rapport qualité ──────────────────────────────────────────────────────
  const runReport = async () => {
    if (!activeFile) return
    setLoading(true); setLoadingMsg('Analyse qualité en cours...')
    const fd = new FormData()
    fd.append('file', activeFile)
    try {
      const res = await fetch('/api/data-quality/report', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setQualityData({ error: err.error || `Erreur HTTP ${res.status}` })
      } else {
        const data = await res.json()
        setQualityData(data.success ? data : { error: data.error || 'Erreur inconnue' })
      }
    } catch (e) { setQualityData({ error: e.message }) }
    setLoading(false)
    setLoadingMsg('')
  }

  // ── Confirmation dialog ────────────────────────────────────────────────────
  const confirmAndExecute = async () => {
    setShowConfirmation(false)
    if (pendingAction === 'profile') openProfile(activeFile, theme)
    else if (pendingAction === 'report') await runReport()
    setPendingAction(null)
  }

  const goToStep = (i) => { if (i >= 0 && i < STEPS.length) setCurrentStep(i) }

  // ── Render ─────────────────────────────────────────────────────────────────
  const renderStep = () => {
    switch (currentStep) {

      // ─────────────────────────────────────────────────────────────────────
      case 0: // UPLOAD
        return (
          <div className="step-content">

            {/* ── Dataset actif ── */}
            {activeFile ? (
              <div className="active-dataset">
                <div className="active-dataset-header">
                  <div className="active-indicator">
                    <span className="active-dot" />
                    <span className="active-label">Dataset actif</span>
                  </div>
                  <div className="active-actions">
                    <button className="btn-change" onClick={changeDataset}>🔄 Changer</button>
                    <button className="btn-remove" onClick={removeDataset}>✕ Retirer</button>
                  </div>
                </div>
                <div className="active-file-info">
                  <span className="active-file-icon">📄</span>
                  <div className="active-file-meta">
                    <span className="active-file-name">{activeFile.name}</span>
                    <span className="active-file-size">{fmtBytes(activeFile.size)}</span>
                  </div>
                </div>
              </div>
            ) : (
              /* ── Zone d'upload ── */
              <div className="upload-section">
                <div
                  className={`upload-area ${dragging ? 'dragging' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => !pendingFile && fileInputRef.current?.click()}
                  style={{ cursor: pendingFile ? 'default' : 'pointer' }}
                >
                  <div className="upload-content">
                    <div className="upload-icon">📁</div>
                    <h3>Upload votre dataset</h3>
                    <p>Glissez-déposez votre fichier ici</p>
                    <p className="upload-or">— ou —</p>
                    <button className="upload-btn" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}>
                      Parcourir les fichiers
                    </button>
                    <p style={{ fontSize: '0.63rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
                      CSV · XLSX · JSON · PARQUET
                    </p>
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,.json,.parquet"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />

                {/* Fichier en attente de confirmation */}
                {pendingFile && (
                  <div className="pending-file">
                    <div className="pending-file-row">
                      <span className="pending-file-icon">📄</span>
                      <div className="pending-file-meta">
                        <span className="pending-file-name">{pendingFile.name}</span>
                        <span className="pending-file-size">{fmtBytes(pendingFile.size)}</span>
                      </div>
                      <button className="clear-btn" onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}>✕</button>
                    </div>
                    <button className="btn-set-active" onClick={confirmDataset}>
                      ✓ Définir comme dataset actif
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Aperçu rapide (uniquement ici) ── */}
            {(activeFile || pendingFile) && (
              <div className="preview-panel">
                <div className="preview-panel-header">
                  <span className="preview-title">👁 Aperçu rapide</span>
                  <div className="preview-controls">
                    <label className="preview-rows-label">Lignes :</label>
                    <input
                      type="number"
                      className="preview-rows-input"
                      value={previewRows}
                      min={1}
                      max={allPreviewData ? allPreviewData.rows.length : 500}
                      onChange={(e) => setPreviewRows(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    />
                    <button className="btn-preview" onClick={runPreview} disabled={previewLoading}>
                      {previewLoading ? '🔄' : '▶ Charger'}
                    </button>
                  </div>
                </div>

                {allPreviewData && (
                  <div style={{ fontSize: '0.63rem', color: 'var(--muted)' }}>
                    Affichage : {Math.min(previewRows, allPreviewData.rows.length)} / {allPreviewData.rows.length} lignes chargées
                    {allPreviewData.rows.length === 500 && ' (max 500 — changer pour voir plus)'}
                  </div>
                )}

                {previewLoading && (
                  <div className="loader" style={{ padding: '0.5rem 0' }}>
                    <div className="spinner" /> Chargement...
                  </div>
                )}

                {previewError && (
                  <div className="alert-item alert-warning">
                    <span className="alert-icon">⚠</span>
                    <span className="alert-msg">{previewError}</span>
                  </div>
                )}

                {displayedRows && (
                  <div className="preview-table-wrap">
                    <div className="preview-scroll">
                      <table className="preview-table">
                        <thead>
                          <tr>
                            <th className="preview-th-idx">#</th>
                            {displayedRows.columns.map((col, i) => <th key={i}>{col}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {displayedRows.rows.map((row, ri) => (
                            <tr key={ri}>
                              <td className="preview-td-idx">{ri + 1}</td>
                              {row.map((cell, ci) => (
                                <td key={ci} title={String(cell ?? '')}>
                                  {cell === null || cell === undefined
                                    ? <span className="cell-null">null</span>
                                    : String(cell).length > 40 ? String(cell).slice(0, 38) + '…' : String(cell)
                                  }
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )

      // ─────────────────────────────────────────────────────────────────────
      case 1: // QUALITY ANALYSIS
        return (
          <div className="step-content">
            <div className="analysis-section">
              <h3>Analyse de la qualité des données</h3>
              <p style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>
                Rapport complet : complétude, unicité, validité, cohérence, précision.
              </p>

              {!activeFile ? (
                <div className="alert-item alert-warning">
                  <span className="alert-icon">⚠</span>
                  <span className="alert-msg">Aucun dataset actif — allez à l'étape Upload.</span>
                </div>
              ) : (
                <>
                  <div className="active-dataset-mini">
                    <span className="active-dot" />
                    <span style={{ fontSize: '0.73rem', color: 'var(--muted)' }}>Dataset :</span>
                    <span style={{ fontSize: '0.73rem', color: 'var(--text)', fontWeight: 600 }}>{activeFile.name}</span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <button
                      className="action-btn"
                      onClick={() => { setPendingAction('report'); setShowConfirmation(true) }}
                      disabled={loading}
                    >
                      {loading && loadingMsg.includes('qualité') ? '🔄 Analyse...' : '🔍 Rapport complet'}
                    </button>
                    <button
                      className="btn-profile"
                      onClick={() => { setPendingAction('profile'); setShowConfirmation(true) }}
                      disabled={loading}
                    >
                      📊 Rapport détaillé
                    </button>
                  </div>

                  {loading && loadingMsg && (
                    <div className="loader"><div className="spinner" />{loadingMsg}</div>
                  )}

                  {qualityData && !qualityData.error && (
                    <div className="results-container"><ScoreDisplay data={qualityData} /></div>
                  )}
                  {qualityData?.error && (
                    <div className="alert-item alert-warning" style={{ marginTop: '0.75rem' }}>
                      <span className="alert-icon">⚠</span>
                      <span className="alert-msg">{qualityData.error}</span>
                    </div>
                  )}
                </>
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

      {/* Steps progress */}
      <div className="steps-progress">
        {STEPS.map((step, i) => (
          <button
            key={step.id}
            className={`step ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'completed' : ''}`}
            onClick={() => goToStep(i)}
          >
            <span className="step-icon">{i < currentStep ? '✓' : step.icon}</span>
            <span className="step-label">{step.label}</span>
          </button>
        ))}
      </div>

      {/* Contenu */}
      <div className="content-area">
        {renderStep()}
      </div>

      {/* Nav étapes */}
      <div className="navigation-buttons">
        <button className="nav-btn prev-btn" onClick={() => goToStep(currentStep - 1)} disabled={currentStep === 0}>
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
        <button className="nav-btn next-btn" onClick={() => goToStep(currentStep + 1)} disabled={currentStep === STEPS.length - 1}>
          Suivant →
        </button>
      </div>

      {/* Confirmation */}
      {showConfirmation && (
        <div className="loading-overlay" onClick={() => setShowConfirmation(false)}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <h3>✓ Confirmer l'action</h3>
            <div className="confirm-summary">
              <div className="confirm-row">
                <span>Dataset</span>
                <span>{activeFile?.name} ({fmtBytes(activeFile?.size || 0)})</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="btn-secondary" style={{ flex: 1, display: 'flex', justifyContent: 'center' }} onClick={() => setShowConfirmation(false)}>
                Annuler
              </button>
              <button className="btn-confirm" style={{ flex: 1 }} onClick={confirmAndExecute} disabled={loading}>
                ✓ Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      <ProfileModal
        state={profileState}
        onClose={closeProfile}
        onGenerateNew={() => generateNewReport(activeFile, theme)}
        onLoadReport={loadSavedReport}
        onDeleteReport={deleteReport}
        onBackToPicker={backToPicker}
      />
    </div>
  )
}
