"""
services/data_quality_service.py
─────────────────────────────────
Compartiment 1 — Data Quality
Toute la logique métier d'analyse qualité des données.
"""

import pandas as pd
import numpy as np
import io
import os


"""
Ajouter dans services/data_quality_service.py
─────────────────────────────────────────────
Fonction qui génère le rapport HTML ydata_profiling en mémoire.
"""

from ydata_profiling import ProfileReport


def generate_profile_html(df, title: str = "Rapport Qualité") -> str:
    """
    Génère le rapport ydata_profiling et retourne le HTML brut (string).
    Rien n'est écrit sur disque.
    """
    # Pour les grands datasets (>10k lignes), on échantillonne pour rester dans le timeout
    # Les calculs complets (correlations, interactions) sont conservés sur l'échantillon
    sample_df = df.sample(n=min(len(df), 10_000), random_state=42) if len(df) > 10_000 else df

    profile = ProfileReport(
        sample_df,
        title=title,
        minimal=False,
        explorative=False,
        progress_bar=False,
    )
    return profile.to_html()   # ← retourne le HTML comme string
# ══════════════════════════════════════════════════════════════════════════════
# CHARGEMENT DYNAMIQUE (CSV, Excel, JSON, Parquet)
# ══════════════════════════════════════════════════════════════════════════════

def load_dataframe(file_storage) -> pd.DataFrame:
    """
    Charge un DataFrame depuis un fichier uploadé Flask (werkzeug FileStorage).
    Supporte : CSV, Excel, JSON, Parquet.
    """
    filename = file_storage.filename.lower()
    content  = file_storage.read()
    buf      = io.BytesIO(content)

    if filename.endswith(".csv"):
        return pd.read_csv(buf)
    elif filename.endswith((".xlsx", ".xls")):
        return pd.read_excel(buf)
    elif filename.endswith(".json"):
        return pd.read_json(buf)
    elif filename.endswith(".parquet"):
        return pd.read_parquet(buf)
    else:
        ext = os.path.splitext(filename)[1]
        raise ValueError(f"Format non supporté : '{ext}'. Acceptés : CSV, Excel, JSON, Parquet")


def load_dataframe_from_path(filepath: str) -> pd.DataFrame:
    """Charge depuis un chemin local (compatibilité avec l'ancien /api/analyze)."""
    ext = os.path.splitext(filepath)[1].lower()
    readers = {
        ".csv":     pd.read_csv,
        ".xlsx":    pd.read_excel,
        ".xls":     pd.read_excel,
        ".json":    pd.read_json,
        ".parquet": pd.read_parquet,
    }
    if ext not in readers:
        raise ValueError(f"Format non supporté : '{ext}'")
    return readers[ext](filepath)


# ══════════════════════════════════════════════════════════════════════════════
# ANALYSE PAR COLONNE
# ══════════════════════════════════════════════════════════════════════════════

