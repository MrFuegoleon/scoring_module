import './App.css'
import { useState } from 'react'
import DataQuality from './components/DataQuality'
import DataCleaning from './components/DataCleaning'
import DataModelling from './components/DataModelling'
import PipelineComplet from './components/PipelineComplet'

const NAV_ITEMS = [
  { key: 'quality',   label: 'Data Quality',    icon: '🔍', badge: 'Actif',   badgeClass: 'badge-active' },
  { key: 'cleaning',  label: 'Data Cleaning',   icon: '🧹', badge: 'Actif', badgeClass: 'badge-active' },
  { key: 'modelling', label: 'Data Modelling',  icon: '🤖', badge: 'Bientôt', badgeClass: 'badge-soon'   },
  { key: 'pipeline',  label: 'Pipeline Complet', icon: '⚡', badge: 'Bientôt', badgeClass: 'badge-soon'   },
]

const COMPONENTS = {
  quality:   DataQuality,
  cleaning:  DataCleaning,
  modelling: DataModelling,
  pipeline:  PipelineComplet,
}

export default function App() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [collapsed, setCollapsed]     = useState(false)
  const [theme, setTheme]             = useState('light')

  // Dataset global — persiste entre les modules
  const [activeFile, setActiveFile]   = useState(null)

  const activeNav = NAV_ITEMS[activeIndex]

  const goTo   = (i) => setActiveIndex(i)
  const goPrev = () => setActiveIndex(i => Math.max(0, i - 1))
  const goNext = () => setActiveIndex(i => Math.min(NAV_ITEMS.length - 1, i + 1))
  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  return (
    <div
      className={`dashboard ${collapsed ? 'sidebar-collapsed' : ''}`}
      data-theme={theme}
    >

      {/* ══ SIDEBAR ══ */}
      <aside className="sidebar">

        {/* Logo */}
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="logo-hex">⬡</div>
            {!collapsed && (
              <div className="logo-info">
                <span className="logo-title">DataPipeline</span>
                <span className="logo-sub">v0.1</span>
              </div>
            )}
          </div>
          <button
            className="sidebar-toggle"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Ouvrir' : 'Réduire'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        <div className="sidebar-divider" />

        {/* Nav items */}
        <nav className="sidebar-nav">
          {!collapsed && <div className="nav-section-label">Modules</div>}

          {NAV_ITEMS.map((item, idx) => (
            <button
              key={item.key}
              className={`nav-item ${activeIndex === idx ? 'active' : ''}`}
              onClick={() => goTo(idx)}
              title={collapsed ? item.label : undefined}
            >
              {activeIndex === idx && <span className="nav-active-indicator" />}
              <span className="nav-icon">{item.icon}</span>
              {!collapsed && (
                <>
                  <span className="nav-label">{item.label}</span>
                  <span className={`nav-badge ${item.badgeClass}`}>{item.badge}</span>
                </>
              )}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          {!collapsed ? (
            <div className="sidebar-footer-info">
              <span className="footer-dot" />
              <span className="footer-text">Scoring Module · Interface de test</span>
            </div>
          ) : (
            <div className="sidebar-footer-info" style={{ justifyContent: 'center' }}>
              <span className="footer-dot" />
            </div>
          )}
        </div>
      </aside>

      {/* ══ MAIN CONTENT ══ */}
      <div className="main-content">

        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-breadcrumb">
              <span className="breadcrumb-root">DataPipeline</span>
              <span className="breadcrumb-sep">›</span>
              <span className="breadcrumb-current">
                {activeNav.icon} {activeNav.label}
              </span>
            </div>
          </div>
          <div className="topbar-right">
            {activeFile && (
              <div className="topbar-dataset">
                <span className="active-dot" />
                <span className="topbar-dataset-name">{activeFile.name}</span>
              </div>
            )}
            <span className={`topbar-badge ${activeNav.badgeClass}`}>
              {activeNav.badge}
            </span>
            <button className="theme-toggle" onClick={toggleTheme} title="Changer le thème">
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </header>

        {/* Page */}
        <div className="page-wrapper">
          {NAV_ITEMS.map((item) => {
            const Comp = COMPONENTS[item.key]
            return (
              <div key={item.key} style={{ display: activeNav.key === item.key ? 'contents' : 'none' }}>
                <Comp activeFile={activeFile} setActiveFile={setActiveFile} theme={theme} />
              </div>
            )
          })}
        </div>

        {/* ══ Navigation entre modules ══ */}
        <footer className="module-nav">
          <button
            className="module-nav-btn prev"
            onClick={goPrev}
            disabled={activeIndex === 0}
          >
            <span className="mnav-arrow">←</span>
            {activeIndex > 0 && (
              <span className="mnav-info">
                <span className="mnav-hint">Précédent</span>
                <span className="mnav-name">{NAV_ITEMS[activeIndex - 1].icon} {NAV_ITEMS[activeIndex - 1].label}</span>
              </span>
            )}
            {activeIndex === 0 && <span className="mnav-info"><span className="mnav-hint" style={{ opacity: 0.3 }}>Premier module</span></span>}
          </button>

          {/* Dots indicateurs */}
          <div className="module-dots">
            {NAV_ITEMS.map((item, idx) => (
              <button
                key={item.key}
                className={`module-dot ${idx === activeIndex ? 'active' : ''} ${idx < activeIndex ? 'done' : ''}`}
                onClick={() => goTo(idx)}
                title={item.label}
              />
            ))}
          </div>

          <button
            className="module-nav-btn next"
            onClick={goNext}
            disabled={activeIndex === NAV_ITEMS.length - 1}
          >
            {activeIndex < NAV_ITEMS.length - 1 && (
              <span className="mnav-info" style={{ textAlign: 'right' }}>
                <span className="mnav-hint">Suivant</span>
                <span className="mnav-name">{NAV_ITEMS[activeIndex + 1].icon} {NAV_ITEMS[activeIndex + 1].label}</span>
              </span>
            )}
            {activeIndex === NAV_ITEMS.length - 1 && <span className="mnav-info"><span className="mnav-hint" style={{ opacity: 0.3 }}>Dernier module</span></span>}
            <span className="mnav-arrow">→</span>
          </button>
        </footer>
      </div>
    </div>
  )
}
