import PropTypes from 'prop-types'

// ── Helpers ──────────────────────────────────────────────────────────────────
const scoreColor = (s) => {
  if (s == null) return '#6b6b8a'
  if (s >= 90)   return '#00d4aa'
  if (s >= 75)   return '#f59e0b'
  if (s >= 60)   return '#ff9090'
  return '#ff6b6b'
}

const PILIERS = [
  { key: 'accuracy',  icon: '🎯', label: 'Exactitude' },
  { key: 'coherence', icon: '🔗', label: 'Cohérence métier' },
  { key: 'validity',  icon: '✅', label: 'Validité format' },
]

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  wrapper: {
    border: '1px solid rgba(108,99,255,0.2)',
    borderRadius: '10px',
    overflow: 'hidden',
    fontFamily: "'JetBrains Mono', monospace",
    backgroundColor: 'transparent',
  },
  header: {
    background: 'rgba(108,99,255,0.06)',
    borderBottom: '1px solid rgba(108,99,255,0.15)',
    padding: '0.75rem 1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
  },
  headerTitle: {
    fontFamily: "'Syne', sans-serif",
    fontSize: '0.85rem',
    fontWeight: 700,
    flex: 1,
    color: '#e2e2f0',
  },
  modelBadge: {
    fontSize: '0.6rem',
    padding: '2px 8px',
    borderRadius: '10px',
    background: 'rgba(108,99,255,0.15)',
    border: '1px solid rgba(108,99,255,0.3)',
    color: '#6c63ff',
    letterSpacing: '0.05em',
  },
  body: { padding: '1rem' },

  // Scores
  scoresGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '0.6rem',
    marginBottom: '1rem',
  },
  scoreCard: {
    background: 'rgba(10,10,15,0.8)',
    border: '1px solid #2a2a3a',
    borderRadius: '8px',
    padding: '0.75rem',
    textAlign: 'center',
  },
  scoreVal: {
    fontFamily: "'Syne', sans-serif",
    fontSize: '1.5rem',
    fontWeight: 700,
    lineHeight: 1,
  },
  scoreLabel: {
    fontSize: '0.65rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#6b6b8a',
    marginTop: '0.25rem',
  },

  // Assessment
  assessment: {
    background: 'rgba(10,10,15,0.8)',
    borderLeft: '3px solid #6c63ff',
    borderRadius: '0 8px 8px 0',
    padding: '0.75rem 1rem',
    fontSize: '0.78rem',
    color: '#e2e2f0',
    marginBottom: '1rem',
    lineHeight: 1.6,
  },

  // Section title
  sectionTitle: {
    fontSize: '0.68rem',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    color: '#6b6b8a',
    marginBottom: '0.5rem',
    marginTop: '0.75rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  },

  // Issue card
  issueCard: {
    background: 'rgba(10,10,15,0.8)',
    border: '1px solid #2a2a3a',
    borderRadius: '8px',
    padding: '0.65rem 0.85rem',
    marginBottom: '0.4rem',
    fontSize: '0.75rem',
  },
  issueTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '0.5rem',
    marginBottom: '0.3rem',
  },
  issueCol: {
    fontWeight: 600,
    color: '#6c63ff',
    fontSize: '0.72rem',
  },
  issueDesc: {
    color: '#e2e2f0',
    lineHeight: 1.5,
  },
  issueExamples: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.3rem',
    marginTop: '0.4rem',
  },
  issueExample: {
    background: '#1a1a24',
    border: '1px solid #2a2a3a',
    borderRadius: '4px',
    padding: '1px 6px',
    fontSize: '0.65rem',
    color: '#ff6b6b',
    fontFamily: "'JetBrains Mono', monospace",
  },

  // Severity badges
  sev: {
    fontSize: '0.6rem',
    padding: '1px 7px',
    borderRadius: '10px',
    flexShrink: 0,
  },
  sevHigh:   { background: 'rgba(255,107,107,0.15)', color: '#ff9090', border: '1px solid rgba(255,107,107,0.3)' },
  sevMedium: { background: 'rgba(245,158,11,0.15)',  color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' },
  sevLow:    { background: 'rgba(107,107,138,0.1)',  color: '#6b6b8a', border: '1px solid #2a2a3a' },

  noIssues: {
    fontSize: '0.75rem',
    color: '#00d4aa',
    padding: '0.25rem 0',
  },

  // Recommandations
  recoCard: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.6rem',
    background: 'rgba(10,10,15,0.8)',
    border: '1px solid #2a2a3a',
    borderRadius: '8px',
    padding: '0.65rem 0.85rem',
    fontSize: '0.75rem',
    marginBottom: '0.4rem',
  },
  recoAction: {
    color: '#e2e2f0',
    flex: 1,
    lineHeight: 1.5,
  },
  recoCols: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.2rem',
    marginTop: '0.3rem',
  },
  recoColTag: {
    fontSize: '0.6rem',
    background: 'rgba(0,212,170,0.08)',
    border: '1px solid rgba(0,212,170,0.2)',
    color: '#00d4aa',
    padding: '1px 6px',
    borderRadius: '4px',
  },

  // Error
  errorBox: {
    background: 'rgba(255,107,107,0.08)',
    border: '1px solid rgba(255,107,107,0.2)',
    borderRadius: '8px',
    padding: '0.75rem 1rem',
    fontSize: '0.75rem',
    color: '#ff9090',
  },
}