def _analyze_column(series: pd.Series) -> dict:
    """Analyse complète d'une colonne individuelle."""
    n_total   = len(series)
    n_missing = int(series.isnull().sum())
    n_unique  = int(series.nunique())
    dtype_str = str(series.dtype)

    # ── Type sémantique ──────────────────────────────────────────────────────
    if pd.api.types.is_numeric_dtype(series):
        if n_unique == 2:
            semantic = "binary"
        elif n_unique <= 10:
            semantic = "categorical_numeric"
        else:
            semantic = "numeric"
    elif pd.api.types.is_datetime64_any_dtype(series):
        semantic = "datetime"
    elif dtype_str == "bool":
        semantic = "binary"
    elif dtype_str == "object":
        ratio = n_unique / n_total if n_total > 0 else 0
        if n_unique == 2:
            semantic = "binary"
        elif n_unique <= 20:
            semantic = "categorical"
        elif ratio > 0.85:
            semantic = "identifier"
        else:
            semantic = "text"
    else:
        semantic = "unknown"

    info = {
        "dtype":        dtype_str,
        "semantic_type": semantic,
        "n_unique":     n_unique,
        "missing_count": n_missing,
        "missing_pct":  round(n_missing / n_total * 100, 2) if n_total > 0 else 0,
        "completeness": round((1 - n_missing / n_total) * 100, 2) if n_total > 0 else 0,
    }

    # ── Stats numériques ─────────────────────────────────────────────────────
    if semantic in ("numeric", "categorical_numeric", "binary") and pd.api.types.is_numeric_dtype(series):
        clean = series.dropna()
        if len(clean) > 0:
            q1, q3 = clean.quantile(0.25), clean.quantile(0.75)
            iqr    = q3 - q1
            info["stats"] = {
                "min":    _safe_float(clean.min()),
                "max":    _safe_float(clean.max()),
                "mean":   _safe_float(clean.mean()),
                "median": _safe_float(clean.median()),
                "std":    _safe_float(clean.std()),
                "q1":     _safe_float(q1),
                "q3":     _safe_float(q3),
            }
            # Outliers (méthode IQR × 1.5)
            lower  = q1 - 1.5 * iqr
            upper  = q3 + 1.5 * iqr
            n_out  = int(((clean < lower) | (clean > upper)).sum())
            info["outliers"] = {
                "count":    n_out,
                "pct":      round(n_out / len(clean) * 100, 2),
                "lower_bound": _safe_float(lower),
                "upper_bound": _safe_float(upper),
            }

    # ── Valeurs fréquentes (cat / binaire) ───────────────────────────────────
    if semantic in ("categorical", "categorical_numeric", "binary", "identifier"):
        top = series.value_counts(dropna=True).head(5)
        info["top_values"] = [
            {"value": str(k), "count": int(v), "pct": round(v / n_total * 100, 2)}
            for k, v in top.items()
        ]

    return info


def _safe_float(val):
    """Convertit en float Python natif (évite les NaN/inf non sérialisables)."""
    try:
        v = float(val)
        return None if (np.isnan(v) or np.isinf(v)) else round(v, 4)
    except (ValueError, TypeError):
        return None


# ══════════════════════════════════════════════════════════════════════════════
# SCORE QUALITÉ GLOBAL
# ══════════════════════════════════════════════════════════════════════════════

SCORE_WEIGHTS = {
    "completeness": 0.35,
    "uniqueness":   0.25,
    "consistency":  0.20,
    "validity":     0.20,
}


def _score_completeness(df: pd.DataFrame) -> dict:
    total   = df.size
    missing = int(df.isnull().sum().sum())
    score   = round((1 - missing / total) * 100, 2) if total > 0 else 100

    flagged = {
        col: round(pct, 2)
        for col, pct in (df.isnull().mean() * 100).items()
        if pct > 20
    }
    return {"score": score, "missing_total": missing, "flagged_columns": flagged}


def _score_uniqueness(df: pd.DataFrame) -> dict:
    n_dup  = int(df.duplicated().sum())
    score  = round((1 - n_dup / len(df)) * 100, 2) if len(df) > 0 else 100
    return {"score": score, "duplicate_rows": n_dup,
            "duplicate_pct": round(n_dup / len(df) * 100, 2) if len(df) > 0 else 0}


def _score_consistency(df: pd.DataFrame) -> dict:
    issues = []
    for col in df.select_dtypes(include="object").columns:
        sample    = df[col].dropna().head(300)
        num_count = pd.to_numeric(sample, errors="coerce").notna().sum()
        if 0 < num_count < len(sample) * 0.9:
            issues.append({"column": col, "issue": "types mixtes (texte + numérique)"})

    date_kw = ["date", "time", "created", "updated", "timestamp", "dt"]
    for col in df.select_dtypes(include="object").columns:
        if any(kw in col.lower() for kw in date_kw):
            try:
                pd.to_datetime(df[col].dropna().head(50), errors="raise")
                issues.append({"column": col, "issue": "date stockée comme texte"})
            except (ValueError, TypeError):
                pass

    # Dénominateur = colonnes object uniquement (seules concernées par ces issues)
    n_object_cols = len(df.select_dtypes(include="object").columns)
    score = round(max(0, (1 - len(issues) / max(n_object_cols, 1))) * 100, 2)
    return {"score": score, "issues": issues}


