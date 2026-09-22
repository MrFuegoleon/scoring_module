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
              <label className={`strategy-option strategy-option-keep ${strategy === 'keep' ? 'strategy-option-active' : ''}`}>
                <input
                  type="radio"
                  name="outlier_strategy"
                  value="keep"
                  checked={strategy === 'keep'}
                  onChange={() => onStrategyChange('keep')}
                />
                <span className="strategy-option-icon">🛡</span>
                <div>
                  <div className="strategy-option-title">Conserver (aucun traitement)</div>
                  <div className="strategy-option-sub">Garde les valeurs extrêmes intactes — utiles si elles portent un signal métier</div>
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
  const isKeep     = meta.strategy === 'keep'
  const strategyLabel = isDrop ? 'Suppression des lignes'
                      : isKeep ? 'Conservation (aucun traitement)'
                      : 'Winsorisation IQR'

  return (
    <div className="result-content">
      <HeroBanner
        icon={nCols === 0 ? '✓' : isKeep ? '🛡' : '⚠'}
        variant={nCols === 0 ? 'success' : isKeep ? 'info' : 'warning'}
        title={nCols === 0
          ? 'Aucun outlier — données numériques propres'
          : isKeep
            ? `${totalOut} outlier${totalOut > 1 ? 's' : ''} conservé${totalOut > 1 ? 's' : ''} sur ${nCols} colonne${nCols > 1 ? 's' : ''}`
            : `${totalOut} outlier${totalOut > 1 ? 's' : ''} traité${totalOut > 1 ? 's' : ''} sur ${nCols} colonne${nCols > 1 ? 's' : ''}`}
        sub={nCols > 0 ? `Méthode : ${strategyLabel}` : null}
      />
      <div className="result-stats-row">
        <StatChip value={nCols} label={isKeep ? 'colonnes concernées' : 'colonnes affectées'} color="#f59e0b" />
        <StatChip value={totalOut} label="outliers détectés" color="#ef4444" />
        {isDrop && meta.rows_dropped > 0 && (
          <StatChip value={meta.rows_dropped} label="lignes supprimées" color="#ef4444" />
        )}
        {isDrop && (
          <StatChip value={meta.rows_after ?? '—'} label="lignes restantes" color="#10b981" />
        )}
        {isKeep && (
          <StatChip value={meta.rows_after ?? '—'} label="lignes inchangées" color="#10b981" />
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
                <span className="rlist-strategy">{isKeep ? '🛡' : '✓'} {r.treatment}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Panneau de vérification des données nettoyées ────────────────────────────
// ── Pipeline Builder — sélection cible + config ───────────────────────────────
function PipelineBuilderSection({ targetCandidates, selectedTarget, onSelectTarget,
                                   positiveClass, onPositiveClassChange,
                                   cardinality, onCardinalityChange,
                                   nBins, onNBinsChange,
                                   allColumns, excludedCols, onToggleExclude }) {
  const selCand = targetCandidates.find(c => c.column === selectedTarget)
  return (
    <div className="modal-section">
      <div className="modal-section-header">
        <h3>🎯 Variable cible</h3>
        <div className="modal-section-chips">
          {targetCandidates.length === 0
            ? <span className="rsummary-chip rsummary-mod">⚠ Aucune colonne binaire détectée</span>
            : <span className="rsummary-chip rsummary-info">{targetCandidates.length} candidat{targetCandidates.length > 1 ? 's' : ''} détecté{targetCandidates.length > 1 ? 's' : ''}</span>
          }
        </div>
      </div>

      {targetCandidates.length > 0 && (
        <div className="pb-target-grid">
          {targetCandidates.map(c => {
            const sel = selectedTarget === c.column
            // Sur la carte sélectionnée, le taux suit la modalité choisie par l'utilisateur
            const evt = (sel && positiveClass != null) ? positiveClass : c.suggested_positive
            const rate = c.value_counts && c.value_counts[evt] != null
              ? c.value_counts[evt] / Object.values(c.value_counts).reduce((a, b) => a + b, 0)
              : c.event_rate
            const pctVal = (rate * 100).toFixed(1)
            const balanced = Math.abs(0.5 - rate) < 0.15
            return (
              <div
                key={c.column}
                className={`pb-target-card ${sel ? 'pb-target-card-sel' : ''}`}
                onClick={() => onSelectTarget(c.column)}
              >
                <div className="pb-target-top">
                  <span className="pb-target-name">{c.column}</span>
                  {sel && <span className="pb-target-dot" />}
                </div>
                <div className="pb-target-vals">
                  {c.values.map(v => (
                    <span key={v} className={`pb-target-val ${sel && v === evt ? 'pb-target-val-evt' : ''}`}>{v}</span>
                  ))}
                </div>
                <div className="pb-target-bar-wrap">
                  <div className="pb-target-bar" style={{ width: `${pctVal}%` }} />
                </div>
                <div className="pb-target-meta">
                  <span>Taux événement : <strong>{pctVal}%</strong></span>
                  <span className={`pb-balance-tag ${balanced ? 'balanced' : 'unbalanced'}`}>
                    {balanced ? 'Équilibré' : 'Déséquilibré'}
                  </span>
                </div>
                {c.n_missing > 0 && (
                  <div className="pb-target-warn">⚠ {c.n_missing} valeur{c.n_missing > 1 ? 's' : ''} manquante{c.n_missing > 1 ? 's' : ''}</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {selCand && (
        <div className="pb-event-box">
          <div className="pb-event-label">
            Modalité à modéliser (l'événement)
            <span className="pb-config-hint">
              Fixe le signe du WOE, l'orientation de la matrice de confusion et le sens des déciles.
              L'AUC, elle, est identique dans les deux sens.
            </span>
          </div>
          <div className="pb-event-options">
            {selCand.values.map(v => {
              const active = (positiveClass ?? selCand.suggested_positive) === v
              const cnt    = selCand.value_counts?.[v]
              const tot    = selCand.value_counts
                ? Object.values(selCand.value_counts).reduce((a, b) => a + b, 0) : 0
              return (
                <label key={v} className={`pb-event-opt ${active ? 'pb-event-opt-active' : ''}`}>
                  <input
                    type="radio"
                    name="positive_class"
                    value={v}
                    checked={active}
                    onChange={() => onPositiveClassChange(v)}
                  />
                  <div>
                    <div className="pb-event-opt-title">
                      {v}
                      {v === selCand.suggested_positive && (
                        <span className="pb-event-sugg">suggéré</span>
                      )}
                    </div>
                    {cnt != null && tot > 0 && (
                      <div className="pb-event-opt-sub">
                        {cnt.toLocaleString('fr-FR')} obs · {(cnt / tot * 100).toFixed(1)} %
                      </div>
                    )}
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      )}

      <div className="modal-section-header" style={{ marginTop: '1.5rem' }}>
        <h3>⚙️ Configuration des pipelines</h3>
      </div>

      <div className="pb-config-grid">
        <div className="pb-config-block">
          <label className="pb-config-label">
            Seuil de cardinalité (Pipeline tree)
            <span className="pb-config-hint">≤ seuil → OHE · &gt; seuil → Target Encoding</span>
          </label>
          <div className="pb-bins-row">
            {[5, 10, 15, 20, 30].map(v => (
              <button
                key={v}
                className={`pb-bins-btn ${cardinality === v ? 'active' : ''}`}
                onClick={() => onCardinalityChange(v)}
              >{v}</button>
            ))}
          </div>
        </div>

        <div className="pb-config-block">
          <label className="pb-config-label">
            Bins WOE (Pipeline logit)
            <span className="pb-config-hint">Nombre de bins pour les variables continues</span>
          </label>
          <div className="pb-bins-row">
            {[5, 10, 15, 20].map(v => (
              <button
                key={v}
                className={`pb-bins-btn ${nBins === v ? 'active' : ''}`}
                onClick={() => onNBinsChange(v)}
              >{v}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Colonnes à exclure ── */}
      {allColumns && allColumns.length > 0 && (
        <>
          <div className="modal-section-header" style={{ marginTop: '1.5rem' }}>
            <h3>🗑 Colonnes à exclure</h3>
            <div className="modal-section-chips">
              {excludedCols.size > 0 && (
                <span className="rsummary-chip rsummary-mod">
                  {excludedCols.size} exclue{excludedCols.size > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <p className="pb-excl-hint">
            Les colonnes cochées seront retirées des deux datamarts avant l'encodage.
            Les colonnes de type ID/Code sont pré-sélectionnées.
          </p>
          <div className="pb-excl-grid">
            {allColumns.filter(c => c.col !== selectedTarget).map(({ col, dtype, suggested }) => {
              const checked = excludedCols.has(col)
              return (
                <label
                  key={col}
                  className={`pb-excl-row ${checked ? 'pb-excl-checked' : ''} ${suggested ? 'pb-excl-suggested' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleExclude(col)}
                  />
                  <span className="pb-excl-name" title={col}>{col}</span>
                  <code className="pb-excl-dtype">{dtype}</code>
                  {suggested && <span className="pb-excl-tag">ID suggéré</span>}
                </label>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Mini preview table ────────────────────────────────────────────────────────
function PipelinePreviewTable({ rows, columns, accentColor }) {
  const [open, setOpen] = useState(false)
  if (!rows || rows.length === 0) return null
  const cols = columns ?? Object.keys(rows[0])

  return (
    <div className="pb-preview-wrap">
      <button
        className="pb-preview-toggle"
        style={{ color: accentColor }}
        onClick={() => setOpen(o => !o)}
      >
        {open ? '▲' : '▼'} Aperçu ({rows.length} lignes)
      </button>
      {open && (
        <div className="pb-preview-scroll">
          <table className="pb-preview-table">
            <thead>
              <tr>
                {cols.map(c => <th key={c} title={c}>{c.length > 14 ? c.slice(0, 13) + '…' : c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {cols.map(c => {
                    const v = row[c]
                    const isNull = v === null || v === undefined
                    const isNum  = typeof v === 'number'
                    return (
                      <td key={c} className={isNull ? 'pb-cell-null' : ''}>
                        {isNull
                          ? <span className="pb-null-tag">NaN</span>
                          : isNum
                            ? <span className="pb-num-val">{Number(v).toFixed(3)}</span>
                            : String(v).length > 12 ? String(v).slice(0, 11) + '…' : String(v)
                        }
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Résultats des pipelines ───────────────────────────────────────────────────
function ResultPipelines({ result, sessionId }) {
  if (!result) return null
  const { logit_summary: ls, tree_summary: ts, target_col,
          logit_preview, tree_preview } = result

  const downloadUrl = (type) =>
    `/api/data-cleaning/pipeline/download/${type}?session_id=${sessionId}`

  return (
    <div className="result-content">
      <HeroBanner
        icon="✓"
        variant="success"
        title={`2 datamarts construits — cible : ${target_col}`}
        sub="Prêts pour l'entraînement en Data Modelling"
      />
      <div className="pb-results-grid">
        {/* Pipeline Logit */}
        <div className="pb-result-card pb-result-logit">
          <div className="pb-result-header">
            <span className="pb-result-icon">📈</span>
            <div>
              <div className="pb-result-title">Pipeline Logit (WOE)</div>
              <div className="pb-result-sub">Régression logistique · interprétable</div>
            </div>
          </div>
          <div className="pb-result-stats">
            <StatChip value={ls.n_rows}         label="lignes"          color="#6366f1" />
            <StatChip value={ls.n_features_woe} label="features WOE"   color="#6366f1" />
            <StatChip value={ls.n_numeric}      label="numériques"      />
            <StatChip value={ls.n_categorical}  label="catégorielles"   />
          </div>
          {ls.iv_summary && (
            <div className="pb-iv-row">
              {Object.entries(ls.iv_summary).filter(([, n]) => n > 0).map(([lbl, n]) => {
                const colors = { Inutile: '#9ca3af', Faible: '#f59e0b', Moyen: '#3b82f6', Fort: '#10b981', Suspect: '#ef4444' }
                return (
                  <span key={lbl} className="pb-iv-chip" style={{ color: colors[lbl], borderColor: colors[lbl] + '44' }}>
                    {n} {lbl}
                  </span>
                )
              })}
            </div>
          )}
          <PipelinePreviewTable rows={logit_preview} columns={ls.columns} accentColor="#6366f1" />
          <a className="btn-pb-download" href={downloadUrl('logit')} download>
            ⬇ Télécharger CSV
          </a>
        </div>

        {/* Pipeline Tree */}
        <div className="pb-result-card pb-result-tree">
          <div className="pb-result-header">
            <span className="pb-result-icon">🌲</span>
            <div>
              <div className="pb-result-title">Pipeline Tree-based</div>
              <div className="pb-result-sub">XGBoost · LightGBM · Random Forest</div>
            </div>
          </div>
          <div className="pb-result-stats">
            <StatChip value={ts.n_rows}       label="lignes"            color="#10b981" />
            <StatChip value={ts.n_cols - 1}   label="features"          color="#10b981" />
            <StatChip value={ts.n_numeric}    label="numériques"        />
            <StatChip value={ts.n_ohe}        label="OHE"               color="#f59e0b" />
            <StatChip value={ts.n_target_enc} label="Target Enc."       color="#ef4444" />
          </div>
          {ts.ohe_cols?.length > 0 && (
            <div className="pb-col-chips">
              <span className="pb-col-chips-label">OHE :</span>
              {ts.ohe_cols.map(c => <span key={c} className="pb-col-chip ohe">{c}</span>)}
            </div>
          )}
          {ts.te_cols?.length > 0 && (
            <div className="pb-col-chips">
              <span className="pb-col-chips-label">Target Enc. :</span>
              {ts.te_cols.map(c => <span key={c} className="pb-col-chip te">{c}</span>)}
            </div>
          )}
          <PipelinePreviewTable rows={tree_preview} columns={ts.columns} accentColor="#10b981" />
          <a className="btn-pb-download" href={downloadUrl('tree')} download>
            ⬇ Télécharger CSV
          </a>
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ═════════════════════════════════════════════════════════════════════════════
export default function DataCleaning({ activeFile, setCleaningSession }) {

  // pipelineState : idle | running | modal | applying | done
  const [pipelineState, setPipelineState] = useState('idle')

  // pipPhase : null | modal | building | done
  const [pipPhase, setPipPhase] = useState(null)

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

  // Pipeline builder
  const [targetCandidates,   setTargetCandidates]   = useState([])
  const [selectedTarget,     setSelectedTarget]     = useState(null)
  // Modalité de la cible modélisée comme l'événement (défaut, fraude…).
  // Détermine le signe du WOE, l'orientation de la matrice de confusion et les déciles.
  const [positiveClass,      setPositiveClass]      = useState(null)
  const [cardinalityThresh,  setCardinalityThresh]  = useState(10)
  const [nBinsPipeline,      setNBinsPipeline]      = useState(10)
  const [pipelineResult,     setPipelineResult]     = useState(null)
  const [excludedCols,       setExcludedCols]       = useState(new Set())

  // Vérification post-pipeline

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
    setPipPhase(null)
    setTargetCandidates([]); setSelectedTarget(null); setPositiveClass(null)
    setPipelineResult(null)
    setCardinalityThresh(10); setNBinsPipeline(10)
    setExcludedCols(new Set())
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

  // Choisir une cible réinitialise l'événement sur la modalité suggérée (la plus rare)
  const selectTarget = (col) => {
    setSelectedTarget(col)
    const cand = targetCandidates.find(c => c.column === col)
    setPositiveClass(cand?.suggested_positive ?? cand?.values?.[1] ?? null)
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
    setPipPhase(null)
    setTargetCandidates([]); setSelectedTarget(null); setPositiveClass(null)
    setPipelineResult(null)
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
      if (setCleaningSession) setCleaningSession(data.session_id)
      setDetectData(data)
      setDoublonsReport(data.doublons_report)
      setOutliersReport(data.outliers_report)
      setTargetCandidates(data.target_candidates ?? [])

      const nCols    = Object.keys(data.type_report || {}).length
      const nDbl     = data.doublons_report?.duplicates_found ?? 0
      const nOutCols = Object.keys(data.outliers_report || {}).length
      const nCands   = (data.target_candidates ?? []).length

      const init = {}
      Object.entries(data.type_report || {}).forEach(([col, r]) => { init[col] = r.detected_type })
      setUserTypes(init)

      addLog('types',    'success', `Types analysés — ${nCols} colonnes`)
      addLog('doublons', 'success', `Doublons analysés — ${nDbl} trouvé${nDbl > 1 ? 's' : ''}`)
      addLog('outliers', 'success', `Outliers analysés — ${nOutCols} colonne${nOutCols > 1 ? 's' : ''} affectée${nOutCols > 1 ? 's' : ''}`)
      addLog('pipeline', 'success', `Analyses terminées — ${nCands} variable${nCands > 1 ? 's' : ''} cible candidate${nCands > 1 ? 's' : ''} détectée${nCands > 1 ? 's' : ''}`)
      setPipelineState('modal')

    } catch (e) {
      addLog('pipeline', 'error', `Erreur pipeline : ${e.message}`)
      setPipelineState('idle')
    }
  }

  // ── ÉTAPE 2 : Confirmation dans le modal → application ───────────────────
  async function confirmAndApply() {
    if (!sessionId || pipelineState === 'applying') return
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
      const outReport   = data.outliers_result?.report || {}
      const outStrategy = outReport._meta?.strategy
      const nOutCols    = Object.keys(outReport).filter(k => k !== '_meta').length

      setTypesResult(data.types_result)
      setDoublonsResult(data.doublons_result?.report)
      setOutliersResult(data.outliers_result?.report)

      addLog('types',    'success', `${nTypesOk} colonnes converties`)
      addLog('doublons', 'success', `${nDbl} doublon${nDbl > 1 ? 's' : ''} supprimé${nDbl > 1 ? 's' : ''}`)
      const sPlur = nOutCols > 1 ? 's' : ''
      addLog('outliers', 'success',
        nOutCols === 0
          ? 'Aucun outlier à traiter'
          : outStrategy === 'keep'
            ? `${nOutCols} colonne${sPlur} avec outliers — conservés tels quels`
            : outStrategy === 'drop'
              ? `${nOutCols} colonne${sPlur} traitée${sPlur} — lignes aberrantes supprimées`
              : `${nOutCols} colonne${sPlur} winsorisée${sPlur}`)
      addLog('pipeline', 'success', '3/4 étapes terminées — Construction des pipelines à venir')

      setPipelineState('done')
      setActiveTab('types')

    } catch (e) {
      addLog('pipeline', 'error', `Application échouée : ${e.message}`)
      setPipelineState('modal')
    }
  }

  // ── Colonnes disponibles (avec détection ID) ─────────────────────────────
  const allColumnsForPipeline = (() => {
    const report = typesResult?.apply_report ?? detectData?.type_report ?? {}
    return Object.entries(report).map(([col, r]) => {
      const dtype = r.applied_type ?? r.detected_type ?? ''
      const suggested = dtype.toLowerCase().includes('id') ||
                        dtype.toLowerCase().includes('code') ||
                        col.toLowerCase().includes('id') ||
                        col.toLowerCase().includes('code') ||
                        col.toLowerCase().includes('key') ||
                        col.toLowerCase().includes('num') && dtype === 'object'
      return { col, dtype, suggested }
    })
  })()

  function openPipelineModal() {
    // Pré-cocher les colonnes suggérées comme ID
    const suggested = new Set(
      allColumnsForPipeline.filter(c => c.suggested).map(c => c.col)
    )
    setExcludedCols(suggested)
    setPipPhase('modal')
  }

  function toggleExclude(col) {
    setExcludedCols(prev => {
      const next = new Set(prev)
      next.has(col) ? next.delete(col) : next.add(col)
      return next
    })
  }

  // ── ÉTAPE 3 : Construction des deux pipelines ─────────────────────────────
  async function buildPipelines() {
    if (!sessionId || !selectedTarget || pipPhase === 'building') return
    setPipPhase('building')
    setPipelineResult(null)
    addLog('pipeline', 'running', `Construction des datamarts (cible : ${selectedTarget})…`)

    const fd = new FormData()
    fd.append('session_id',            sessionId)
    fd.append('target_col',            selectedTarget)
    fd.append('n_bins',                String(nBinsPipeline))
    fd.append('cardinality_threshold', String(cardinalityThresh))
    fd.append('smoothing',             '0.2')
    if (positiveClass != null) fd.append('positive_class', String(positiveClass))
    fd.append('excluded_cols', JSON.stringify([...excludedCols]))

    try {
      const res  = await fetch('/api/data-cleaning/pipeline/build', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || `Erreur HTTP ${res.status}`)

      setPipelineResult(data)
      addLog('pipeline', 'success',
        `Datamarts prêts — logit : ${data.logit_summary.n_features_woe} features WOE · tree : ${data.tree_summary.n_cols - 1} features`
      )
      addLog('pipeline', 'success', '✓ Pipeline complet — datasets prêts pour la modélisation')
      setPipPhase('done')
      setActiveTab('pipelines')

    } catch (e) {
      addLog('pipeline', 'error', `Construction échouée : ${e.message}`)
      setPipPhase('modal')
    }
  }

  // ── ÉTAPE 5 : Chargement du panneau de vérification ─────────────────────
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

  const progressPct = pipPhase === 'done' ? 100
    : pipelineState === 'done' ? 75
    : 0
  const progressLabel = pipPhase === 'done'    ? 'Pipeline complet ✓'
    : pipelineState === 'done'                 ? '3 / 4 étapes · Construction des pipelines à venir'
    : ''

  const pipBadge = CARD_BADGE[
    pipPhase === 'done'     ? 'done'
    : pipPhase === 'building' ? 'applying'
    : pipPhase === 'modal'    ? 'pending'
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
            <p className="task-desc">Analyse IQR · suppression, winsorisation ou conservation au choix</p>
          </div>
          {pipelineState === 'done' && outliersResult && (
            <div className="task-card-footer">
              <button className="btn-view" onClick={() => goToTab('outliers')}>👁 Voir les résultats</button>
            </div>
          )}
        </div>

        {/* Carte pipelines — séparée, pleine largeur */}
        {pipelineState === 'done' && (
          <div className="imp-card-row">
            <div
              className={`task-card imp-card
                ${pipPhase === 'done'     ? 'card-done'    : ''}
                ${pipPhase === 'building' ? 'card-running' : ''}
                ${pipPhase === 'modal'    ? 'card-pending' : ''}
                ${!pipPhase               ? 'card-locked'  : ''}`}
              style={{ '--tc': '#10b981' }}
            >
              <div className="task-card-top">
                <div className="task-icon" style={{ background: '#10b98118', color: '#10b981' }}>🔀</div>
                <span className={`task-badge ${pipBadge.cls}`}>
                  {pipPhase === 'building' && <span className="badge-spin" />}
                  {pipBadge.label}
                </span>
              </div>
              <div className="task-card-body">
                <h3 className="task-title">Construction des pipelines</h3>
                <p className="task-desc">
                  Pipeline Logit (WOE) · Pipeline Tree-based (OHE + Target Encoding)
                </p>
                {pipPhase === 'modal' && (
                  <p className="task-hint">💡 Sélectionnez la variable cible et configurez les pipelines.</p>
                )}
              </div>
              <div className="task-card-footer">
                {pipPhase === 'done'
                  ? (
                    <button className="btn-view" onClick={() => goToTab('pipelines')}>👁 Voir les résultats</button>
                  )
                  : !pipPhase && (
                    <button
                      className="btn-run"
                      style={{ '--btn-c': '#10b981' }}
                      onClick={openPipelineModal}
                    >
                      Construire les pipelines
                    </button>
                  )
                }
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Résultats ── */}
      {pipelineState === 'done' && (typesResult || doublonsResult || outliersResult || pipelineResult) && (
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
              {pipelineResult && (
                <button
                  className={`rtab ${activeTab === 'pipelines' ? 'rtab-active' : ''}`}
                  style={activeTab === 'pipelines' ? { '--rtab-c': '#10b981' } : {}}
                  onClick={() => setActiveTab('pipelines')}
                >🔀 Pipelines</button>
              )}
            </div>
          </div>
          <div className="results-panel-body">
            {activeTab === 'types'     && typesResult    && <TypesApplied   applyData={typesResult}  />}
            {activeTab === 'doublons'  && doublonsResult  && <ResultDoublons report={doublonsResult}  />}
            {activeTab === 'outliers'  && outliersResult  && <ResultOutliers report={outliersResult}  />}
            {activeTab === 'pipelines' && pipelineResult  && <ResultPipelines result={pipelineResult} sessionId={sessionId} />}
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
              <button
                className="btn-modal-confirm"
                onClick={confirmAndApply}
                disabled={pipelineState === 'applying'}
              >
                {pipelineState === 'applying' ? '⏳ Application en cours…' : '✓ Confirmer et appliquer'}
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
          MODAL PIPELINE BUILDER
          ══════════════════════════════════════════════════════════════════ */}
      {pipPhase === 'modal' && (
        <div className="modal-overlay" onClick={() => setPipPhase(null)}>
          <div className="pipeline-modal" onClick={e => e.stopPropagation()}>

            <div className="modal-header">
              <div>
                <h2 className="modal-title">🔀 Construction des pipelines</h2>
                <p className="modal-subtitle">
                  Sélectionnez la variable cible, configurez les pipelines, puis lancez.
                </p>
              </div>
              <button className="modal-close-btn" onClick={() => setPipPhase(null)} title="Annuler">✕</button>
            </div>

            <div className="modal-body">
              <PipelineBuilderSection
                targetCandidates={targetCandidates}
                selectedTarget={selectedTarget}
                onSelectTarget={selectTarget}
                positiveClass={positiveClass}
                onPositiveClassChange={setPositiveClass}
                cardinality={cardinalityThresh}
                onCardinalityChange={setCardinalityThresh}
                nBins={nBinsPipeline}
                onNBinsChange={setNBinsPipeline}
                allColumns={allColumnsForPipeline}
                excludedCols={excludedCols}
                onToggleExclude={toggleExclude}
              />
            </div>

            <div className="modal-footer">
              <button className="btn-modal-cancel" onClick={() => setPipPhase(null)}>Annuler</button>
              <button
                className="btn-modal-confirm"
                style={{ background: '#10b981' }}
                onClick={buildPipelines}
                disabled={!selectedTarget || pipPhase === 'building'}
              >
                {pipPhase === 'building' ? '⏳ Construction en cours…' : '🔀 Construire les pipelines'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Overlay building — pipelines */}
      {pipPhase === 'building' && (
        <div className="modal-overlay">
          <div className="applying-card">
            <span className="applying-spinner" style={{ borderTopColor: '#10b981', borderColor: '#d1fae5' }} />
            <div>
              <div className="applying-title">Construction des pipelines…</div>
              <div className="applying-sub">WOE · OHE · Target Encoding</div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          PANNEAU DE VÉRIFICATION
          ══════════════════════════════════════════════════════════════════ */}

    </div>
  )
}
