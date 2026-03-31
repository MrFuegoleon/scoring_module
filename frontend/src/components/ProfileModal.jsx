import { useState, useCallback } from 'react'

// ── Hook useProfile ───────────────────────────────────────────────────────────
export function useProfile() {
  const [profileState, setProfileState] = useState({
    open: false,
    loading: false,
    html: null,
    blobUrl: null,
    filename: '',
    error: null,
  })

  const openProfile = useCallback(async (file) => {
    if (!file) return
    setProfileState({ open: true, loading: true, html: null, blobUrl: null, filename: file.name, error: null })
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/data-quality/profile', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erreur serveur' }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const html = await res.text()
      const blob = new Blob([html], { type: 'text/html' })
      const blobUrl = URL.createObjectURL(blob)
      setProfileState(p => ({ ...p, loading: false, html, blobUrl }))
    } catch (e) {
      setProfileState(p => ({ ...p, loading: false, error: e.message }))
    }
  }, [])

  const closeProfile = useCallback(() => {
    setProfileState(prev => {
      if (prev.blobUrl) URL.revokeObjectURL(prev.blobUrl)
      return { open: false, loading: false, html: null, blobUrl: null, filename: '', error: null }
    })
  }, [])

  return { openProfile, closeProfile, profileState }
}

// ── Composant ProfileModal ────────────────────────────────────────────────────
export function ProfileModal({ state, onClose }) {
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

      {/* Barre top */}
      <div className="profile-modal-bar">
        <div className="profile-modal-title">
          <span>📊</span>
          Rapport ydata_profiling
          {state.filename && (
            <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '0.75rem' }}>
              — {state.filename}
            </span>
          )}
        </div>
        <div className="profile-modal-actions">
          {state.html && (
            <button className="btn-modal-dl" onClick={handleDownload}>
              ⬇ Télécharger HTML
            </button>
          )}
          <button className="btn-modal-close" onClick={onClose}>
            ✕ Fermer
          </button>
        </div>
      </div>

      {/* Contenu */}
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>

        {state.loading && (
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

        {state.error && (
          <div className="profile-loading">
            <div style={{ color: 'var(--accent3)', fontSize: '2rem' }}>⚠</div>
            <div style={{ color: 'var(--accent3)', fontSize: '0.8rem' }}>{state.error}</div>
            <button className="btn-modal-close" onClick={onClose} style={{ marginTop: '1rem' }}>
              Fermer
            </button>
          </div>
        )}

        {/* Blob URL au lieu de srcdoc — évite le rechargement sur navigation hash */}
        {state.blobUrl && (
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
