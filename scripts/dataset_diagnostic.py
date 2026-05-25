"""
dataset_diagnostic.py — Diagnostic autonome du pouvoir prédictif d'un dataset.

Usage :
    python scripts/dataset_diagnostic.py \
        --logit-path data/datamart_logit.csv \
        --tree-path  data/datamart_tree.csv \
        --target     survived
"""

import argparse
import json
import warnings
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import LabelEncoder
from scipy.spatial.distance import mahalanobis
from scipy.stats import spearmanr

warnings.filterwarnings('ignore')


# ─────────────────────────────────────────────────────────────────────────────
# Utilitaires
# ─────────────────────────────────────────────────────────────────────────────

def _encode_features(df: pd.DataFrame, target_col: str) -> tuple[np.ndarray, np.ndarray]:
    """Retourne (X_imp, y) : features numériques imputées + cible binaire 0/1."""
    feature_cols = [c for c in df.columns if c != target_col]
    target_series = df[target_col].dropna()
    vals = sorted(target_series.unique(), key=str)
    target_map = {vals[0]: 0, vals[1]: 1}
    y = df[target_col].map(target_map).dropna().astype(int).values

    X = df[feature_cols].copy()
    for col in X.select_dtypes(exclude=[np.number]).columns:
        le = LabelEncoder()
        mask = X[col].notna()
        X.loc[mask, col] = le.fit_transform(X.loc[mask, col].astype(str))
        X[col] = pd.to_numeric(X[col], errors='coerce')

    imp = SimpleImputer(strategy='median')
    X_imp = imp.fit_transform(X.values.astype(float))

    # Aligner les longueurs (dropna sur target peut réduire)
    valid_idx = df[target_col].map(target_map).dropna().index
    mask_valid = df.index.isin(valid_idx)
    X_imp = X_imp[mask_valid]

    return X_imp, y, list(X.columns)


def _safe_auc(y_true, y_score) -> float:
    """AUC robuste : retourne 0.5 si une seule classe présente."""
    if len(np.unique(y_true)) < 2:
        return 0.5
    try:
        return float(roc_auc_score(y_true, y_score))
    except Exception:
        return 0.5


# ─────────────────────────────────────────────────────────────────────────────
# 1. Qualité de la cible
# ─────────────────────────────────────────────────────────────────────────────

