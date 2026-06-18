import numpy as np
import pandas as pd
from sklearn.multioutput import MultiOutputClassifier, ClassifierChain
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    hamming_loss, accuracy_score, f1_score,
    roc_auc_score, roc_curve, confusion_matrix,
)
from sklearn.preprocessing import LabelEncoder
from utils import safe_kde, roc_sample

TARGET_KEYWORDS = {
    'flag', 'default', 'fraud', 'risk', 'target', 'label',
    'churn', 'statut', 'status', 'indicateur', 'indicator',
    'defaut', 'incident', 'impaye', 'retard', 'late', 'bad',
    'event', 'outcome', 'resultat', 'result',
}


def _keyword_score(name: str) -> int:
    name_lower = name.lower()
    for kw in TARGET_KEYWORDS:
        if kw in name_lower:
            return 20
    return 0


def _safe_val(v):
    if v is None:
        return None
    if isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return round(float(v), 4)
    return v



def _compute_label_details(y_true: np.ndarray, y_prob: np.ndarray, label: str) -> dict:
    """Calcule ROC, Lift, KDE, CM et seuil optimal pour un label binaire."""
    # Seuil optimal (F1)
    thresholds = np.linspace(0.05, 0.95, 91)
    f1_scores  = [f1_score(y_true, (y_prob >= t).astype(int), zero_division=0) for t in thresholds]
    opt_thr    = float(thresholds[np.argmax(f1_scores)])
    y_pred     = (y_prob >= opt_thr).astype(int)

    # AUC / Gini / KS
    try:
        auc  = float(roc_auc_score(y_true, y_prob))
    except ValueError:
        auc  = 0.5
    gini = round(2 * auc - 1, 4)
    fpr_arr, tpr_arr, _ = roc_curve(y_true, y_prob)
    ks   = round(float(np.max(tpr_arr - fpr_arr)), 4)

    # Confusion matrix
    cm = confusion_matrix(y_true, y_pred).tolist()

    # Lift curve
    order           = np.argsort(y_prob)[::-1]
    y_sorted        = y_true[order]
    cum_pos         = np.cumsum(y_sorted)
    total_pos       = max(cum_pos[-1], 1)
    cum_pct_samples = np.arange(1, len(y_true) + 1) / len(y_true)
    cum_pct_pos     = cum_pos / total_pos
    lift            = cum_pct_pos / cum_pct_samples
    idx_lift        = np.linspace(0, len(cum_pct_samples) - 1, 100).astype(int)

    # KDE distribution
    x_kde  = np.linspace(0, 1, 100)
    prob_0 = y_prob[y_true == 0]
    prob_1 = y_prob[y_true == 1]
    kde_0  = safe_kde(prob_0, x_kde).tolist() if len(prob_0) >= 2 else [0.0] * 150
    kde_1  = safe_kde(prob_1, x_kde).tolist() if len(prob_1) >= 2 else [0.0] * 150

    return {
        "label":             label,
        "auc":               round(auc, 4),
        "gini":              gini,
        "ks":                ks,
        "f1":                round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
        "accuracy":          round(float(accuracy_score(y_true, y_pred)), 4),
        "support":           int(y_true.sum()),
        "optimal_threshold": round(opt_thr, 3),
        "confusion_matrix":  cm,
        "roc_curve":         roc_sample(fpr_arr, tpr_arr),
        "lift_curve": {
            "x":    [round(float(cum_pct_samples[i]), 4) for i in idx_lift],
            "lift": [round(float(lift[i]),            4) for i in idx_lift],
        },
        "prob_distribution": {
            "x":       [round(float(v), 4) for v in x_kde],
            "group_0": [round(float(v), 4) for v in kde_0],
            "group_1": [round(float(v), 4) for v in kde_1],
        },
    }