const sevStyle = (sev) => ({
  ...styles.sev,
  ...(sev === 'high' ? styles.sevHigh : sev === 'medium' ? styles.sevMedium : styles.sevLow)
})


// ── Sous-composants ──────────────────────────────────────────────────────────

function IssueCard({ issue, type }) {
  const cols = type === 'coherence'
    ? (issue.columns || []).join(', ')
    : (issue.column || '')

  return (
    <div style={styles.issueCard}>
      <div style={styles.issueTop}>
        <span style={styles.issueCol}>{cols}</span>
        <span style={sevStyle(issue.severity)}>
          {issue.severity || 'low'}
        </span>
      </div>
      <div style={styles.issueDesc}>{issue.description}</div>
      {issue.examples?.length > 0 && (
        <div style={styles.issueExamples}>
          {issue.examples.map((ex, i) => (
            <span key={i} style={styles.issueExample}>{String(ex)}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function PilierSection({ pilier, data }) {
  const issues = data?.issues || []
  const score  = data?.score

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={styles.sectionTitle}>
        <span>{pilier.icon}</span>
        <span>{pilier.label}</span>
        <span style={{ marginLeft: 'auto', color: scoreColor(score), fontWeight: 600 }}>
          {score ?? '—'}/100
        </span>
      </div>
      {issues.length === 0
        ? <div style={styles.noIssues}>✓ Aucun problème détecté</div>
        : issues.map((issue, i) => (
            <IssueCard key={i} issue={issue} type={pilier.key} />
          ))
      }
    </div>
  )
}


// ── Composant principal ───────────────────────────────────────────────────────

export default function LLMAnalysis({ data }) {
  if (!data) return null

  // Cas erreur
  if (data.error) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.header}>
          <span>🤖</span>
          <span style={styles.headerTitle}>Analyse LLM</span>
        </div>
        <div style={styles.body}>
          <div style={styles.errorBox}>⚠ {data.error}</div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.wrapper}>

      {/* Header */}
      <div style={styles.header}>
        <span>🤖</span>
        <span style={styles.headerTitle}>
          Analyse LLM — Exactitude · Cohérence · Validité
        </span>
        <span style={styles.modelBadge}>groq / llama-3.3-70b</span>
      </div>

      <div style={styles.body}>

        {/* Scores 3 piliers */}
        <div style={styles.scoresGrid}>
          {PILIERS.map(p => (
            <div key={p.key} style={styles.scoreCard}>
              <div style={{ ...styles.scoreVal, color: scoreColor(data[p.key]?.score) }}>
                {data[p.key]?.score ?? '—'}
              </div>
              <div style={styles.scoreLabel}>
                {p.icon} {p.label}
              </div>
            </div>
          ))}
        </div>

        {/* Assessment global */}
        {data.overall_assessment && (
          <div style={styles.assessment}>
            💬 {data.overall_assessment}
          </div>
        )}

        {/* Issues par pilier */}
        {PILIERS.map(p => (
          <PilierSection key={p.key} pilier={p} data={data[p.key]} />
        ))}

        {/* Recommandations */}
        {data.recommendations?.length > 0 && (
          <>
            <div style={{ ...styles.sectionTitle, marginTop: '0.5rem' }}>
              📋 Recommandations
            </div>
            {data.recommendations.map((r, i) => (
              <div key={i} style={styles.recoCard}>
                <span style={sevStyle(r.priority)}>{r.priority}</span>
                <div style={{ flex: 1 }}>
                  <div style={styles.recoAction}>{r.action}</div>
                  {r.target_columns?.length > 0 && (
                    <div style={styles.recoCols}>
                      {r.target_columns.map((c, j) => (
                        <span key={j} style={styles.recoColTag}>{c}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

      </div>
    </div>
  )
}

LLMAnalysis.propTypes = {
  data: PropTypes.shape({
    accuracy:           PropTypes.object,
    coherence:          PropTypes.object,
    validity:           PropTypes.object,
    recommendations:    PropTypes.array,
    overall_assessment: PropTypes.string,
    error:              PropTypes.string,
  })
}