def analyse_target(df: pd.DataFrame, target_col: str) -> dict:
    series = df[target_col].dropna()
    vals   = sorted(series.unique(), key=str)
    counts = series.value_counts()
    minority_ratio = float(counts.min() / counts.sum())
    return {
        'n_classes':      int(series.nunique()),
        'minority_ratio': round(minority_ratio, 4),
        'is_binary':      series.nunique() == 2,
        'class_counts':   {str(k): int(v) for k, v in counts.items()},
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2. Analyse des IV
# ─────────────────────────────────────────────────────────────────────────────

def analyse_iv(df_logit: pd.DataFrame, target_col: str) -> dict:
    """
    Reconstitue les IV depuis le datamart logit (colonnes *_woe).
    Comme les valeurs WOE sont continues, on estime l'IV via la corrélation
    avec la cible — une approximation raisonnable quand le woe_report n'est pas dispo.
    Si les colonnes WOE sont bien nommées, on peut calculer l'IV directement.
    """
    woe_cols = [c for c in df_logit.columns
                if c != target_col and c.endswith('_woe')]

    if not woe_cols:
        woe_cols = [c for c in df_logit.columns if c != target_col]

    target_series = df_logit[target_col].dropna()
    vals = sorted(target_series.unique(), key=str)
    target_map = {vals[0]: 0, vals[1]: 1}
    y = df_logit[target_col].map(target_map).dropna()

    iv_values = {}
    for col in woe_cols:
        col_data = df_logit[col].loc[y.index].fillna(0).values
        y_vals   = y.values
        # IV = sum((P(X|Y=1) - P(X|Y=0)) * WOE) — approximé via corrélation absolue
        # Pour un datamart WOE, la corrélation avec y encode directement l'IV
        if np.std(col_data) < 1e-10:
            iv_values[col] = 0.0
            continue
        corr = float(np.corrcoef(col_data, y_vals)[0, 1])
        # Transformation conservative en pseudo-IV : corr² * constante
        # (borne supérieure approximative, cohérente avec le barème IV)
        iv_values[col] = round(abs(corr) ** 2 * 0.5, 4)

    ivs = list(iv_values.values())
    n_useless = sum(v < 0.02  for v in ivs)
    n_weak    = sum(0.02 <= v < 0.1  for v in ivs)
    n_medium  = sum(0.1  <= v < 0.3  for v in ivs)
    n_strong  = sum(v >= 0.3  for v in ivs)

    return {
        'n_features': len(ivs),
        'n_useless':  n_useless,
        'n_weak':     n_weak,
        'n_medium':   n_medium,
        'n_strong':   n_strong,
        'max_iv':     round(max(ivs), 4) if ivs else 0.0,
        'mean_iv':    round(float(np.mean(ivs)), 4) if ivs else 0.0,
        'per_feature': {k: v for k, v in sorted(iv_values.items(),
                                                  key=lambda x: x[1], reverse=True)},
    }


# ─────────────────────────────────────────────────────────────────────────────
# 3. Distribution des probabilités prédites
# ─────────────────────────────────────────────────────────────────────────────

def analyse_proba_spread(X: np.ndarray, y: np.ndarray) -> dict:
    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )
    clf = LogisticRegression(max_iter=500, solver='saga', penalty='l1',
                             C=1.0, random_state=42)
    try:
        clf.fit(X_tr, y_tr)
        probas = clf.predict_proba(X_te)[:, 1]
    except Exception:
        probas = np.full(len(y_te), 0.5)

    std_val   = float(np.std(probas))
    range_val = float(probas.max() - probas.min())

    by_class = {}
    for c in [0, 1]:
        mask = y_te == c
        if mask.sum() > 0:
            by_class[str(c)] = {
                'median': round(float(np.median(probas[mask])), 4),
                'min':    round(float(probas[mask].min()), 4),
                'max':    round(float(probas[mask].max()), 4),
            }

    return {
        'std':      round(std_val, 4),
        'range':    round(range_val, 4),
        'is_flat':  std_val < 0.05,
        'by_class': by_class,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 4. Détection de data leakage
# ─────────────────────────────────────────────────────────────────────────────

def detect_leakage(X: np.ndarray, y: np.ndarray, feature_names: list) -> list:
    suspects = []
    cv = StratifiedKFold(n_splits=3, shuffle=True, random_state=42)

    for i, name in enumerate(feature_names):
        col = X[:, i]
        if np.std(col) < 1e-10:
            continue

        # Corrélation de Pearson
        corr_p = float(np.corrcoef(col, y)[0, 1])
        # Corrélation de Spearman
        corr_s, _ = spearmanr(col, y)

        if abs(corr_p) > 0.8 or abs(float(corr_s)) > 0.8:
            suspects.append({
                'feature':     name,
                'reason':      'high_correlation',
                'pearson':     round(corr_p, 4),
                'spearman':    round(float(corr_s), 4),
            })
            continue

        # AUC univariée
        x_col = col.reshape(-1, 1)
        try:
            aucs = cross_val_score(
                DecisionTreeClassifier(max_depth=3, random_state=42),
                x_col, y, cv=cv, scoring='roc_auc',
            )
            auc_val = float(np.mean(aucs))
        except Exception:
            auc_val = 0.5

        if auc_val > 0.9:
            suspects.append({
                'feature':  name,
                'reason':   'high_univariate_auc',
                'auc':      round(auc_val, 4),
                'pearson':  round(corr_p, 4),
                'spearman': round(float(corr_s), 4),
            })

    return suspects


# ─────────────────────────────────────────────────────────────────────────────
# 5. Benchmarks univariés
# ─────────────────────────────────────────────────────────────────────────────

def univariate_benchmarks(X: np.ndarray, y: np.ndarray,
                           feature_names: list) -> tuple[dict, list]:
    cv = StratifiedKFold(n_splits=3, shuffle=True, random_state=42)
    results = []

    for i, name in enumerate(feature_names):
        col = X[:, i].reshape(-1, 1)
        if np.std(X[:, i]) < 1e-10:
            results.append({'feature': name, 'auc': 0.5})
            continue
        try:
            aucs = cross_val_score(
                DecisionTreeClassifier(max_depth=1, random_state=42),
                col, y, cv=cv, scoring='roc_auc',
            )
            auc_val = float(np.mean(aucs))
        except Exception:
            auc_val = 0.5
        results.append({'feature': name, 'auc': round(auc_val, 4)})

    results.sort(key=lambda r: r['auc'], reverse=True)
    best = results[0] if results else {'feature': 'none', 'auc': 0.5}
    return best, results


# ─────────────────────────────────────────────────────────────────────────────
# 6. Test de permutation
# ─────────────────────────────────────────────────────────────────────────────

def permutation_test(X: np.ndarray, y: np.ndarray,
                     n_permutations: int = 5) -> dict:
    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )
    clf = RandomForestClassifier(n_estimators=50, max_depth=5,
                                 random_state=42, n_jobs=-1)
    clf.fit(X_tr, y_tr)
    real_auc = _safe_auc(y_te, clf.predict_proba(X_te)[:, 1])

    perm_aucs = []
    rng = np.random.default_rng(42)
    for _ in range(n_permutations):
        y_perm = rng.permutation(y_tr)
        clf_p  = RandomForestClassifier(n_estimators=50, max_depth=5,
                                        random_state=42, n_jobs=-1)
        clf_p.fit(X_tr, y_perm)
        perm_aucs.append(_safe_auc(y_te, clf_p.predict_proba(X_te)[:, 1]))

    perm_mean = float(np.mean(perm_aucs))
    perm_std  = float(np.std(perm_aucs))
    is_significant = real_auc > perm_mean + 2 * perm_std

    return {
        'real_auc':           round(real_auc, 4),
        'permuted_auc_mean':  round(perm_mean, 4),
        'permuted_auc_std':   round(perm_std, 4),
        'is_significant':     is_significant,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 7. Séparabilité des classes
# ─────────────────────────────────────────────────────────────────────────────

def class_separability(X: np.ndarray, y: np.ndarray) -> float:
    """
    Retourne un overlap ratio entre 0 (parfaitement séparables) et 1 (superposées).
    Basé sur la distance de Bhattacharyya approchée via PCA 2D.
    """
    n_components = min(2, X.shape[1], X.shape[0] - 1)
    pca   = PCA(n_components=n_components)
    X_pca = pca.fit_transform(X)

    X0 = X_pca[y == 0]
    X1 = X_pca[y == 1]

    if len(X0) < 2 or len(X1) < 2:
        return 1.0

    mu0, mu1 = X0.mean(axis=0), X1.mean(axis=0)
    cov0     = np.cov(X0.T) if X0.shape[1] > 1 else np.array([[np.var(X0)]])
    cov1     = np.cov(X1.T) if X1.shape[1] > 1 else np.array([[np.var(X1)]])

    # Assurer que les matrices sont 2D
    if cov0.ndim == 0: cov0 = np.array([[float(cov0)]])
    if cov1.ndim == 0: cov1 = np.array([[float(cov1)]])

    cov_mean = (cov0 + cov1) / 2

    try:
        # Coefficient de Bhattacharyya
        sign, logdet_mean = np.linalg.slogdet(cov_mean)
        _, logdet0        = np.linalg.slogdet(cov0)
        _, logdet1        = np.linalg.slogdet(cov1)

        diff    = mu1 - mu0
        inv_cov = np.linalg.pinv(cov_mean)
        term1   = 0.125 * float(diff @ inv_cov @ diff)
        term2   = 0.5   * (logdet_mean - 0.5 * (logdet0 + logdet1))
        bc_dist = term1 + term2

        # Convertir en overlap (0 = séparés, 1 = superposés)
        overlap = float(np.exp(-bc_dist))
        return round(min(max(overlap, 0.0), 1.0), 4)
    except np.linalg.LinAlgError:
        return 1.0


# ─────────────────────────────────────────────────────────────────────────────
# Verdict automatique
# ─────────────────────────────────────────────────────────────────────────────

def _determine_verdict(iv_summary: dict, perm_test: dict, leakage: list,
                       best_uni: dict, proba_spread: dict) -> tuple[str, str]:
    if leakage:
        return 'leakage', 'high'

    if not perm_test['is_significant']:
        return 'no_signal', 'high'

    if iv_summary['max_iv'] < 0.02 and best_uni['auc'] < 0.6:
        return 'no_signal', 'medium'

    # Signal en brut mais pas après WOE → problème de pipeline
    if best_uni['auc'] > 0.65 and iv_summary['max_iv'] < 0.05:
        return 'pipeline_issue', 'medium'

    if iv_summary['max_iv'] < 0.1 or proba_spread['is_flat']:
        return 'weak_signal', 'medium'

    return 'weak_signal', 'low'


def _build_recommendations(verdict: str, iv_summary: dict, perm_test: dict,
                            leakage: list, best_uni: dict,
                            proba_spread: dict, overlap: float) -> list:
    recs = []

    if leakage:
        names = [s['feature'] for s in leakage]
        recs.append(
            f"⚠️ PRIORITÉ 1 — Suspecter un data leakage sur : {names}. "
            "Ces features sont trop corrélées à la cible pour être légitimes."
        )

    if not perm_test['is_significant']:
        recs.append(
            "🚫 PRIORITÉ 1 — Le modèle n'apprend rien au-delà du hasard "
            f"(AUC réelle {perm_test['real_auc']} ≈ AUC permutée "
            f"{perm_test['permuted_auc_mean']}). "
            "La cible est probablement du bruit ou mal définie."
        )

    if iv_summary['max_iv'] < 0.02:
        recs.append(
            "📉 PRIORITÉ 2 — Aucune feature n'a d'IV significatif (< 0.02). "
            "Envisager de nouvelles sources de données ou un feature engineering plus poussé."
        )

    if best_uni['auc'] > 0.65 and iv_summary['max_iv'] < 0.05:
        recs.append(
            f"🔧 PRIORITÉ 2 — Signal détecté en brut (meilleure feature univariée : "
            f"{best_uni['feature']}, AUC={best_uni['auc']}) mais pas après WOE. "
            "Vérifier le pipeline de transformation (n_bins trop faible, outliers, encodage)."
        )

    if proba_spread['is_flat']:
        recs.append(
            f"📊 PRIORITÉ 3 — Probabilités très concentrées (spread std={proba_spread['std']}). "
            "Essayer class_weight='balanced' ou augmenter la régularisation (C plus petit)."
        )

    if overlap > 0.85:
        recs.append(
            f"🔀 PRIORITÉ 3 — Les deux classes sont quasi-indiscernables (overlap={overlap}). "
            "Des variables externes sont probablement nécessaires."
        )

    if not recs:
        recs.append(
            "✅ Signal faible mais présent. Optimiser les hyperparamètres, "
            "enrichir les features ou collecter plus de données."
        )

    return recs


# ─────────────────────────────────────────────────────────────────────────────
# Fonction principale
# ─────────────────────────────────────────────────────────────────────────────

def run_diagnostic(df_logit: pd.DataFrame, df_tree: pd.DataFrame,
                   target_col: str) -> dict:

    print("  [1/7] Analyse de la cible…")
    target_info = analyse_target(df_logit, target_col)

    print("  [2/7] Analyse des IV (datamart logit)…")
    iv_summary = analyse_iv(df_logit, target_col)

    print("  [3/7] Encodage du datamart tree…")
    X_tree, y_tree, feat_names = _encode_features(df_tree, target_col)

    print("  [4/7] Distribution des probabilités prédites (logit)…")
    X_logit, y_logit, _ = _encode_features(df_logit, target_col)
    proba_spread = analyse_proba_spread(X_logit, y_logit)

    print("  [5/7] Détection de data leakage…")
    leakage_suspects = detect_leakage(X_tree, y_tree, feat_names)

    print("  [6/7] Benchmarks univariés…")
    best_uni, all_uni = univariate_benchmarks(X_tree, y_tree, feat_names)

    print("  [7/7] Test de permutation + séparabilité…")
    perm_result = permutation_test(X_tree, y_tree)
    overlap     = class_separability(X_tree, y_tree)

    verdict, confidence = _determine_verdict(
        iv_summary, perm_result, leakage_suspects, best_uni, proba_spread
    )
    recommendations = _build_recommendations(
        verdict, iv_summary, perm_result,
        leakage_suspects, best_uni, proba_spread, overlap
    )

    return {
        'verdict':        verdict,
        'confidence':     confidence,
        'target_info':    target_info,
        'iv_summary':     {
            'n_features': iv_summary['n_features'],
            'n_useless':  iv_summary['n_useless'],
            'n_weak':     iv_summary['n_weak'],
            'n_medium':   iv_summary['n_medium'],
            'n_strong':   iv_summary['n_strong'],
            'max_iv':     iv_summary['max_iv'],
            'mean_iv':    iv_summary['mean_iv'],
        },
        'proba_spread':       proba_spread,
        'leakage_suspects':   [s['feature'] for s in leakage_suspects],
        'leakage_details':    leakage_suspects,
        'best_univariate':    best_uni,
        'top5_univariate':    all_uni[:5],
        'permutation_test':   perm_result,
        'class_overlap':      overlap,
        'recommendations':    recommendations,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Point d'entrée CLI
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Diagnostic du pouvoir prédictif d\'un dataset.')
    parser.add_argument('--logit-path', required=True, help='Chemin vers le CSV du datamart logit')
    parser.add_argument('--tree-path',  required=True, help='Chemin vers le CSV du datamart tree')
    parser.add_argument('--target',     required=True, help='Nom de la colonne cible')
    args = parser.parse_args()

    print(f"\n🔬 Diagnostic — cible : '{args.target}'")
    print(f"   logit : {args.logit_path}")
    print(f"   tree  : {args.tree_path}\n")

    df_logit = pd.read_csv(args.logit_path)
    df_tree  = pd.read_csv(args.tree_path)

    report = run_diagnostic(df_logit, df_tree, args.target)

    print("\n" + "═" * 60)
    print(f"  VERDICT : {report['verdict'].upper()}  (confiance : {report['confidence']})")
    print("═" * 60)
    print(json.dumps(report, indent=2, ensure_ascii=False))
