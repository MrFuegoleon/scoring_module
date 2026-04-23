import './DataCleaning.css'
import { useState, useRef, useEffect } from 'react'

// ── Utilitaires ───────────────────────────────────────────────────────────────
const fmtBytes = (b) => {
  if (!b) return '—'
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1024 / 1024).toFixed(1) + ' MB'
}

// ── Options de type pour le dropdown ─────────────────────────────────────────
const TYPE_OPTIONS = [
  { value: 'int8',             label: 'ℤ int8    · entier  (-128 à 127)'   },
  { value: 'int16',            label: 'ℤ int16   · entier  (-32k à 32k)'   },
  { value: 'int32',            label: 'ℤ int32   · entier  (-2M à 2M)'     },
  { value: 'int64',            label: 'ℤ int64   · grand entier'           },
  { value: 'float32',          label: 'ℝ float32 · décimal 32 bits'        },
  { value: 'float64',          label: 'ℝ float64 · décimal 64 bits'        },
  { value: 'bool',             label: '✓ bool    · booléen (True / False)' },
  { value: 'datetime64[ns]',   label: '📅 datetime · date et heure'        },
  { value: 'category',         label: '🏷 category · faible cardinalité'   },
  { value: 'object',           label: '○ object  · texte libre'            },
  { value: 'object (ID/Code)', label: '🔑 ID/Code · garder comme texte'   },
]

// ── Méta visuelle par type ────────────────────────────────────────────────────
const getTypeMeta = (typeStr) => {
  if (!typeStr) return { label: 'Inconnu',    color: '#6b7280', icon: '○' }
  const t = typeStr.toLowerCase()
  if (t.includes('datetime'))        return { label: 'Date',          color: '#3b82f6', icon: '📅' }
  if (t === 'bool')                  return { label: 'Booléen',       color: '#8b5cf6', icon: '✓'  }
  if (t === 'category')              return { label: 'Catégorie',     color: '#f59e0b', icon: '🏷'  }
  if (t.includes('id/code'))         return { label: 'ID / Code',     color: '#64748b', icon: '🔑' }
  if (t.includes('id/string'))       return { label: 'ID / Texte',    color: '#64748b', icon: '🔤' }
  if (/^int(8|16|32|64)?$/.test(t))  return { label: `Entier · ${t}`,  color: '#6366f1', icon: 'ℤ'  }
  if (/^float(32|64)?$/.test(t))     return { label: `Flottant · ${t}`, color: '#818cf8', icon: 'ℝ'  }
  if (/^(uint|int|float)/.test(t))   return { label: 'Numérique',     color: '#6366f1', icon: '#'  }
  return { label: 'Texte', color: '#6b7280', icon: '○' }
}

// ── Sous-composants partagés ──────────────────────────────────────────────────
function StatChip({ value, label, color }) {
  return (
    <div className="stat-chip">
      <span className="stat-chip-num" style={color ? { color } : {}}>{value}</span>
      <span className="stat-chip-label">{label}</span>
    </div>
  )
}

function HeroBanner({ icon, variant, title, sub }) {
  return (
    <div className={`hero-banner hero-${variant}`}>
      <span className="hero-icon">{icon}</span>
      <div>
        <div className="hero-title">{title}</div>
        {sub && <div className="hero-sub">{sub}</div>}
      </div>
    </div>
  )
}