def detect_targets(df: pd.DataFrame) -> dict:
    n_rows = len(df)
    candidates = []
    excluded = []

    for col in df.columns:
        series = df[col].dropna()
        n_unique = int(series.nunique())
        total = len(series)

        # Exclure les identifiants (cardinalité > 50%)
        if n_unique / max(n_rows, 1) > 0.5:
            excluded.append({"name": col, "reason": "Identifiant (cardinalité trop élevée)"})
            continue

        # Exclure les colonnes texte libre (non numériques, non catégorielles binaires)
        if pd.api.types.is_object_dtype(series) and n_unique > 20:
            excluded.append({"name": col, "reason": "Texte libre"})
            continue

        score = 0
        reasons = []
        is_binary = False
        class_ratio = None

        # Critère 1 : type binaire strict (0/1 ou bool)
        if pd.api.types.is_bool_dtype(series):
            score += 60
            is_binary = True
            reasons.append("Booléen")
        elif n_unique == 2:
            vals = set(series.unique())
            if vals <= {0, 1} or vals <= {'0', '1'} or vals <= {True, False}:
                score += 60
                is_binary = True
                reasons.append("Binaire (0/1)")
            else:
                score += 40
                is_binary = True
                reasons.append("Binaire (2 valeurs)")
        elif 3 <= n_unique <= 10:
            score += 20
            reasons.append(f"{n_unique} valeurs uniques")

        # Critère 2 : mot-clé dans le nom
        kw = _keyword_score(col)
        if kw:
            score += kw
            reasons.append("Nom évocateur")

        # Critère 3 : déséquilibre de classes (typique d'une target de scoring)
        if is_binary and total > 0:
            try:
                counts = series.value_counts(normalize=True)
                minority_ratio = float(counts.min())
                class_ratio = round(minority_ratio, 4)
                if 0.01 <= minority_ratio <= 0.40:
                    score += 15
                    reasons.append(f"{round(minority_ratio*100, 1)}% positifs")
                elif minority_ratio < 0.01:
                    score -= 5  # trop déséquilibré, suspect
            except Exception:
                pass

        if score > 0:
            candidates.append({
                "name": col,
                "score": min(score, 100),
                "reasons": reasons,
                "n_unique": n_unique,
                "dtype": str(df[col].dtype),
                "is_binary": is_binary,
                "class_ratio": _safe_val(class_ratio),
            })

    candidates.sort(key=lambda x: x["score"], reverse=True)
    return {"candidates": candidates, "excluded": excluded}


def _encode_features(df: pd.DataFrame, target_cols: list,
                     encoders: dict = None) -> tuple[np.ndarray, list, dict]:
    """
    encoders=None  → mode fit  (train) : calcule les encoders et les retourne.
    encoders=dict  → mode apply (test) : applique les encoders du train sans refitter.
    Fix #4 : exclut les colonnes ID quasi-uniques (nunique/n > 95%).
    Fix #2 : LabelEncoder et médiane calculés sur train uniquement.
    """
    X = df.drop(columns=target_cols, errors='ignore').copy()

    # Fix #4 : exclure les colonnes identifiant
    n = max(len(X), 1)
    id_cols = [c for c in X.columns
               if pd.api.types.is_numeric_dtype(X[c]) and X[c].nunique() / n > 0.95]
    if id_cols:
        X = X.drop(columns=id_cols)

    fit_mode = encoders is None
    if fit_mode:
        encoders = {}

    for col in X.select_dtypes(include=['object', 'category']).columns:
        if fit_mode:
            le = LabelEncoder()
            le.fit(X[col].astype(str).unique())
            X[col] = le.transform(X[col].astype(str))
            encoders[col] = le
        else:
            le = encoders.get(col)
            if le is not None:
                known = set(le.classes_)
                X[col] = X[col].astype(str).apply(lambda v: v if v in known else le.classes_[0])
                X[col] = le.transform(X[col])
            else:
                X[col] = 0

    # Imputation médiane — calculée sur train uniquement
    if fit_mode:
        train_median = X.median(numeric_only=True)
        encoders['_median'] = train_median
    else:
        train_median = encoders.get('_median', pd.Series(dtype=float))

    X = X.fillna(train_median).fillna(0)
    feature_names = list(X.columns)
    return X.values.astype(float), feature_names, encoders


def _encode_targets(df: pd.DataFrame, target_cols: list) -> np.ndarray:
    Y = df[target_cols].copy()
    for col in Y.columns:
        if pd.api.types.is_bool_dtype(Y[col]):
            Y[col] = Y[col].astype(int)
        elif Y[col].dtype == object:
            le = LabelEncoder()
            Y[col] = le.fit_transform(Y[col].astype(str))
        Y[col] = pd.to_numeric(Y[col], errors='coerce').fillna(0).astype(int)
    return Y.values


