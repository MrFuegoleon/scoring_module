// ── Helpers ───────────────────────────────────────────────────────────────────
export const scoreColor = (s) => {
  if (s > 98) return '#00d4aa'
  if (s >= 95) return '#34d399'
  if (s >= 90) return '#f59e0b'
  if (s >= 80) return '#fb923c'
  return '#ff6b6b'
}

const gradeClass = (g) => {
  if (!g) return ''
  const map = {
    'Excellent':   'grade-excellent',
    'Très bonne':  'grade-tres-bonne',
    'Bonne':       'grade-bonne',
    'À améliorer': 'grade-ameliorer',
    'Critique':    'grade-critique',
  }
  return map[g] || ''
}

const pillarNames = {
  'completeness': { fr: 'Complétude', icon: '✓' },
  'uniqueness': { fr: 'Unicité', icon: '🔑' },
  'consistency': { fr: 'Cohérence', icon: '⚙' },
  'validity': { fr: 'Validité', icon: '✅' },
  'accuracy': { fr: 'Précision', icon: '🎯' },
  'timeliness': { fr: 'Actualité', icon: '📅' },
}

// ── Composant ScoreDisplay ────────────────────────────────────────────────────
export default function ScoreDisplay({ data }) {
  const qs     = data.quality_score
  const ov     = data.overview
  const alerts = data.alerts || []

  return (
    <div className="score-section">

      {/* Overview stats */}
      <div className="overview-grid">
        <div className="ov-card">
          <div className="ov-val">{ov.rows?.toLocaleString()}</div>
          <div className="ov-key">Lignes</div>
        </div>
        <div className="ov-card">
          <div className="ov-val">{ov.columns}</div>
          <div className="ov-key">Colonnes</div>
        </div>
        <div className="ov-card">
          <div className="ov-val" style={{ color: scoreColor(qs.global_score) }}>
            {qs.global_score}
          </div>
          <div className="ov-key">Score / 100</div>
        </div>
        <div className="ov-card">
          <div className="ov-val" style={{ fontSize: '1rem', paddingTop: '6px' }}>
            <span className={`score-grade ${gradeClass(qs.grade)}`}>{qs.grade}</span>
          </div>
          <div className="ov-key">Grade</div>
        </div>
      </div>

      {/* Score global + dimensions */}
      <div className="score-card">
        <div className="score-label" style={{ marginBottom: '0.5rem' }}>Score qualité global</div>
        <div className="score-bar-wrap">
          <div className="score-bar" style={{ width: `${qs.global_score}%`, background: scoreColor(qs.global_score) }} />
        </div>

        <div className="dimensions">
          {Object.entries(qs.dimensions || {}).map(([dim, info]) => {
            const p = pillarNames[dim] || { fr: dim, icon: '📊' }
            return (
              <div key={dim} className="dim-item">
                <div className="dim-top">
                  <span className="dim-name">{p.icon} {p.fr}</span>
                  <span className="dim-score" style={{ color: scoreColor(info.score) }}>{info.score}%</span>
                </div>
                <div className="dim-bar-wrap">
                  <div className="dim-bar" style={{ width: `${info.score}%`, background: scoreColor(info.score) }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Alertes */}
      {alerts.length > 0 && (
        <>
          <div className="section-title">⚠ Alertes ({alerts.length})</div>
          <div className="alerts-list">
            {alerts.map((a, i) => (
              <div key={i} className={`alert-item ${a.level === 'warning' ? 'alert-warning' : 'alert-info'}`}>
                <span className="alert-icon">{a.level === 'warning' ? '⚠' : 'ℹ'}</span>
                <span className="alert-msg">{a.message}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Tableau colonnes */}
      <div className="section-title">Analyse par colonne</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="col-table">
          <thead>
            <tr>
              <th>Colonne</th>
              <th>Type</th>
              <th>Manquants</th>
              <th>Complétude</th>
              <th>Uniques</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.columns_analysis || {}).map(([col, info]) => {
              const missingPct = info.missing_pct || 0
              const barColor   = missingPct > 30 ? '#ff6b6b' : missingPct > 10 ? '#f59e0b' : '#00d4aa'
              return (
                <tr key={col}>
                  <td style={{ fontWeight: 600, color: '#c8c8e8' }}>{col}</td>
                  <td><span className="type-badge">{info.semantic_type}</span></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <div className="missing-bar-wrap">
                        <div className="missing-bar" style={{ width: `${Math.min(missingPct, 100)}%`, background: barColor }} />
                      </div>
                      <span style={{ color: missingPct > 20 ? barColor : 'var(--muted)', fontSize: '0.68rem' }}>
                        {missingPct}%
                      </span>
                    </div>
                  </td>
                  <td style={{ color: scoreColor(info.completeness) }}>{info.completeness}%</td>
                  <td style={{ color: 'var(--muted)' }}>{info.n_unique}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
