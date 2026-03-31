import { useState, useRef } from 'react'
import { useProfile, ProfileModal } from './components/ProfileModal'
import ScoreDisplay from './components/ScoreDisplay'

// ── Styles ────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&family=Syne:wght@400;600;700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #0a0a0f;
    --bg2:       #111118;
    --bg3:       #1a1a24;
    --border:    #2a2a3a;
    --accent:    #6c63ff;
    --accent2:   #00d4aa;
    --accent3:   #ff6b6b;
    --warn:      #f59e0b;
    --text:      #e2e2f0;
    --muted:     #6b6b8a;
    --font-mono: 'JetBrains Mono', monospace;
    --font-sans: 'Syne', sans-serif;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-mono);
    min-height: 100vh;
    line-height: 1.6;
  }

  .app {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }

  /* ── Header ── */
  .header {
    border-bottom: 1px solid var(--border);
    padding-bottom: 1.5rem;
    margin-bottom: 2.5rem;
  }
  .header-tag {
    font-size: 0.65rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 0.4rem;
  }
  .header h1 {
    font-family: var(--font-sans);
    font-size: 2rem;
    font-weight: 800;
    background: linear-gradient(135deg, var(--text) 0%, var(--accent) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .header-sub {
    color: var(--muted);
    font-size: 0.78rem;
    margin-top: 0.3rem;
  }

  /* ── Compartiment Card ── */
  .compartment {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 12px;
    margin-bottom: 1.5rem;
    overflow: hidden;
  }
  .compartment-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg3);
    cursor: pointer;
    user-select: none;
  }
  .compartment-header:hover { background: #1f1f2e; }
  .comp-icon {
    width: 28px; height: 28px;
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.85rem;
    flex-shrink: 0;
  }
  .comp-icon.quality  { background: rgba(108,99,255,0.15); border: 1px solid rgba(108,99,255,0.3); }
  .comp-icon.system   { background: rgba(0,212,170,0.1);  border: 1px solid rgba(0,212,170,0.2); }
  .comp-icon.disabled { background: rgba(107,107,138,0.1); border: 1px solid rgba(107,107,138,0.2); }
  .comp-title {
    font-family: var(--font-sans);
    font-size: 0.9rem;
    font-weight: 700;
    flex: 1;
  }
  .comp-badge {
    font-size: 0.6rem;
    padding: 2px 8px;
    border-radius: 20px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .badge-active   { background: rgba(0,212,170,0.15); color: var(--accent2); border: 1px solid rgba(0,212,170,0.3); }
  .badge-soon     { background: rgba(107,107,138,0.1); color: var(--muted);   border: 1px solid var(--border); }
  .comp-chevron   { color: var(--muted); font-size: 0.75rem; transition: transform 0.2s; }
  .comp-chevron.open { transform: rotate(180deg); }
  .compartment-body { padding: 1.25rem; }

  /* ── Système de tests ── */
  .test-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  .test-btn {
    background: var(--bg3);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.6rem 1rem;
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
    display: flex; align-items: center; gap: 0.5rem;
  }
  .test-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .test-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Drop Zone ── */
  .drop-zone {
    border: 2px dashed var(--border);
    border-radius: 10px;
    padding: 2rem;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    background: var(--bg);
    position: relative;
  }
  .drop-zone.dragging {
    border-color: var(--accent);
    background: rgba(108,99,255,0.05);
  }
  .drop-zone:hover { border-color: #3a3a5a; }
  .drop-icon { font-size: 2rem; margin-bottom: 0.5rem; }
  .drop-label { font-size: 0.8rem; color: var(--muted); }
  .drop-label span { color: var(--accent); }
  .drop-formats { font-size: 0.65rem; color: var(--muted); margin-top: 0.3rem; letter-spacing: 0.05em; }
  .file-selected {
    display: flex; align-items: center; gap: 0.75rem;
    background: rgba(108,99,255,0.08);
    border: 1px solid rgba(108,99,255,0.25);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    margin-top: 0.75rem;
  }
  .file-name { font-size: 0.8rem; flex: 1; }
  .file-size { font-size: 0.7rem; color: var(--muted); }
  .file-clear {
    background: none; border: none; color: var(--muted);
    cursor: pointer; font-size: 1rem; padding: 0;
  }
  .file-clear:hover { color: var(--accent3); }

  /* ── Actions ── */
  .action-row {
    display: flex; gap: 0.75rem; margin-top: 1rem; flex-wrap: wrap;
  }
  .btn-primary {
    background: var(--accent);
    color: #fff;
    border: none;
    padding: 0.6rem 1.25rem;
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    display: flex; align-items: center; gap: 0.5rem;
  }
  .btn-primary:hover:not(:disabled) { background: #7c74ff; transform: translateY(-1px); }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
  .btn-secondary {
    background: var(--bg3);
    color: var(--text);
    border: 1px solid var(--border);
    padding: 0.6rem 1.25rem;
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-secondary:hover:not(:disabled) { border-color: var(--accent2); color: var(--accent2); }
  .btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-profile {
    background: transparent;
    color: var(--accent2);
    border: 1px solid rgba(0,212,170,0.35);
    padding: 0.6rem 1.25rem;
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    cursor: pointer;
    transition: all 0.15s;
    display: flex; align-items: center; gap: 0.5rem;
  }
  .btn-profile:hover:not(:disabled) { background: rgba(0,212,170,0.08); border-color: var(--accent2); }
  .btn-profile:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Loader ── */
  .loader {
    display: flex; align-items: center; gap: 0.75rem;
    color: var(--accent); font-size: 0.8rem; margin-top: 1rem;
  }
  .spinner {
    width: 16px; height: 16px;
    border: 2px solid rgba(108,99,255,0.2);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Score Card ── */
  .score-section { margin-top: 1.25rem; }
  .score-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1.25rem;
    margin-bottom: 1rem;
  }
  .score-label { font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; }
  .score-grade {
    font-size: 0.75rem;
    padding: 3px 10px;
    border-radius: 20px;
    font-weight: 600;
  }
  .grade-excellent { background: rgba(0,212,170,0.15); color: var(--accent2); border: 1px solid rgba(0,212,170,0.3); }
  .grade-acceptable { background: rgba(245,158,11,0.15); color: var(--warn); border: 1px solid rgba(245,158,11,0.3); }
  .grade-degraded  { background: rgba(255,107,107,0.15); color: #ff9090; border: 1px solid rgba(255,107,107,0.3); }
  .grade-critique  { background: rgba(255,107,107,0.2); color: var(--accent3); border: 1px solid rgba(255,107,107,0.4); }

  /* Score bar */
  .score-bar-wrap { background: var(--bg3); border-radius: 4px; height: 6px; margin-bottom: 1.25rem; overflow: hidden; }
  .score-bar { height: 100%; border-radius: 4px; transition: width 0.8s ease; }

  /* Dimensions */
  .dimensions { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; }
  .dim-item {
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.6rem 0.75rem;
  }
  .dim-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem; }
  .dim-name { font-size: 0.68rem; color: var(--muted); text-transform: capitalize; }
  .dim-score { font-size: 0.75rem; font-weight: 600; }
  .dim-bar-wrap { background: var(--bg); border-radius: 2px; height: 3px; }
  .dim-bar { height: 100%; border-radius: 2px; transition: width 0.6s ease; }

  /* ── Alertes ── */
  .alerts-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }
  .alert-item {
    display: flex; align-items: flex-start; gap: 0.6rem;
    padding: 0.65rem 0.85rem;
    border-radius: 8px;
    font-size: 0.75rem;
  }
  .alert-warning { background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.25); }
  .alert-info    { background: rgba(108,99,255,0.08); border: 1px solid rgba(108,99,255,0.2); }
  .alert-icon    { font-size: 0.85rem; flex-shrink: 0; margin-top: 1px; }
  .alert-msg     { color: var(--text); }

  /* ── Overview ── */
  .overview-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.6rem;
    margin-bottom: 1rem;
  }
  .ov-card {
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.75rem;
    text-align: center;
  }
  .ov-val {
    font-family: var(--font-sans);
    font-size: 1.4rem;
    font-weight: 700;
    color: var(--accent);
  }
  .ov-key { font-size: 0.65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 0.1rem; }

  /* ── Colonnes table ── */
  .section-title {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    margin-bottom: 0.6rem;
    margin-top: 1rem;
  }
  .col-table { width: 100%; border-collapse: collapse; font-size: 0.72rem; }
  .col-table th {
    text-align: left;
    padding: 0.4rem 0.6rem;
    color: var(--muted);
    font-weight: 400;
    border-bottom: 1px solid var(--border);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .col-table td {
    padding: 0.45rem 0.6rem;
    border-bottom: 1px solid rgba(42,42,58,0.5);
    vertical-align: middle;
  }
  .col-table tr:last-child td { border-bottom: none; }
  .col-table tr:hover td { background: rgba(108,99,255,0.04); }
  .type-badge {
    font-size: 0.6rem;
    padding: 1px 7px;
    border-radius: 10px;
    border: 1px solid var(--border);
    color: var(--muted);
    white-space: nowrap;
  }
  .missing-bar-wrap { background: var(--bg3); border-radius: 2px; height: 4px; width: 60px; display: inline-block; vertical-align: middle; }
  .missing-bar { height: 100%; border-radius: 2px; }

  /* ── Raw result (tests système) ── */
  .raw-result {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    font-size: 0.72rem;
    overflow-x: auto;
    margin-top: 0.75rem;
    color: var(--accent2);
    max-height: 300px;
    overflow-y: auto;
  }

  /* ── Modale profiling ── */
  .profile-overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,0.85);
    display: flex; flex-direction: column;
    animation: fadeIn 0.2s ease;
  }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
  .profile-modal-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.75rem 1.25rem;
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .profile-modal-title {
    font-family: var(--font-sans);
    font-size: 0.85rem;
    font-weight: 700;
    display: flex; align-items: center; gap: 0.5rem;
  }
  .profile-modal-actions { display: flex; gap: 0.5rem; }
  .btn-modal-close {
    background: rgba(255,107,107,0.1);
    color: var(--accent3);
    border: 1px solid rgba(255,107,107,0.3);
    padding: 0.4rem 0.85rem;
    border-radius: 6px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-modal-close:hover { background: rgba(255,107,107,0.2); }
  .btn-modal-dl {
    background: rgba(108,99,255,0.1);
    color: var(--accent);
    border: 1px solid rgba(108,99,255,0.3);
    padding: 0.4rem 0.85rem;
    border-radius: 6px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.15s;
    display: flex; align-items: center; gap: 0.4rem;
  }
  .btn-modal-dl:hover { background: rgba(108,99,255,0.2); }
  .profile-iframe {
    flex: 1;
    border: none;
    width: 100%;
    background: #fff;
  }
  .profile-loading {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: var(--bg);
    gap: 1rem;
    z-index: 10;
  }
  .profile-loading-text { font-size: 0.8rem; color: var(--muted); }
  .spinner-lg {
    width: 36px; height: 36px;
    border: 3px solid rgba(108,99,255,0.2);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  /* ── Responsive ── */
  @media (max-width: 640px) {
    .test-grid       { grid-template-columns: 1fr; }
    .dimensions      { grid-template-columns: 1fr; }
    .overview-grid   { grid-template-columns: repeat(2, 1fr); }
  }
`

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
  const [systemResult, setSystemResult] = useState(null)
  const [openComp, setOpenComp]       = useState({ quality: true, system: false })
  const fileInputRef = useRef()
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

  // ── Data Quality actions ─────────────────────────────────────────────────
  const runReport = async () => {
    if (!file) return
    setLoading(true); setLoadingMsg('Analyse qualité en cours...')
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/data-quality/report', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setQualityData({ error: err.error || `Erreur HTTP ${res.status}` })
      } else {
        const data = await res.json()
        if (data.success) setQualityData(data)
        else setQualityData({ error: data.error || 'Erreur inconnue' })
      }
    } catch (e) {
      setQualityData({ error: e.message })
    }
    setLoading(false)
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
      <style>{CSS}</style>
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

              {/* Fichier sélectionné */}
              {file && (
                <div className="file-selected">
                  <span>📄</span>
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">{fmtBytes(file.size)}</span>
                  <button className="file-clear" onClick={(e) => { e.stopPropagation(); clearFile() }}>✕</button>
                </div>
              )}

              {/* Actions */}
              <div className="action-row">
                <button className="btn-primary" onClick={runReport} disabled={!file || loading}>
                  🔍 Rapport complet
                </button>
                <button className="btn-secondary" onClick={runPreview} disabled={!file || loading}>
                  👁 Aperçu rapide
                </button>
                <button className="btn-profile" onClick={() => openProfile(file)} disabled={!file || loading}>
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