def train_multilabel(
    df: pd.DataFrame,
    target_cols: list,
    model_type: str = 'random_forest',
    strategy: str = 'multioutput',
) -> dict:
    if not target_cols:
        raise ValueError("Aucune colonne cible sélectionnée")

    missing = [c for c in target_cols if c not in df.columns]
    if missing:
        raise ValueError(f"Colonnes introuvables : {missing}")

    # ClassifierChain exige au moins 2 labels
    if strategy == 'chain' and len(target_cols) < 2:
        raise ValueError("ClassifierChain nécessite au moins 2 colonnes cibles")

    df_clean = df.dropna(subset=target_cols).copy()
    if len(df_clean) < 20:
        raise ValueError("Pas assez de lignes après suppression des NaN sur les cibles")

    Y = _encode_targets(df_clean, target_cols)

    # Fix #6 : valider que toutes les cibles sont binaires
    non_binary = [target_cols[i] for i in range(Y.shape[1])
                  if len(np.unique(Y[:, i])) > 2]
    if non_binary:
        raise ValueError(
            f"Colonnes non-binaires : {non_binary}. "
            "Seules les cibles binaires (0/1) sont supportées."
        )

    # Fix #3 : split stratifié sur le premier label
    idx = np.arange(len(df_clean))
    try:
        train_idx, test_idx = train_test_split(
            idx, test_size=0.2, stratify=Y[:, 0], random_state=42
        )
    except ValueError:
        # Fallback si la classe minoritaire est trop petite pour stratifier
        train_idx, test_idx = train_test_split(idx, test_size=0.2, random_state=42)

    # Fix #2 : encoder sur train uniquement, appliquer au test
    df_train = df_clean.iloc[train_idx]
    df_test  = df_clean.iloc[test_idx]
    X_train, feature_names, encoders = _encode_features(df_train, target_cols)
    X_test,  _,             _        = _encode_features(df_test,  target_cols, encoders)
    Y_train, Y_test = Y[train_idx], Y[test_idx]

    base = _build_base_estimator(model_type)

    if strategy == 'chain':
        clf = ClassifierChain(base, order='random', random_state=42)
    else:
        clf = MultiOutputClassifier(base, n_jobs=-1)

    clf.fit(X_train, Y_train)
    Y_pred = clf.predict(X_test)

    # Probabilités par label
    if strategy == 'chain':
        Y_prob = clf.predict_proba(X_test)          # (n_samples, n_labels)
    else:
        Y_prob = np.column_stack(
            [est.predict_proba(X_test)[:, 1] for est in clf.estimators_]
        )

    # Métriques globales (basées sur predict, pas les probas)
    h_loss     = float(hamming_loss(Y_test, Y_pred))
    subset_acc = float(accuracy_score(Y_test, Y_pred))
    f1_micro   = float(f1_score(Y_test, Y_pred, average='micro', zero_division=0))
    f1_macro   = float(f1_score(Y_test, Y_pred, average='macro', zero_division=0))

    # Métriques détaillées par label
    per_label = []
    for i, col in enumerate(target_cols):
        try:
            details = _compute_label_details(Y_test[:, i], Y_prob[:, i], col)
        except Exception:
            y_true_i = Y_test[:, i]
            y_pred_i = Y_pred[:, i]
            details = {
                "label":    col,
                "f1":       round(float(f1_score(y_true_i, y_pred_i, zero_division=0)), 4),
                "accuracy": round(float(accuracy_score(y_true_i, y_pred_i)), 4),
                "support":  int(y_true_i.sum()),
            }
        per_label.append(details)

    # Feature importance — RandomForest uniquement
    feature_importance = []
    if model_type == 'random_forest':
        if strategy == 'chain':
            # Chaque estimateur de la chaîne a n_features + k colonnes supplémentaires
            # (labels précédents). On moyenne uniquement les n_features originales.
            n_orig = len(feature_names)
            importances = np.mean(
                [est.feature_importances_[:n_orig] for est in clf.estimators_], axis=0
            )
        else:
            importances = np.mean(
                [est.feature_importances_ for est in clf.estimators_], axis=0
            )
        top_idx = np.argsort(importances)[::-1][:15]
        for idx in top_idx:
            feature_importance.append({
                "feature":    feature_names[idx],
                "importance": round(float(importances[idx]), 4),
            })

    return {
        "n_train":      int(len(X_train)),
        "n_test":       int(len(X_test)),
        "n_features":   len(feature_names),
        "model_type":   model_type,
        "strategy":     strategy,
        "target_cols":  target_cols,
        "global_metrics": {
            "hamming_loss":    round(h_loss, 4),
            "subset_accuracy": round(subset_acc, 4),
            "f1_micro":        round(f1_micro, 4),
            "f1_macro":        round(f1_macro, 4),
        },
        "per_label":          per_label,
        "feature_importance": feature_importance,
    }


def _build_base_estimator(model_type: str):
    if model_type == 'random_forest':
        return RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
    if model_type == 'logistic_regression':
        return LogisticRegression(max_iter=1000, random_state=42)
    if model_type == 'xgboost':
        try:
            from xgboost import XGBClassifier
            return XGBClassifier(
                n_estimators=100, random_state=42,
                eval_metric='logloss', verbosity=0
            )
        except ImportError:
            raise ValueError("XGBoost non installé")
    raise ValueError(f"Modèle inconnu : {model_type}")
