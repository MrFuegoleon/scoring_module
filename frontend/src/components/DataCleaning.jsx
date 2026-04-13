import './DataCleaning.css'
import { useState } from 'react'

export default function DataCleaning({ activeFile, setActiveFile, theme = 'light' }) {

  const task = {
    doublons: "Suppression des doublons",
    missing: "Imputation des valeurs manquantes",
    outliers: "Détection et traitement des outliers",
    types: "Correction des types de données",
    text: "Nettoyage et normalisation du texte",
    categorical: "Encodage des variables catégorielles",
  }

  const [taskStatus, setTaskStatus] = useState({})
  const [logs, setLogs] = useState([])

  const updateTaskStatus = (taskKey, status) => {
    setTaskStatus(prev => ({ ...prev, [taskKey]: status }))
    setLogs(prev => [
      { id: `${taskKey}-${Date.now()}`, taskKey, status, label: task[taskKey], time: new Date().toLocaleTimeString() },
      ...prev,
    ])
  }

  async function launchCleaning(taskKey) {
    if (taskStatus[taskKey] === 'running') return
    updateTaskStatus(taskKey, 'running')
    await new Promise(resolve => setTimeout(resolve, 2000))
    updateTaskStatus(taskKey, 'done')
  }

  async function launchAllCleaning() {
    if (taskStatus.all === 'running') return
    updateTaskStatus('all', 'running')
    const keys = Object.keys(task)
    for (const key of keys) {
      await launchCleaning(key)
    }
    updateTaskStatus('all', 'done')
  }

  const renderStatus = (key) => {
    const status = taskStatus[key]
    if (status === 'running') return 'En cours'
    if (status === 'done') return 'Terminé'
    return 'En attente'
  }

  return (
    <div>
      <div className="page-header page-header-cleaning">
        <div>
          <h1>🧹 Data Cleaning</h1>
          <p>Nettoyez et prétraitez vos données pour une meilleure analyse</p>
        </div>
        <button className="global-action-btn" onClick={launchAllCleaning} title="Démarrer toutes les opérations">
          ⚡
        </button>
      </div>

      <div className="content-area cleaning-grid">
        <div className="cleaning-tasks-column">
          {Object.entries(task).map(([key, description]) => (
            <div key={key} className="cleaning-task">
              <div className="task-info">
                <div>
                  <h3>{description}</h3>
                  <div className="task-status">Statut : {renderStatus(key)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="cleaning-logs-column">
          <div className="cleaning-log-panel">
            <div className="cleaning-log-header">
              <h2>Journal de nettoyage</h2>
              <span className="log-badge">{logs.length} entrées</span>
            </div>
            <div className="cleaning-log-list">
              {logs.length === 0 ? (
                <div className="log-empty">Aucune action réalisée pour le moment.</div>
              ) : (
                logs.map(item => (
                  <div key={item.id} className="log-item">
                    <span className="log-time">{item.time}</span>
                    <span className="log-task">{item.label}</span>
                    <span className={`log-status log-status-${item.status}`}>
                      {item.status === 'running' ? 'En cours' : item.status === 'done' ? 'Terminé' : item.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