function PreviewTable({ rows }) {
  if (!rows || rows.length === 0) return null
  const cols = Object.keys(rows[0])
  return (
    <details className="preview-details">
      <summary>👁 Aperçu des données (5 premières lignes)</summary>
      <div className="preview-table-wrap">
        <table className="preview-table">
          <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {cols.map((c, j) => (
                  <td key={j}>
                    {row[c] == null
                      ? <span className="cell-null">null</span>
                      : String(row[c]).length > 32 ? String(row[c]).slice(0, 30) + '…' : String(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

// ── Section types dans le modal ───────────────────────────────────────────────
function TypesReviewSection({ detectData, userTypes, onTypeChange }) {
  if (!detectData) return null
  const entries   = Object.entries(detectData.type_report || {})
  const nModified = entries.filter(([col]) =>
    userTypes[col] !== detectData.type_report[col]?.detected_type
  ).length

  return (
    <div className="modal-section">
      <div className="modal-section-header">
        <h3>🔧 Correction des types</h3>
        <div className="modal-section-chips">
          <span className="rsummary-chip rsummary-info">
            {entries.length} colonnes · {detectData.statistics?.rows_count ?? '—'} lignes
          </span>
          {nModified > 0 && (
            <span className="rsummary-chip rsummary-mod">
              ✏ {nModified} modifié{nModified > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="review-table">
        <div className="review-table-head">
          <span>Colonne</span>
          <span>Type original</span>
          <span>Proposé</span>
          <span>Confiance</span>
          <span>Type à appliquer</span>
        </div>
        <div className="review-table-body">
          {entries.map(([col, report]) => {
            const proposed   = report.detected_type
            const selected   = userTypes[col] ?? proposed
            const isModified = selected !== proposed
            const meta       = getTypeMeta(proposed)
            const conf       = report.confidence ?? 0
            const confColor  = conf >= 90 ? '#10b981' : conf >= 70 ? '#f59e0b' : '#ef4444'

            return (
              <div key={col} className={`review-table-row ${isModified ? 'row-modified' : ''}`}>
                <span className="rcol-name" title={col}>
                  {isModified && <span className="modified-dot" title="Type modifié par l'utilisateur" />}
                  {col}
                </span>
                <code className="rcol-orig">{report.original_dtype}</code>
                <div className="rcol-proposed">
                  <span className="type-chip" style={{ '--chip-color': meta.color }}>
                    {meta.icon} {meta.label}
                  </span>
                </div>
                <div className="rcol-conf">
                  <div className="conf-bar-track">
                    <div className="conf-bar-fill" style={{ width: `${conf}%`, background: confColor }} />
                  </div>
                  <span className="conf-pct" style={{ color: confColor }}>{conf}%</span>
                </div>
                <select
                  className={`type-select ${isModified ? 'select-modified' : ''}`}
                  value={selected}
                  onChange={e => onTypeChange(col, e.target.value)}
                >
                  {TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Section doublons dans le modal ────────────────────────────────────────────
function DoublonsReviewSection({ doublonsReport, selectedPk, onPkChange }) {
  if (!doublonsReport) return null
  const found       = doublonsReport.duplicates_found ?? 0
  const pct         = doublonsReport.percentage_removed ?? 0
  const suggestedPk = doublonsReport.suggested_pk
  const allColumns  = doublonsReport.all_columns ?? []
  const candidates  = doublonsReport.high_cardinality_candidates ?? []

  return (
    <div className="modal-section">
      <div className="modal-section-header">
        <h3>🔁 Suppression des doublons</h3>
        <div className="modal-section-chips">
          {suggestedPk
            ? <span className="rsummary-chip rsummary-ok">🔑 Clé proposée · {selectedPk || suggestedPk}</span>
            : <span className="rsummary-chip rsummary-mod">⚠ Aucune clé détectée · toutes colonnes</span>
          }
        </div>
      </div>

      <div className={`doublon-hero ${found > 0 ? 'doublon-hero-warn' : 'doublon-hero-ok'}`}>
        <span className="doublon-hero-icon">{found > 0 ? '⚠' : '✓'}</span>
        <div>
          <div className="doublon-hero-title">
            {found > 0
              ? `${found} doublon${found > 1 ? 's' : ''} détecté${found > 1 ? 's' : ''} — seront supprimés à la confirmation`
              : 'Aucun doublon détecté — données déjà uniques'}
          </div>
          <div className="doublon-hero-sub">
            {found > 0
              ? `${doublonsReport.initial_rows} lignes → ${doublonsReport.rows_after} lignes (${pct}% supprimé) · `
              : ''}
            {selectedPk
              ? `Clé choisie : ${selectedPk}`
              : suggestedPk
                ? `Clé suggérée : ${suggestedPk}`
                : 'Méthode : toutes les colonnes'}
          </div>
        </div>
      </div>

      {/* Sélection de la clé primaire */}
      <div className="doublon-pk-selector">
        <div className="doublon-pk-label">
          <span>🔑 Colonne identifiant unique (clé primaire)</span>
          {candidates.length > 0 && (
            <span className="doublon-pk-hint">
              {candidates.length} colonne{candidates.length > 1 ? 's' : ''} avec cardinalité ≥ 90 % détectée{candidates.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <select
          className="doublon-pk-select"
          value={selectedPk ?? suggestedPk ?? ''}
          onChange={e => onPkChange(e.target.value || null)}
        >
          <option value="">— Toutes les colonnes (pas de clé)</option>
          {allColumns.map(col => {
            const candidate = candidates.find(c => c.column === col)
            return (
              <option key={col} value={col}>
                {col}{candidate ? ` — cardinalité ${(candidate.cardinality_ratio * 100).toFixed(1)}%` : ''}
              </option>
            )
          })}
        </select>
        {suggestedPk && !selectedPk && (
          <p className="doublon-pk-suggestion">
            Suggestion automatique basée sur la cardinalité : <strong>{suggestedPk}</strong>
          </p>
        )}
      </div>
    </div>
  )
}

// ── Section outliers dans le modal ────────────────────────────────────────────
function OutliersReviewSection({ outliersReport, strategy, onStrategyChange }) {
  if (!outliersReport) return null
  const entries  = Object.entries(outliersReport)
  const nCols    = entries.length
  const totalOut = entries.reduce((sum, [, r]) => sum + r.outliers_count, 0)

  return (
    <div className="modal-section">
      <div className="modal-section-header">
        <h3>📊 Détection des outliers</h3>
        <div className="modal-section-chips">
          {nCols > 0
            ? <span className="rsummary-chip rsummary-mod">⚠ {nCols} colonne{nCols > 1 ? 's' : ''} affectée{nCols > 1 ? 's' : ''}</span>
            : <span className="rsummary-chip rsummary-ok">✓ Aucun outlier</span>
          }
        </div>
      </div>

      {nCols === 0 ? (
        <div className="outlier-hero outlier-hero-ok">
          <span className="outlier-hero-icon">✓</span>
          <div>
            <div className="outlier-hero-title">Aucun outlier détecté — toutes les colonnes numériques sont propres</div>
          </div>
        </div>
      ) : (
        <>
          <div className="outlier-hero outlier-hero-warn">
            <span className="outlier-hero-icon">⚠</span>
            <div>
              <div className="outlier-hero-title">
                {totalOut} valeur{totalOut > 1 ? 's' : ''} aberrante{totalOut > 1 ? 's' : ''} détectée{totalOut > 1 ? 's' : ''} sur {nCols} colonne{nCols > 1 ? 's' : ''}
              </div>
              <div className="outlier-hero-sub">
                Analyse IQR · Q1 − 1.5×IQR / Q3 + 1.5×IQR
              </div>
            </div>
          </div>

          {/* Sélection de la stratégie */}
          <div className="outlier-strategy-box">
            <div className="outlier-strategy-label">Méthode de traitement</div>
            <div className="outlier-strategy-options">
              <label className={`strategy-option ${strategy === 'drop' ? 'strategy-option-active' : ''}`}>
                <input
                  type="radio"
                  name="outlier_strategy"
                  value="drop"
                  checked={strategy === 'drop'}
                  onChange={() => onStrategyChange('drop')}
                />
                <span className="strategy-option-icon">🗑</span>
                <div>
                  <div className="strategy-option-title">Suppression des lignes</div>
                  <div className="strategy-option-sub">Retire chaque ligne contenant au moins un outlier</div>
                </div>
              </label>
              <label className={`strategy-option ${strategy === 'winsorise' ? 'strategy-option-active' : ''}`}>
                <input
                  type="radio"
                  name="outlier_strategy"
                  value="winsorise"
                  checked={strategy === 'winsorise'}
                  onChange={() => onStrategyChange('winsorise')}
                />
                <span className="strategy-option-icon">📌</span>
                <div>
                  <div className="strategy-option-title">Winsorisation (IQR)</div>
                  <div className="strategy-option-sub">Remplace les outliers par les valeurs aux bornes</div>
                </div>
              </label>
            </div>
          </div>

          <div className="outlier-review-table">
            <div className="outlier-review-head">
              <span>Colonne</span>
              <span>Outliers</span>
              <span>Borne basse</span>
              <span>Borne haute</span>
              <span>Min / Max actuels</span>
            </div>
            <div className="outlier-review-body">
              {entries.map(([col, r]) => (
                <div key={col} className="outlier-review-row">
                  <span className="orcol-name" title={col}>{col}</span>
                  <span className="orcol-count">
                    <span className="rlist-badge badge-red">{r.outliers_count}</span>
                    <span className="orcol-pct">{r.outliers_pct}%</span>
                  </span>
                  <code className="orcol-bound">{r.lower_bound}</code>
                  <code className="orcol-bound">{r.upper_bound}</code>
                  <span className="orcol-range">
                    <code>{r.col_min}</code>
                    <span className="orcol-sep">→</span>
                    <code>{r.col_max}</code>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Résultats : types appliqués ───────────────────────────────────────────────
function TypesApplied({ applyData }) {
  const entries = Object.entries(applyData.apply_report || {})
  const nOk     = entries.filter(([, r]) => r.success).length
  const nFail   = entries.filter(([, r]) => !r.success).length

  return (
    <div className="result-content">
      <HeroBanner
        icon={nFail === 0 ? '✓' : '⚠'}
        variant={nFail === 0 ? 'success' : 'warning'}
        title={`${nOk} colonne${nOk > 1 ? 's' : ''} converti${nOk > 1 ? 'es' : 'e'} avec succès`}
        sub={nFail > 0 ? `${nFail} colonne${nFail > 1 ? 's' : ''} en échec` : null}
      />
      <div className="result-stats-row">
        <StatChip value={applyData.statistics?.rows_count ?? '—'} label="lignes" />
        <StatChip value={nOk} label="conversions OK" color="#10b981" />
        {nFail > 0 && <StatChip value={nFail} label="échecs" color="#ef4444" />}
        <StatChip value={(applyData.statistics?.memory_usage_kb ?? '—') + ' KB'} label="mémoire" />
      </div>
      <div className="types-table">
        <div className="types-table-head types-table-head-4">
          <span>Colonne</span><span>Avant</span><span>Après</span><span>Statut</span>
        </div>
        <div className="types-table-body">
          {entries.map(([col, rep]) => {
            const meta = getTypeMeta(rep.applied_type)
            return (
              <div key={col} className="types-table-row types-table-row-4">
                <span className="tcol-name">{col}</span>
                <code className="tcol-orig">{rep.original_dtype}</code>
                <span className="tcol-type">
                  <span className="type-chip" style={{ '--chip-color': meta.color }}>
                    {meta.icon} {meta.label}
                  </span>
                </span>
                <span className="tcol-status" style={{ color: rep.success ? '#10b981' : '#ef4444' }}>
                  {rep.success ? '✓ OK' : `✗ ${rep.error || 'Erreur'}`}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Résultats : doublons ──────────────────────────────────────────────────────
function ResultDoublons({ report }) {
  const found  = report.duplicates_found ?? 0
  const pct    = report.percentage_removed ?? 0
  const pkCol  = report.pk_column
  const method = report.method

  return (
    <div className="result-content">
      <HeroBanner
        icon={found > 0 ? '⚠' : '✓'}
        variant={found > 0 ? 'warning' : 'success'}
        title={found > 0
          ? `${found} doublon${found > 1 ? 's' : ''} supprimé${found > 1 ? 's' : ''}`
          : 'Aucun doublon — données uniques'}
        sub={method ? `Méthode : ${method}` : null}
      />
      <div className="result-stats-row">
        <StatChip value={report.initial_rows ?? '—'} label="lignes initiales" />
        <StatChip value={found} label="doublons" color="#ef4444" />
        <StatChip value={report.rows_after ?? '—'} label="lignes finales" color="#10b981" />
        {pkCol && <StatChip value={pkCol} label="clé primaire" color="#6366f1" />}
      </div>
      {found > 0 && (
        <div className="result-progress-wrap">
          <div className="result-progress-track">
            <div className="result-progress-fill" style={{ width: `${pct}%`, background: '#ef4444' }} />
          </div>
          <span className="result-progress-lbl">{pct}% supprimé</span>
        </div>
      )}
    </div>
  )
}

// ── Résultats : outliers ──────────────────────────────────────────────────────
function ResultOutliers({ report }) {
  const allEntries = Object.entries(report || {})
  const meta       = report?._meta ?? {}
  const entries    = allEntries.filter(([k]) => k !== '_meta')
  const nCols      = entries.length
  const totalOut   = entries.reduce((sum, [, r]) => sum + (r.outliers_count ?? 0), 0)
  const isDrop     = meta.strategy === 'drop'
  const strategyLabel = isDrop ? 'Suppression des lignes' : 'Winsorisation IQR'

  return (
    <div className="result-content">
      <HeroBanner
        icon={nCols > 0 ? '⚠' : '✓'}
        variant={nCols > 0 ? 'warning' : 'success'}
        title={nCols > 0
          ? `${totalOut} outlier${totalOut > 1 ? 's' : ''} traité${totalOut > 1 ? 's' : ''} sur ${nCols} colonne${nCols > 1 ? 's' : ''}`
          : 'Aucun outlier — données numériques propres'}
        sub={nCols > 0 ? `Méthode : ${strategyLabel}` : null}
      />
      <div className="result-stats-row">
        <StatChip value={nCols} label="colonnes affectées" color="#f59e0b" />
        <StatChip value={totalOut} label="outliers détectés" color="#ef4444" />
        {isDrop && meta.rows_dropped > 0 && (
          <StatChip value={meta.rows_dropped} label="lignes supprimées" color="#ef4444" />
        )}
        {isDrop && (
          <StatChip value={meta.rows_after ?? '—'} label="lignes restantes" color="#10b981" />
        )}
      </div>
      {nCols > 0 && (
        <div className="result-list">
          {entries.map(([col, r]) => (
            <div key={col} className="result-list-row">
              <span className="rlist-name">{col}</span>
              <div className="rlist-meta">
                <span className="rlist-badge badge-red">{r.outliers_count} outlier{r.outliers_count > 1 ? 's' : ''}</span>
                <span className="rlist-detail">bornes [{r.lower_bound} ; {r.upper_bound}]</span>
                <span className="rlist-strategy">✓ {r.treatment}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Panneau de vérification des données nettoyées ────────────────────────────
function DataVerificationPanel({ data, onClose }) {
  const [activeView, setActiveView] = useState('columns')
  if (!data) return null

  const { shape, col_profiles, preview } = data
  const colEntries   = Object.entries(col_profiles || {})
  const nMissing     = colEntries.filter(([, p]) => p.n_missing > 0).length
  const previewCols  = preview?.length > 0 ? Object.keys(preview[0]) : []

  return (
    <div className="verification-panel">
      <div className="verif-header">
        <div>
          <h2 className="verif-title">🔍 Vérification du dataset nettoyé</h2>
          <p className="verif-sub">
            {shape.rows} lignes · {shape.cols} colonnes
            {nMissing > 0
              ? <span className="verif-warn"> · ⚠ {nMissing} colonne{nMissing > 1 ? 's' : ''} avec valeurs manquantes résiduelles</span>
              : <span className="verif-ok"> · ✓ Aucune valeur manquante</span>
            }
          </p>
        </div>
        <button className="modal-close-btn" onClick={onClose}>✕</button>
      </div>

      <div className="verif-tabs">
        <button
          className={`rtab ${activeView === 'columns' ? 'rtab-active' : ''}`}
          style={activeView === 'columns' ? { '--rtab-c': '#6366f1' } : {}}
          onClick={() => setActiveView('columns')}
        >📋 Profil des colonnes</button>
        <button
          className={`rtab ${activeView === 'preview' ? 'rtab-active' : ''}`}
          style={activeView === 'preview' ? { '--rtab-c': '#10b981' } : {}}
          onClick={() => setActiveView('preview')}
        >👁 Aperçu des données</button>
      </div>

      {activeView === 'columns' && (
        <div className="verif-col-table">
          <div className="verif-col-head">
            <span>Colonne</span>
            <span>Type final</span>
            <span>Taux de remplissage</span>
          </div>
          <div className="verif-col-body">
            {colEntries.map(([col, p]) => {
              const meta      = getTypeMeta(p.dtype)
              const fillColor = p.fill_rate === 100 ? '#10b981' : p.fill_rate >= 90 ? '#f59e0b' : '#ef4444'
              return (
                <div key={col} className={`verif-col-row ${p.n_missing > 0 ? 'verif-row-warn' : ''}`}>
                  <span className="vcol-name" title={col}>
                    {p.n_missing > 0 && <span className="modified-dot" title={`${p.n_missing} valeurs manquantes`} />}
                    {col}
                  </span>
                  <span className="type-chip" style={{ '--chip-color': meta.color }}>
                    {meta.icon} {meta.label}
                  </span>
                  <div className="vcol-fill">
                    <div className="conf-bar-track">
                      <div className="conf-bar-fill" style={{ width: `${p.fill_rate}%`, background: fillColor }} />
                    </div>
                    <span className="conf-pct" style={{ color: fillColor }}>{p.fill_rate}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {activeView === 'preview' && (
        <div className="verif-preview-wrap">
          <div className="preview-table-wrap">
            <table className="preview-table">
              <thead>
                <tr>
                  <th className="verif-row-num">#</th>
                  {previewCols.map(c => <th key={c}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {(preview || []).map((row, i) => (
                  <tr key={i}>
                    <td className="verif-row-num">{i + 1}</td>
                    {previewCols.map((c, j) => (
                      <td key={j}>
                        {row[c] == null
                          ? <span className="cell-null">null</span>
                          : String(row[c]).length > 28
                            ? String(row[c]).slice(0, 26) + '…'
                            : String(row[c])}
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
  )
}

// ── Options d'imputation par catégorie de type ────────────────────────────────
const IMPUTATION_OPTIONS = {
  numeric: [
    { value: 'median',      label: 'Médiane' },
    { value: 'mean',        label: 'Moyenne' },
    { value: 'constant',    label: 'Constante (-999)' },
    { value: 'drop_rows',   label: 'Supprimer les lignes' },
    { value: 'drop_column', label: 'Supprimer la colonne' },
  ],
  categorical: [
    { value: 'mode',        label: 'Mode (valeur fréquente)' },
    { value: 'constant',    label: 'Constante ("unknown")' },
    { value: 'drop_rows',   label: 'Supprimer les lignes' },
    { value: 'drop_column', label: 'Supprimer la colonne' },
  ],
  datetime: [
    { value: 'ffill',       label: 'Propagation avant (ffill)' },
    { value: 'bfill',       label: 'Propagation arrière (bfill)' },
    { value: 'drop_rows',   label: 'Supprimer les lignes' },
    { value: 'drop_column', label: 'Supprimer la colonne' },
  ],
}

const getColTypeCategory = (dtype) => {
  if (!dtype) return 'categorical'
  const t = dtype.toLowerCase()
  if (t.includes('datetime')) return 'datetime'
  if (/int|float|uint/.test(t)) return 'numeric'
  return 'categorical'
}

const STRATEGY_LABELS = {
  median:      'Médiane',
  mean:        'Moyenne',
  constant:    'Constante',
  mode:        'Mode',
  ffill:       'ffill',
  bfill:       'bfill',
  drop_rows:   'Lignes supprimées',
  drop_column: 'Colonne supprimée',
  ignored:     'Ignoré',
}

// ── Section imputation dans le modal ─────────────────────────────────────────
function ImputationReviewSection({ missingReport, userStrategies, onStrategyChange,
                                    createIndicators, onToggleIndicators }) {
  if (!missingReport) return null
  const entries = Object.entries(missingReport)
  if (entries.length === 0) {
    return (
      <div className="modal-section">
        <div className="modal-section-header">
          <h3>🩹 Imputation des valeurs manquantes</h3>
          <span className="rsummary-chip rsummary-ok">✓ Aucune valeur manquante</span>
        </div>
        <div className="outlier-hero outlier-hero-ok">
          <span className="outlier-hero-icon">✓</span>
          <div><div className="outlier-hero-title">Dataset complet — aucune imputation nécessaire</div></div>
        </div>
      </div>
    )
  }

  const totalMiss = entries.reduce((s, [, r]) => s + r.missing_count, 0)
  const nDropRows = entries.filter(([col]) => userStrategies[col] === 'drop_rows').length

  return (
    <div className="modal-section">
      <div className="modal-section-header">
        <h3>🩹 Imputation des valeurs manquantes</h3>
        <div className="modal-section-chips">
          <span className="rsummary-chip rsummary-mod">
            ⚠ {entries.length} colonne{entries.length > 1 ? 's' : ''} · {totalMiss} valeur{totalMiss > 1 ? 's' : ''} manquante{totalMiss > 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Checkbox indicateurs */}
      <label className="imp-indicators-toggle">
        <input
          type="checkbox"
          checked={createIndicators}
          onChange={e => onToggleIndicators(e.target.checked)}
        />
        <div>
          <span className="imp-indic-toggle-title">
            📌 Créer des indicateurs de valeurs manquantes
          </span>
          <span className="imp-indic-toggle-sub">
            Ajoute une colonne <code>col_missing</code> (0/1) pour chaque colonne imputée —
            utile pour capturer le signal "absence" en WOE lors de la modélisation
          </span>
        </div>
      </label>

      {nDropRows > 0 && (
        <div className="imp-drop-warn">
          <span>⚠</span>
          <span>
            <strong>{nDropRows} colonne{nDropRows > 1 ? 's' : ''} en suppression de lignes</strong> —
            l'indicateur ne sera pas créé pour ces colonnes car les lignes disparaissent.
            Si l'absence est informative, préfère <em>médiane</em>, <em>mode</em> ou <em>constante</em>.
          </span>
        </div>
      )}

      <div className="imp-review-table">
        <div className="imp-review-head">
          <span>Colonne</span>
          <span>Type</span>
          <span>Manquants</span>
          <span>%</span>
          <span>Stratégie</span>
        </div>
        <div className="imp-review-body">
          {entries.map(([col, r]) => {
            const typeCategory = getColTypeCategory(r.dtype)
            const options      = IMPUTATION_OPTIONS[typeCategory]
            const selected     = userStrategies[col] ?? r.proposed_strategy
            const isModified   = selected !== r.proposed_strategy
            const isDanger     = selected === 'drop_column' || selected === 'drop_rows'
            const pctColor     = r.missing_pct > 60 ? '#ef4444' : r.missing_pct > 30 ? '#f59e0b' : '#10b981'

            return (
              <div key={col} className={`imp-review-row ${isModified ? 'row-modified' : ''}`}>
                <span className="impcol-name" title={col}>
                  {isModified && <span className="modified-dot" />}
                  {col}
                </span>
                <code className="impcol-dtype">{r.dtype}</code>
                <span className="impcol-count">{r.missing_count}</span>
                <span className="impcol-pct" style={{ color: pctColor }}>{r.missing_pct}%</span>
                <select
                  className={`type-select ${isModified ? 'select-modified' : ''} ${isDanger ? 'select-danger' : ''}`}
                  value={selected}
                  onChange={e => onStrategyChange(col, e.target.value)}
                >
                  {options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Résultats : imputation ────────────────────────────────────────────────────
function ResultImputation({ report }) {
  if (!report) return null
  const meta    = report._meta ?? {}
  const entries = Object.entries(report).filter(([k]) => k !== '_meta')

  const nImputed    = meta.cols_imputed        ?? 0
  const nDropCols   = meta.cols_dropped        ?? 0
  const nDropRows   = meta.rows_dropped        ?? 0
  const rowsAfter   = meta.rows_after          ?? '—'
  const colsAfter   = meta.cols_after          ?? '—'
  const indicators  = meta.indicators_created  ?? []

  return (
    <div className="result-content">
      <HeroBanner
        icon="✓"
        variant="success"
        title={`Imputation terminée — dataset prêt pour la modélisation`}
        sub={`${nImputed} colonne${nImputed > 1 ? 's' : ''} imputée${nImputed > 1 ? 's' : ''} · ${nDropCols} supprimée${nDropCols > 1 ? 's' : ''} · ${nDropRows} ligne${nDropRows > 1 ? 's' : ''} retirée${nDropRows > 1 ? 's' : ''}`}
      />
      <div className="result-stats-row">
        <StatChip value={nImputed}          label="colonnes imputées"   color="#10b981" />
        <StatChip value={nDropCols}         label="colonnes supprimées" color="#ef4444" />
        <StatChip value={nDropRows}         label="lignes retirées"     color="#f59e0b" />
        <StatChip value={rowsAfter}         label="lignes finales"      color="#6366f1" />
        <StatChip value={colsAfter}         label="colonnes finales"    color="#6366f1" />
        {indicators.length > 0 && (
          <StatChip value={indicators.length} label="indicateurs créés" color="#8b5cf6" />
        )}
      </div>
      {indicators.length > 0 && (
        <div className="imp-indicators-result">
          <span className="imp-indic-label">📌 Colonnes indicatrices ajoutées :</span>
          <div className="imp-indic-chips">
            {indicators.map(name => (
              <span key={name} className="imp-indic-chip">{name}</span>
            ))}
          </div>
        </div>
      )}
      {entries.length > 0 && (
        <div className="result-list">
          {entries.map(([col, r]) => (
            <div key={col} className="result-list-row">
              <span className="rlist-name">{col}</span>
              <div className="rlist-meta">
                <span className={`rlist-badge ${r.strategy === 'drop_column' || r.strategy === 'drop_rows' ? 'badge-red' : 'badge-green'}`}>
                  {STRATEGY_LABELS[r.strategy] ?? r.strategy}
                </span>
                {'value' in r && (
                  <span className="rlist-detail">valeur : {r.value}</span>
                )}
                <span className="rlist-detail">{r.missing_count} valeur{r.missing_count > 1 ? 's' : ''} traitée{r.missing_count > 1 ? 's' : ''}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ═════════════════════════════════════════════════════════════════════════════
export default function DataCleaning({ activeFile }) {

  // pipelineState : idle | running | modal | applying | done
  const [pipelineState, setPipelineState] = useState('idle')

  // impPhase : null | detecting | modal | applying | done
  const [impPhase, setImpPhase] = useState(null)

  // Session (remplace le passage du fichier à chaque appel)
  const [sessionId, setSessionId] = useState(null)

  // Résultats de détection (phase init)
  const [detectData,     setDetectData]     = useState(null)
  const [doublonsReport, setDoublonsReport] = useState(null)
  const [outliersReport, setOutliersReport] = useState(null)

  // Choix utilisateur — pipeline principal
  const [userTypes,           setUserTypes]           = useState({})
  const [userOutlierStrategy, setUserOutlierStrategy] = useState('drop')
  const [userPkColumn,        setUserPkColumn]        = useState(null)

  // Résultats après application (phase confirm)
  const [typesResult,    setTypesResult]    = useState(null)
  const [doublonsResult, setDoublonsResult] = useState(null)
  const [outliersResult, setOutliersResult] = useState(null)

  // Imputation
  const [missingReport,       setMissingReport]       = useState(null)
  const [userImputStrategies,  setUserImputStrategies] = useState({})
  const [imputationResult,    setImputationResult]    = useState(null)
  const [createIndicators,    setCreateIndicators]    = useState(true)

  // Vérification post-pipeline
  const [verificationData,  setVerificationData]  = useState(null)
  const [showVerification,  setShowVerification]  = useState(false)

  const [activeTab, setActiveTab] = useState('types')
  const [logs,      setLogs]      = useState([])
  const resultsPanelRef = useRef(null)

  // Reset complet quand un nouveau fichier est chargé
  useEffect(() => {
    if (!activeFile) return
    setSessionId(null)
    setDetectData(null); setDoublonsReport(null); setOutliersReport(null)
    setTypesResult(null); setDoublonsResult(null); setOutliersResult(null)
    setUserTypes({}); setUserOutlierStrategy('drop')
    setImpPhase(null)
    setMissingReport(null); setUserImputStrategies({}); setImputationResult(null)
    setCreateIndicators(true)
    setVerificationData(null); setShowVerification(false)
    setActiveTab('types')
    setLogs([])
    setPipelineState('idle')
  }, [activeFile])

  const goToTab = (tab) => {
    setActiveTab(tab)
    setTimeout(() => {
      resultsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  const addLog = (key, status, msg) =>
    setLogs(prev => [
      { id: `${key}-${Date.now()}`, key, status, msg, time: new Date().toLocaleTimeString() },
      ...prev,
    ])

  // ── ÉTAPE 1 : Init pipeline — upload + toutes les détections ─────────────
  async function launchPipeline() {
    if (!activeFile || pipelineState === 'running' || pipelineState === 'applying') return

    // Reset
    setSessionId(null)
    setDetectData(null); setDoublonsReport(null); setOutliersReport(null)
    setTypesResult(null); setDoublonsResult(null); setOutliersResult(null)
    setUserTypes({})
    setUserOutlierStrategy('drop')
    setImpPhase(null)
    setMissingReport(null); setUserImputStrategies({}); setImputationResult(null)
    setCreateIndicators(true)
    setPipelineState('running')
    addLog('pipeline', 'running', 'Initialisation du pipeline…')

    const fd = new FormData()
    fd.append('file', activeFile)

    try {
      const res  = await fetch('/api/data-cleaning/pipeline/init', { method: 'POST', body: fd })
      const data = await res.json()

      if (!res.ok || !data.success) {
        addLog('pipeline', 'error', `Erreur : ${data.error || '?'}`)
        setPipelineState('idle')
        return
      }

      setSessionId(data.session_id)
      setDetectData(data)
      setDoublonsReport(data.doublons_report)
      setOutliersReport(data.outliers_report)

      const nCols    = Object.keys(data.type_report || {}).length
      const nDbl     = data.doublons_report?.duplicates_found ?? 0
      const nOutCols = Object.keys(data.outliers_report || {}).length

      const init = {}
      Object.entries(data.type_report || {}).forEach(([col, r]) => { init[col] = r.detected_type })
      setUserTypes(init)

      addLog('types',    'success', `Types analysés — ${nCols} colonnes`)
      addLog('doublons', 'success', `Doublons analysés — ${nDbl} trouvé${nDbl > 1 ? 's' : ''}`)
      addLog('outliers', 'success', `Outliers analysés — ${nOutCols} colonne${nOutCols > 1 ? 's' : ''} affectée${nOutCols > 1 ? 's' : ''}`)
      addLog('pipeline', 'success', 'Analyses terminées — révision requise')
      setPipelineState('modal')

    } catch (e) {
      addLog('pipeline', 'error', `Erreur pipeline : ${e.message}`)
      setPipelineState('idle')
    }
  }

  // ── ÉTAPE 2 : Confirmation dans le modal → application ───────────────────
  async function confirmAndApply() {
    if (!sessionId) return
    setPipelineState('applying')
    addLog('pipeline', 'running', 'Application des transformations…')

    const fd = new FormData()
    fd.append('session_id', sessionId)
    fd.append('confirmed_types', JSON.stringify(userTypes))
    fd.append('outlier_strategy', userOutlierStrategy)
    if (userPkColumn) fd.append('user_pk_column', userPkColumn)

    try {
      const res  = await fetch('/api/data-cleaning/pipeline/confirm', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || `Erreur HTTP ${res.status}`)

      const nTypesOk = Object.values(data.types_result?.apply_report || {}).filter(r => r.success).length
      const nDbl     = data.doublons_result?.report?.duplicates_found ?? 0
      const nOutCols = Object.keys(data.outliers_result?.report || {}).length

      setTypesResult(data.types_result)
      setDoublonsResult(data.doublons_result?.report)
      setOutliersResult(data.outliers_result?.report)

      addLog('types',    'success', `${nTypesOk} colonnes converties`)
      addLog('doublons', 'success', `${nDbl} doublon${nDbl > 1 ? 's' : ''} supprimé${nDbl > 1 ? 's' : ''}`)
      addLog('outliers', 'success', `${nOutCols} colonne${nOutCols > 1 ? 's' : ''} winsorisée${nOutCols > 1 ? 's' : ''}`)
      addLog('pipeline', 'success', '3/4 étapes terminées — Imputation à venir')

      setPipelineState('done')
      setActiveTab('types')

    } catch (e) {
      addLog('pipeline', 'error', `Application échouée : ${e.message}`)
      setPipelineState('modal')
    }
  }

  // ── ÉTAPE 3 : Lancement de la détection des valeurs manquantes ──────────
  async function launchImputation() {
    if (!sessionId || impPhase === 'detecting' || impPhase === 'applying') return
    setImpPhase('detecting')
    setMissingReport(null); setUserImputStrategies({}); setImputationResult(null)
    addLog('imputation', 'running', 'Analyse des valeurs manquantes…')

    const fd = new FormData()
    fd.append('session_id', sessionId)

    try {
      const res  = await fetch('/api/data-cleaning/missing/detect', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || `Erreur HTTP ${res.status}`)

      const nCols = data.total_missing_cols ?? 0
      const nVals = data.total_missing_vals ?? 0

      // Initialiser les stratégies avec les propositions du backend
      const initStrat = {}
      Object.entries(data.missing_report || {}).forEach(([col, r]) => {
        initStrat[col] = r.proposed_strategy
      })
      setMissingReport(data.missing_report)
      setUserImputStrategies(initStrat)

      addLog('imputation', 'success', `${nCols} colonne${nCols > 1 ? 's' : ''} avec ${nVals} valeur${nVals > 1 ? 's' : ''} manquante${nVals > 1 ? 's' : ''}`)
      setImpPhase('modal')

    } catch (e) {
      addLog('imputation', 'error', `Détection échouée : ${e.message}`)
      setImpPhase(null)
    }
  }

  // ── ÉTAPE 4 : Confirmation de l'imputation → application ─────────────────
  async function confirmImputation() {
    if (!sessionId) return
    setImpPhase('applying')
    addLog('imputation', 'running', "Application des stratégies d'imputation…")

    const fd = new FormData()
    fd.append('session_id', sessionId)
    fd.append('confirmed_strategies', JSON.stringify(userImputStrategies))
    fd.append('create_indicators', String(createIndicators))

    try {
      const res  = await fetch('/api/data-cleaning/missing/apply', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || `Erreur HTTP ${res.status}`)

      setImputationResult(data.report)
      const meta = data.report?._meta ?? {}
      addLog('imputation', 'success',
        `Imputation terminée — ${meta.cols_imputed ?? 0} imputées · ${meta.cols_dropped ?? 0} supprimées · ${meta.rows_dropped ?? 0} lignes retirées`
      )
      addLog('pipeline', 'success', '✓ Pipeline complet 4/4 — dataset prêt')
      setImpPhase('done')
      setActiveTab('imputation')

    } catch (e) {
      addLog('imputation', 'error', `Application échouée : ${e.message}`)
      setImpPhase('modal')
    }
  }

  // ── ÉTAPE 5 : Chargement du panneau de vérification ─────────────────────
  async function loadVerification() {
    if (!sessionId) return
    try {
      const fd = new FormData()
      fd.append('session_id', sessionId)
      const res  = await fetch('/api/data-cleaning/pipeline/preview', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || `Erreur HTTP ${res.status}`)
      setVerificationData(data)
      setShowVerification(true)
    } catch (e) {
      addLog('pipeline', 'error', `Vérification échouée : ${e.message}`)
    }
  }

  // ── États visuels des cartes ──────────────────────────────────────────────
  const CARD_BADGE = {
    idle:     { label: 'En attente',              cls: 'badge-idle'    },
    running:  { label: 'Analyse en cours…',       cls: 'badge-running' },
    pending:  { label: '⚠ En attente de révision', cls: 'badge-pending' },
    applying: { label: 'Application en cours…',   cls: 'badge-running' },
    done:     { label: 'Terminé ✓',              cls: 'badge-done'    },
  }

  const typesBadge = CARD_BADGE[{
    idle: 'idle', running: 'running', modal: 'pending',
    applying: 'applying', done: 'done',
  }[pipelineState]]

  const doublonsBadge = CARD_BADGE[{
    idle: 'idle', running: 'running', modal: 'done',
    applying: 'done', done: 'done',
  }[pipelineState]]

  const outliersBadge = CARD_BADGE[{
    idle: 'idle', running: 'running', modal: 'done',
    applying: 'done', done: 'done',
  }[pipelineState]]

  const progressPct = impPhase === 'done' ? 100
    : pipelineState === 'done'            ? 75
    : 0
  const progressLabel = impPhase === 'done'   ? 'Pipeline complet ✓'
    : pipelineState === 'done'                ? '3 / 4 étapes · Imputation à venir'
    : ''

  const impBadge = CARD_BADGE[
    impPhase === 'done'      ? 'done'
    : impPhase === 'applying' ? 'applying'
    : impPhase === 'modal'    ? 'pending'
    : impPhase === 'detecting'? 'running'
    : 'idle'
  ]

  // ─────────────────────────────────────────────────────────────────────────
  // RENDU
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="cleaning-page">

      {/* ── Header ── */}
      <div className="cleaning-header">
        <div>
          <h1>🧹 Data Cleaning</h1>
          <p className="cleaning-subtitle">Analyse, révision, application</p>
        </div>
        <div className="cleaning-header-right">
          {activeFile && (
            <div className="file-badge">
              <span className="file-dot" />
              <span>{activeFile.name}</span>
              <span className="file-size">({fmtBytes(activeFile.size)})</span>
            </div>
          )}
          <button
            className="run-all-btn"
            onClick={launchPipeline}
            disabled={!activeFile || pipelineState === 'running' || pipelineState === 'applying'}
          >
            {pipelineState === 'running'
              ? <><span className="btn-spinner" /> Analyse en cours…</>
              : pipelineState === 'done'
                ? '↺ Recommencer'
                : '🚀 Lancer le pipeline'}
          </button>
        </div>
      </div>

      {/* ── Alerte pas de fichier ── */}
      {!activeFile && (
        <div className="no-file-alert">
          <span>⚠</span>
          <span>
            Aucun dataset actif. Chargez un fichier CSV depuis le module <strong>Data Quality</strong>.
          </span>
        </div>
      )}

      {/* ── Progression ── */}
      {pipelineState === 'done' && (
        <div className="pipeline-progress">
          <span className="pipeline-progress-label">{progressLabel}</span>
          <div className="pipeline-progress-track">
            <div className="pipeline-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="pipeline-progress-pct">{progressPct}%</span>
        </div>
      )}

      {/* ── Cartes de statut ── */}
      <div className="tasks-grid tasks-grid-3">

        {/* Carte types */}
        <div
          className={`task-card
            ${pipelineState === 'done' ? 'card-done' : ''}
            ${pipelineState === 'running' || pipelineState === 'applying' ? 'card-running' : ''}
            ${pipelineState === 'modal' ? 'card-pending' : ''}`}
          style={{ '--tc': '#6366f1' }}
        >
          <div className="task-card-top">
            <div className="task-icon" style={{ background: '#6366f118', color: '#6366f1' }}>🔧</div>
            <span className={`task-badge ${typesBadge.cls}`}>
              {(pipelineState === 'running' || pipelineState === 'applying') && <span className="badge-spin" />}
              {typesBadge.label}
            </span>
          </div>
          <div className="task-card-body">
            <h3 className="task-title">Correction des types</h3>
            <p className="task-desc">Détection automatique · révision manuelle · confirmation utilisateur</p>
            {pipelineState === 'modal' && (
              <p className="task-hint">💡 Le modal de révision est ouvert — confirmez les types.</p>
            )}
          </div>
          {pipelineState === 'done' && typesResult && (
            <div className="task-card-footer">
              <button className="btn-view" onClick={() => goToTab('types')}>👁 Voir les résultats</button>
            </div>
          )}
        </div>

        {/* Carte doublons */}
        <div
          className={`task-card
            ${['modal','applying','done'].includes(pipelineState) ? 'card-done' : ''}
            ${pipelineState === 'running' ? 'card-running' : ''}`}
          style={{ '--tc': '#f59e0b' }}
        >
          <div className="task-card-top">
            <div className="task-icon" style={{ background: '#f59e0b18', color: '#f59e0b' }}>🔁</div>
            <span className={`task-badge ${doublonsBadge.cls}`}>
              {pipelineState === 'running' && <span className="badge-spin" />}
              {doublonsBadge.label}
            </span>
          </div>
          <div className="task-card-body">
            <h3 className="task-title">Suppression des doublons</h3>
            <p className="task-desc">Identification et suppression automatique des lignes dupliquées</p>
          </div>
          {pipelineState === 'done' && doublonsResult && (
            <div className="task-card-footer">
              <button className="btn-view" onClick={() => goToTab('doublons')}>👁 Voir les résultats</button>
            </div>
          )}
        </div>

        {/* Carte outliers */}
        <div
          className={`task-card
            ${['modal','applying','done'].includes(pipelineState) ? 'card-done' : ''}
            ${pipelineState === 'running' ? 'card-running' : ''}`}
          style={{ '--tc': '#ef4444' }}
        >
          <div className="task-card-top">
            <div className="task-icon" style={{ background: '#ef444418', color: '#ef4444' }}>📊</div>
            <span className={`task-badge ${outliersBadge.cls}`}>
              {pipelineState === 'running' && <span className="badge-spin" />}
              {outliersBadge.label}
            </span>
          </div>
          <div className="task-card-body">
            <h3 className="task-title">Détection des outliers</h3>
            <p className="task-desc">Analyse IQR · winsorisation automatique aux bornes</p>
          </div>
          {pipelineState === 'done' && outliersResult && (
            <div className="task-card-footer">
              <button className="btn-view" onClick={() => goToTab('outliers')}>👁 Voir les résultats</button>
            </div>
          )}
        </div>

        {/* Carte imputation — séparée, pleine largeur */}
        {pipelineState === 'done' && (
          <div className="imp-card-row">
            <div
              className={`task-card imp-card
                ${impPhase === 'done'                     ? 'card-done'    : ''}
                ${impPhase === 'detecting' || impPhase === 'applying' ? 'card-running' : ''}
                ${impPhase === 'modal'                    ? 'card-pending' : ''}
                ${!impPhase                               ? 'card-locked'  : ''}`}
              style={{ '--tc': '#10b981' }}
            >
              <div className="task-card-top">
                <div className="task-icon" style={{ background: '#10b98118', color: '#10b981' }}>🩹</div>
                <span className={`task-badge ${impBadge.cls}`}>
                  {(impPhase === 'detecting' || impPhase === 'applying') && <span className="badge-spin" />}
                  {impBadge.label}
                </span>
              </div>
              <div className="task-card-body">
                <h3 className="task-title">Imputation des valeurs manquantes</h3>
                <p className="task-desc">
                  Détection par colonne · stratégie personnalisée · médiane / mode / constante / suppression
                </p>
                {impPhase === 'modal' && (
                  <p className="task-hint">💡 Le modal d'imputation est ouvert — confirmez les stratégies.</p>
                )}
              </div>
              <div className="task-card-footer">
                {impPhase === 'done'
                  ? (
                    <div className="imp-done-actions">
                      <button className="btn-view" onClick={() => goToTab('imputation')}>👁 Voir les résultats</button>
                      <button
                        className="btn-run"
                        style={{ '--btn-c': '#6366f1' }}
                        onClick={loadVerification}
                      >🔍 Vérifier les données</button>
                    </div>
                  )
                  : !impPhase && (
                    <button
                      className="btn-run"
                      style={{ '--btn-c': '#10b981' }}
                      onClick={launchImputation}
                      disabled={impPhase === 'detecting'}
                    >
                      Lancer l'imputation
                    </button>
                  )
                }
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Résultats ── */}
      {pipelineState === 'done' && (typesResult || doublonsResult || outliersResult || imputationResult) && (
        <div className="results-panel" ref={resultsPanelRef}>
          <div className="results-panel-header">
            <h2>📊 Résultats du pipeline</h2>
            <div className="results-tabs">
              {typesResult && (
                <button
                  className={`rtab ${activeTab === 'types' ? 'rtab-active' : ''}`}
                  style={activeTab === 'types' ? { '--rtab-c': '#6366f1' } : {}}
                  onClick={() => setActiveTab('types')}
                >🔧 Types</button>
              )}
              {doublonsResult && (
                <button
                  className={`rtab ${activeTab === 'doublons' ? 'rtab-active' : ''}`}
                  style={activeTab === 'doublons' ? { '--rtab-c': '#f59e0b' } : {}}
                  onClick={() => setActiveTab('doublons')}
                >🔁 Doublons</button>
              )}
              {outliersResult && (
                <button
                  className={`rtab ${activeTab === 'outliers' ? 'rtab-active' : ''}`}
                  style={activeTab === 'outliers' ? { '--rtab-c': '#ef4444' } : {}}
                  onClick={() => setActiveTab('outliers')}
                >📊 Outliers</button>
              )}
              {imputationResult && (
                <button
                  className={`rtab ${activeTab === 'imputation' ? 'rtab-active' : ''}`}
                  style={activeTab === 'imputation' ? { '--rtab-c': '#10b981' } : {}}
                  onClick={() => setActiveTab('imputation')}
                >🩹 Imputation</button>
              )}
            </div>
          </div>
          <div className="results-panel-body">
            {activeTab === 'types'      && typesResult      && <TypesApplied    applyData={typesResult}    />}
            {activeTab === 'doublons'   && doublonsResult    && <ResultDoublons  report={doublonsResult}    />}
            {activeTab === 'outliers'   && outliersResult    && <ResultOutliers  report={outliersResult}    />}
            {activeTab === 'imputation' && imputationResult  && <ResultImputation report={imputationResult} />}
          </div>
        </div>
      )}

      {/* ── Journal ── */}
      <div className="log-panel">
        <div className="log-panel-header">
          <h2>📜 Journal</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {logs.length > 0 && (
              <button className="log-clear-btn" onClick={() => setLogs([])}>Effacer</button>
            )}
            <span className="log-count">{logs.length}</span>
          </div>
        </div>
        <div className="log-panel-body">
          {logs.length === 0
            ? <div className="log-empty">Aucune opération lancée pour l'instant…</div>
            : logs.map(log => (
              <div key={log.id} className={`log-entry log-${log.status}`}>
                <span className="log-time">{log.time}</span>
                <span className={`log-dot ld-${log.status}`} />
                <span className="log-msg">{log.msg}</span>
              </div>
            ))
          }
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL DE RÉVISION
          ══════════════════════════════════════════════════════════════════ */}
      {pipelineState === 'modal' && (
        <div className="modal-overlay" onClick={() => setPipelineState('idle')}>
          <div className="pipeline-modal" onClick={e => e.stopPropagation()}>

            <div className="modal-header">
              <div>
                <h2 className="modal-title">📋 Révision du pipeline</h2>
                <p className="modal-subtitle">
                  Vérifiez les types proposés, modifiez si nécessaire, puis confirmez.
                </p>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setPipelineState('idle')}
                title="Annuler"
              >✕</button>
            </div>

            <div className="modal-body">
              <TypesReviewSection
                detectData={detectData}
                userTypes={userTypes}
                onTypeChange={(col, type) => setUserTypes(prev => ({ ...prev, [col]: type }))}
              />
              <DoublonsReviewSection
                doublonsReport={doublonsReport}
                selectedPk={userPkColumn}
                onPkChange={setUserPkColumn}
              />
              <OutliersReviewSection
                outliersReport={outliersReport}
                strategy={userOutlierStrategy}
                onStrategyChange={setUserOutlierStrategy}
              />
            </div>

            <div className="modal-footer">
              <button className="btn-modal-cancel" onClick={() => setPipelineState('idle')}>
                Annuler
              </button>
              <button className="btn-modal-confirm" onClick={confirmAndApply}>
                ✓ Confirmer et appliquer
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Overlay applying — pipeline principal */}
      {pipelineState === 'applying' && (
        <div className="modal-overlay">
          <div className="applying-card">
            <span className="applying-spinner" />
            <div>
              <div className="applying-title">Application en cours…</div>
              <div className="applying-sub">Types · Doublons · Outliers</div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL IMPUTATION
          ══════════════════════════════════════════════════════════════════ */}
      {impPhase === 'modal' && (
        <div className="modal-overlay" onClick={() => setImpPhase(null)}>
          <div className="pipeline-modal" onClick={e => e.stopPropagation()}>

            <div className="modal-header">
              <div>
                <h2 className="modal-title">🩹 Imputation des valeurs manquantes</h2>
                <p className="modal-subtitle">
                  Vérifiez la stratégie proposée par colonne, ajustez si besoin, puis confirmez.
                </p>
              </div>
              <button className="modal-close-btn" onClick={() => setImpPhase(null)} title="Annuler">✕</button>
            </div>

            <div className="modal-body">
              <ImputationReviewSection
                missingReport={missingReport}
                userStrategies={userImputStrategies}
                onStrategyChange={(col, strat) =>
                  setUserImputStrategies(prev => ({ ...prev, [col]: strat }))
                }
                createIndicators={createIndicators}
                onToggleIndicators={setCreateIndicators}
              />
            </div>

            <div className="modal-footer">
              <button className="btn-modal-cancel" onClick={() => setImpPhase(null)}>Annuler</button>
              <button
                className="btn-modal-confirm"
                style={{ background: '#10b981' }}
                onClick={confirmImputation}
              >
                ✓ Confirmer et appliquer
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Overlay applying — imputation */}
      {impPhase === 'applying' && (
        <div className="modal-overlay">
          <div className="applying-card">
            <span className="applying-spinner" style={{ borderTopColor: '#10b981', borderColor: '#d1fae5' }} />
            <div>
              <div className="applying-title">Imputation en cours…</div>
              <div className="applying-sub">Application des stratégies par colonne</div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          PANNEAU DE VÉRIFICATION
          ══════════════════════════════════════════════════════════════════ */}
      {showVerification && (
        <div className="modal-overlay" onClick={() => setShowVerification(false)}>
          <div className="verification-modal" onClick={e => e.stopPropagation()}>
            <DataVerificationPanel
              data={verificationData}
              onClose={() => setShowVerification(false)}
            />
          </div>
        </div>
      )}

    </div>
  )
}
