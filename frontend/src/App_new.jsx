import './App.css'
import { useState } from 'react'
import DataQuality from './components/DataQuality'
import DataCleaning from './components/DataCleaning'
import DataModelling from './components/DataModelling'
import PipelineComplet from './components/PipelineComplet'

// ── App principale ─ Dashboard ────────────────────────────────────────────────
export default function App() {
  const [activeSection, setActiveSection] = useState('data-quality')

  const sections = [
    { id: 'data-quality', label: 'Data Quality', icon: '📊' },
    { id: 'data-cleaning', label: 'Data Cleaning', icon: '🧹' },
    { id: 'data-modelling', label: 'Data Modelling', icon: '🤖' },
    { id: 'pipeline-complet', label: 'Pipeline Complet', icon: '⚡' }
  ]

  const renderContent = () => {
    switch (activeSection) {
      case 'data-quality':
        return <DataQuality />
      case 'data-cleaning':
        return <DataCleaning />
      case 'data-modelling':
        return <DataModelling />
      case 'pipeline-complet':
        return <PipelineComplet />
      default:
        return <DataQuality />
    }
  }

  return (
    <div className="dashboard">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>🚀 SC Mod</h2>
          <p>Data Science Platform</p>
        </div>

        <nav className="sidebar-nav">
          {sections.map(section => (
            <button
              key={section.id}
              className={`nav-item ${activeSection === section.id ? 'active' : ''}`}
              onClick={() => setActiveSection(section.id)}
            >
              <span className="nav-icon">{section.icon}</span>
              <span className="nav-label">{section.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="status-indicator">
            <div className="status-dot online"></div>
            <span>Système opérationnel</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        {renderContent()}
      </div>
    </div>
  )
}