def _score_validity(df: pd.DataFrame) -> dict:
    outlier_cols = {}
    for col in df.select_dtypes(include=[np.number]).columns:
        clean = df[col].dropna()
        if len(clean) < 4:
            continue
        q1, q3 = clean.quantile(0.25), clean.quantile(0.75)
        iqr    = q3 - q1
        lo, hi = q1 - 3 * iqr, q3 + 3 * iqr
        n_out  = int(((clean < lo) | (clean > hi)).sum())
        if n_out > 0:
            outlier_cols[col] = {
                "count": n_out,
                "pct":   round(n_out / len(clean) * 100, 2)
            }

    n_num = len(df.select_dtypes(include=[np.number]).columns)
    if outlier_cols:
        # Pondéré par le % d'outliers dans chaque colonne, pas juste leur présence
        avg_outlier_pct = sum(v["pct"] for v in outlier_cols.values()) / max(n_num, 1)
        score = round(max(0, 100 - avg_outlier_pct), 2)
    else:
        score = 100.0
    return {"score": score, "outlier_columns": outlier_cols}


def compute_quality_score(df: pd.DataFrame) -> dict:
    """Calcule le score qualité global (4 dimensions pondérées)."""
    dimensions = {
        "completeness": _score_completeness(df),
        "uniqueness":   _score_uniqueness(df),
        "consistency":  _score_consistency(df),
        "validity":     _score_validity(df),
    }

    global_score = sum(
        dimensions[dim]["score"] * SCORE_WEIGHTS[dim]
        for dim in SCORE_WEIGHTS
    )
    global_score = round(global_score, 2)

    if global_score >= 90:
        grade = "Excellent"
    elif global_score >= 75:
        grade = "Acceptable"
    elif global_score >= 60:
        grade = "Dégradé"
    else:
        grade = "Critique"

    return {
        "global_score": global_score,
        "grade":        grade,
        "weights":      SCORE_WEIGHTS,
        "dimensions":   dimensions,
    }


# ══════════════════════════════════════════════════════════════════════════════
# RAPPORT COMPLET
# ══════════════════════════════════════════════════════════════════════════════

def build_quality_report(df: pd.DataFrame, filename: str = "") -> dict:
    """
    Rapport qualité complet retourné à Express.
    Contient : aperçu, analyse par colonne, score global, alertes.
    """
    # ── Aperçu général ───────────────────────────────────────────────────────
    overview = {
        "filename":   filename,
        "rows":       int(df.shape[0]),
        "columns":    int(df.shape[1]),
        "total_cells": int(df.size),
        "memory_mb":  round(df.memory_usage(deep=True).sum() / 1024 / 1024, 3),
        "column_names": df.columns.tolist(),
        "sample":     df.head(5).fillna("").to_dict(orient="records"),
    }

    # ── Analyse par colonne ──────────────────────────────────────────────────
    columns_analysis = {col: _analyze_column(df[col]) for col in df.columns}

    # ── Score qualité ────────────────────────────────────────────────────────
    quality_score = compute_quality_score(df)

    # ── Alertes consolidées ──────────────────────────────────────────────────
    alerts = []

    flagged = quality_score["dimensions"]["completeness"]["flagged_columns"]
    if flagged:
        alerts.append({
            "level": "warning",
            "type":  "missing_values",
            "message": f"{len(flagged)} colonne(s) avec >20% de valeurs manquantes",
            "detail": flagged
        })

    dup = quality_score["dimensions"]["uniqueness"]["duplicate_rows"]
    if dup > 0:
        alerts.append({
            "level": "warning",
            "type":  "duplicates",
            "message": f"{dup} ligne(s) dupliquée(s) détectée(s)",
        })

    consistency_issues = quality_score["dimensions"]["consistency"]["issues"]
    if consistency_issues:
        alerts.append({
            "level": "info",
            "type":  "consistency",
            "message": f"{len(consistency_issues)} problème(s) de cohérence de types",
            "detail": consistency_issues
        })

    outlier_cols = quality_score["dimensions"]["validity"]["outlier_columns"]
    if outlier_cols:
        alerts.append({
            "level": "info",
            "type":  "outliers",
            "message": f"{len(outlier_cols)} colonne(s) avec des outliers extrêmes",
            "detail": outlier_cols
        })

    return {
        "overview":         overview,
        "columns_analysis": columns_analysis,
        "quality_score":    quality_score,
        "alerts":           alerts,
    }