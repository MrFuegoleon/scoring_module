import { useState, useCallback } from 'react'

// ── Calcule le SHA-256 du fichier côté browser (Web Crypto API) ───────────────
async function computeFileHash(file) {
  const buffer      = await file.arrayBuffer()
  const hashBuffer  = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Récupère la liste des rapports sauvegardés pour un hash donné ─────────────
async function fetchSavedReports(fileHash) {
  try {
    const res = await fetch(`/api/data-quality/reports?file_hash=${fileHash}`)
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

// ── Formate une date ISO en affichage lisible ─────────────────────────────────
function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// Hook useProfile
// ══════════════════════════════════════════════════════════════════════════════
export function useProfile() {
  const [profileState, setProfileState] = useState({
    open:           false,
    phase:          'picker',   // 'picker' | 'loading' | 'viewing' | 'error'
    html:           null,
    blobUrl:        null,
    filename:       '',
    fileHash:       null,
    theme:          'dark',
    savedReports:   [],
    loadingReports: false,
    currentReportId: null,
    fromCache:      false,
    error:          null,
  })

  /** Ouvre le modal : calcule le hash, récupère les rapports sauvegardés */
  const openProfile = useCallback(async (file, theme = 'dark') => {
    if (!file) return

    setProfileState({
      open: true, phase: 'picker',
      html: null, blobUrl: null,
      filename: file.name, fileHash: null,
      theme,
      savedReports: [], loadingReports: true,
      currentReportId: null, fromCache: false, error: null,
    })

    const fileHash = await computeFileHash(file)
    const saved    = await fetchSavedReports(fileHash)

    setProfileState(p => ({ ...p, fileHash, savedReports: saved, loadingReports: false }))
  }, [])

  /** Lance la génération d'un nouveau rapport via Flask */
  const generateNewReport = useCallback(async (file, theme = 'dark') => {
    setProfileState(p => ({ ...p, phase: 'loading', theme }))

    const fd = new FormData()
    fd.append('file', file)
    fd.append('theme', theme)

    try {
      const res = await fetch('/api/data-quality/profile?force=true', { method: 'POST', body: fd })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erreur serveur' }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const html        = await res.text()
      const reportId    = res.headers.get('X-Report-Id')
      const generatedAt = res.headers.get('X-Generated-At')
      const fromCache   = res.headers.get('X-From-Cache') === 'true'
      const blob        = new Blob([html], { type: 'text/html' })
      const blobUrl     = URL.createObjectURL(blob)

      setProfileState(p => ({
        ...p,
        phase: 'viewing',
        html,
        blobUrl,
        currentReportId: reportId,
        fromCache,
        // Ajouter en tête de liste si nouveau rapport
        savedReports: fromCache
          ? p.savedReports
          : [{ id: reportId, filename: p.filename, generated_at: generatedAt, file_hash: p.fileHash }, ...p.savedReports],
      }))
    } catch (e) {
      setProfileState(p => ({ ...p, phase: 'error', error: e.message }))
    }
  }, [])

  /** Charge un rapport sauvegardé depuis le disque */
  const loadSavedReport = useCallback(async (reportId) => {
    setProfileState(p => ({ ...p, phase: 'loading' }))
    try {
      const res = await fetch(`/api/data-quality/reports/${reportId}/html`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const html    = await res.text()
      const blob    = new Blob([html], { type: 'text/html' })
      const blobUrl = URL.createObjectURL(blob)
      setProfileState(p => ({ ...p, phase: 'viewing', html, blobUrl, currentReportId: reportId, fromCache: true }))
    } catch (e) {
      setProfileState(p => ({ ...p, phase: 'error', error: e.message }))
    }
  }, [])

  /** Supprime un rapport de la liste et du disque */
  const deleteReport = useCallback(async (reportId) => {
    try {
      await fetch(`/api/data-quality/reports/${reportId}`, { method: 'DELETE' })
      setProfileState(p => ({
        ...p,
        savedReports: p.savedReports.filter(r => r.id !== reportId),
      }))
    } catch (e) {
      console.error('Suppression échouée :', e)
    }
  }, [])

  /** Retourne au picker depuis la vue rapport */
  const backToPicker = useCallback(() => {
    setProfileState(p => {
      if (p.blobUrl) URL.revokeObjectURL(p.blobUrl)
      return { ...p, phase: 'picker', html: null, blobUrl: null, currentReportId: null }
    })
  }, [])

  /** Ferme le modal et libère les ressources */
  const closeProfile = useCallback(() => {
    setProfileState(prev => {
      if (prev.blobUrl) URL.revokeObjectURL(prev.blobUrl)
      return {
        open: false, phase: 'picker', html: null, blobUrl: null,
        filename: '', fileHash: null, savedReports: [], loadingReports: false,
        currentReportId: null, fromCache: false, error: null,
      }
    })
  }, [])

  return { openProfile, generateNewReport, loadSavedReport, deleteReport, backToPicker, closeProfile, profileState }
}

// ══════════════════════════════════════════════════════════════════════════════
// Composant ProfileModal
// ══════════════════════════════════════════════════════════════════════════════
export function ProfileModal({ state, onClose, onGenerateNew, onLoadReport, onDeleteReport, onBackToPicker }) {
  if (!state.open) return null

  const handleDownload = () => {
    if (!state.html) return
    const blob = new Blob([state.html], { type: 'text/html' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `profiling_${state.filename || 'report'}.html`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  return (
    <div className="profile-overlay">

      {/* ── Barre supérieure ── */}
      <div className="profile-modal-bar">
        <div className="profile-modal-title">
          <span>📊</span>
          Rapport ydata_profiling
          {state.filename && (
            <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.75rem' }}>
              — {state.filename}
            </span>
          )}
          {state.fromCache && state.phase === 'viewing' && (
            <span className="report-cache-badge">depuis cache</span>
          )}
        </div>
        <div className="profile-modal-actions">
          {state.phase === 'viewing' && (
            <>
              <button className="btn-modal-back" onClick={onBackToPicker}>
                ← Rapports
              </button>
              {state.html && (
                <button className="btn-modal-dl" onClick={handleDownload}>
                  ⬇ Télécharger HTML
                </button>
              )}
            </>
          )}
          <button className="btn-modal-close" onClick={onClose}>
            ✕ Fermer
          </button>
        </div>
      </div>

      {/* ── Contenu ── */}
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Phase : picker */}
        {state.phase === 'picker' && (
          <div className="report-picker">
            <div className="report-picker-header">
              <h3>Rapports disponibles</h3>
              <p style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                {state.filename}
              </p>
            </div>

            {state.loadingReports ? (
              <div className="report-picker-loading">
                <div className="spinner" /> Vérification du cache…
              </div>
            ) : (
              <>
                {/* Bouton générer nouveau */}
                <button className="report-gen-btn" onClick={onGenerateNew}>
                  <span className="report-gen-icon">+</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>Générer un nouveau rapport</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '2px' }}>
                      Lance ydata_profiling sur le dataset actuel (10–30s)
                    </div>
                  </div>
                </button>

                {/* Liste des rapports sauvegardés */}
                {state.savedReports.length > 0 && (
                  <div className="report-list">
                    <div className="report-list-label">
                      Rapports sauvegardés ({state.savedReports.length})
                    </div>
                    {state.savedReports.map((r, i) => (
                      <div key={r.id} className="report-item">
                        <button
                          className="report-item-main"
                          onClick={() => onLoadReport(r.id)}
                        >
                          <span className="report-item-icon">📄</span>
                          <div className="report-item-info">
                            <span className="report-item-date">{fmtDate(r.generated_at)}</span>
                            {i === 0 && <span className="report-item-badge">dernier</span>}
                          </div>
                        </button>
                        <button
                          className="report-item-delete"
                          onClick={() => onDeleteReport(r.id)}
                          title="Supprimer ce rapport"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {state.savedReports.length === 0 && (
                  <div className="report-picker-empty">
                    Aucun rapport sauvegardé pour ce dataset.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Phase : chargement */}
        {state.phase === 'loading' && (
          <div className="profile-loading">
            <div className="spinner-lg" />
            <div className="profile-loading-text">
              Génération du rapport ydata_profiling en cours…
              <br />
              <span style={{ fontSize: '0.7rem', color: 'var(--border)', marginTop: '0.3rem', display: 'block' }}>
                (peut prendre 10–30s selon la taille du dataset)
              </span>
            </div>
          </div>
        )}

        {/* Phase : erreur */}
        {state.phase === 'error' && (
          <div className="profile-loading">
            <div style={{ color: 'var(--accent3)', fontSize: '2rem' }}>⚠</div>
            <div style={{ color: 'var(--accent3)', fontSize: '0.8rem' }}>{state.error}</div>
            <button className="btn-modal-back" onClick={onBackToPicker} style={{ marginTop: '1rem' }}>
              ← Retour
            </button>
          </div>
        )}

        {/* Phase : visualisation */}
        {state.phase === 'viewing' && state.blobUrl && (
          <iframe
            className="profile-iframe"
            src={state.blobUrl}
            title="Rapport ydata_profiling"
            sandbox="allow-scripts allow-same-origin"
          />
        )}
      </div>
    </div>
  )
}
