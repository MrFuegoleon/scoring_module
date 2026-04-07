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
from ydata_profiling.config import Settings
import yaml
import matplotlib
import matplotlib.pyplot as plt
import pathlib

# ── Palette DataPipeline (thème sombre React) ────────────────────────────────
_DP_BG       = "#111118"   # --bg2
_DP_BG_AXES  = "#1a1a24"   # --bg3
_DP_BORDER   = "#2a2a3a"   # --border
_DP_TEXT     = "#e2e2f0"   # --text
_DP_MUTED    = "#6b6b8a"   # --muted
_DP_ACCENT   = "#6c63ff"   # --accent  (violet)
_DP_ACCENT2  = "#00d4aa"   # --accent2 (teal)
_DP_ACCENT3  = "#ff6b6b"   # --accent3 (rouge)
_DP_WARN     = "#f59e0b"   # --warn    (ambre)

_DP_CYCLE = [_DP_ACCENT, _DP_ACCENT2, _DP_ACCENT3, _DP_WARN,
             "#a78bfa", "#34d399", "#fb923c", "#60a5fa"]


def _apply_datapipeline_theme():
    """Applique le thème sombre DataPipeline aux graphiques matplotlib."""
    matplotlib.rcParams.update({
        # Fonds
        "figure.facecolor":  _DP_BG,
        "axes.facecolor":    _DP_BG_AXES,
        "savefig.facecolor": _DP_BG,

        # Textes & axes
        "text.color":        _DP_TEXT,
        "axes.labelcolor":   _DP_TEXT,
        "axes.edgecolor":    _DP_BORDER,
        "xtick.color":       _DP_MUTED,
        "ytick.color":       _DP_MUTED,
        "xtick.labelcolor":  _DP_TEXT,
        "ytick.labelcolor":  _DP_TEXT,

        # Grille discrète
        "axes.grid":         True,
        "grid.color":        _DP_BORDER,
        "grid.linewidth":    0.6,
        "grid.alpha":        0.5,

        # Bordures de figure
        "figure.edgecolor":  _DP_BORDER,

        # Cycle de couleurs
        "axes.prop_cycle":   matplotlib.cycler("color", _DP_CYCLE),

        # Police (JetBrains Mono en fallback si disponible, sinon monospace)
        "font.family":       "monospace",
        "font.size":         9.5,
        "axes.titlesize":    10,
        "axes.labelsize":    9,
        "xtick.labelsize":   8,
        "ytick.labelsize":   8,

        # Résolution et rendu SVG
        "figure.dpi":        110,
        "svg.fonttype":      "none",     # polices système dans le SVG

        # Espacements
        "figure.subplot.left":   0.12,
        "figure.subplot.right":  0.95,
        "figure.subplot.top":    0.92,
        "figure.subplot.bottom": 0.12,

        # Barres et courbes
        "patch.linewidth":   0.5,
        "lines.linewidth":   1.5,
        "lines.markersize":  5,
    })


def _restore_default_theme():
    """Remet les rcParams matplotlib à leur état par défaut."""
    matplotlib.rcdefaults()
    plt.close("all")


# Variables CSS par theme
_DP_VARS_DARK = """
  --dp-bg:     #0a0a0f;
  --dp-bg2:    #111118;
  --dp-bg3:    #1a1a24;
  --dp-border: #2a2a3a;
  --dp-text:   #e2e2f0;
  --dp-muted:  #6b6b8a;
  --dp-accent: #6c63ff;
  --dp-teal:   #00d4aa;
  --dp-red:    #ff6b6b;
  --dp-warn:   #f59e0b;
"""

_DP_VARS_LIGHT = """
  --dp-bg:     #f4f4f8;
  --dp-bg2:    #ffffff;
  --dp-bg3:    #ececf3;
  --dp-border: #d0d0e0;
  --dp-text:   #1a1a2e;
  --dp-muted:  #7a7a9a;
  --dp-accent: #5b52e0;
  --dp-teal:   #00a88a;
  --dp-red:    #e85555;
  --dp-warn:   #d68910;
"""


_DP_CSS_BODY = (
    "<style id='datapipeline-theme'>\n"
    "@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700"
    "&family=Syne:wght@400;600;700;800&display=swap');\n"
    # :root est construit dynamiquement dans _build_css()
    "VARS_PLACEHOLDER"
    "*, *::before, *::after { box-sizing: border-box; }\n"
    "html, body, .container-fluid, .container {\n"
    "  background-color: var(--dp-bg) !important;\n"
    "  color: var(--dp-text) !important;\n"
    "  font-family: 'JetBrains Mono', monospace !important;\n"
    "  font-size: 0.875rem !important;\n"
    "}\n"
    ".navbar {\n"
    "  background-color: var(--dp-bg2) !important;\n"
    "  border-bottom: 1px solid var(--dp-border) !important;\n"
    "  padding: 0.5rem 1rem !important;\n"
    "}\n"
    ".navbar * { color: var(--dp-text) !important; font-family: 'Syne', sans-serif !important; }\n"
    ".navbar-brand { font-weight: 800 !important; color: var(--dp-accent) !important; }\n"
    ".navbar-nav .nav-link:hover { color: var(--dp-accent) !important; }\n"
    "section, .content-wrapper, #overview, #variables,\n"
    "#interactions, #correlations, #missing, #sample, #duplicates {\n"
    "  background-color: var(--dp-bg) !important; color: var(--dp-text) !important;\n"
    "}\n"
    ".card {\n"
    "  background-color: var(--dp-bg2) !important;\n"
    "  border: 1px solid var(--dp-border) !important;\n"
    "  border-radius: 10px !important; color: var(--dp-text) !important;\n"
    "}\n"
    ".card-header {\n"
    "  background-color: var(--dp-bg3) !important;\n"
    "  border-bottom: 1px solid var(--dp-border) !important;\n"
    "  color: var(--dp-text) !important;\n"
    "  font-family: 'Syne', sans-serif !important; font-weight: 700 !important;\n"
    "}\n"
    ".card-body { background-color: var(--dp-bg2) !important; color: var(--dp-text) !important; }\n"
    ".card-footer { background-color: var(--dp-bg3) !important; border-top: 1px solid var(--dp-border) !important; }\n"
    "h1,h2,h3,h4,h5,h6,.h1,.h2,.h3,.h4,.h5,.h6 { font-family: 'Syne', sans-serif !important; color: var(--dp-text) !important; }\n"
    ".table, table { color: var(--dp-text) !important; border-color: var(--dp-border) !important; }\n"
    ".table > :not(caption) > * > * { background-color: transparent !important; color: var(--dp-text) !important; border-color: var(--dp-border) !important; }\n"
    ".table td, .table th, td, th { background-color: transparent !important; border-color: var(--dp-border) !important; color: var(--dp-text) !important; }\n"
    ".table-striped > tbody > tr:nth-of-type(odd) > * { background-color: rgba(108,99,255,0.05) !important; color: var(--dp-text) !important; }\n"
    ".table-hover > tbody > tr:hover > * { background-color: rgba(108,99,255,0.1) !important; color: var(--dp-text) !important; }\n"
    "thead th, .thead-light th, .thead-dark th, th {\n"
    "  background-color: var(--dp-bg3) !important; border-color: var(--dp-border) !important;\n"
    "  color: var(--dp-muted) !important; font-size: 0.7rem !important;\n"
    "  text-transform: uppercase; letter-spacing: 0.07em;\n"
    "}\n"
    "a, a:visited { color: var(--dp-accent) !important; text-decoration: none; }\n"
    "a:hover { color: #a89dff !important; }\n"
    ".text-primary { color: var(--dp-accent) !important; }\n"
    ".bg-primary { background-color: var(--dp-accent) !important; }\n"
    ".btn-primary { background-color: var(--dp-accent) !important; border-color: var(--dp-accent) !important; color: #fff !important; }\n"
    ".btn-primary:hover { background-color: #5a52d5 !important; }\n"
    ".btn-default, .btn-secondary { background-color: var(--dp-bg3) !important; border-color: var(--dp-border) !important; color: var(--dp-text) !important; }\n"
    ".btn-default:hover, .btn-secondary:hover { background-color: rgba(108,99,255,0.12) !important; border-color: var(--dp-accent) !important; }\n"
    ".badge { font-size: 0.65rem !important; }\n"
    ".badge-primary, .bg-primary.badge { background-color: var(--dp-accent) !important; color: #fff !important; }\n"
    ".badge-success, .bg-success.badge { background-color: var(--dp-teal) !important; color: #111 !important; }\n"
    ".badge-warning, .bg-warning.badge { background-color: var(--dp-warn) !important; color: #111 !important; }\n"
    ".badge-danger,  .bg-danger.badge  { background-color: var(--dp-red) !important; color: #fff !important; }\n"
    ".badge-info,    .bg-info.badge    { background-color: #60a5fa !important; color: #111 !important; }\n"
    ".badge-secondary, .bg-secondary.badge { background-color: var(--dp-bg3) !important; color: var(--dp-muted) !important; border: 1px solid var(--dp-border); }\n"
    ".progress { background-color: var(--dp-bg3) !important; border: 1px solid var(--dp-border) !important; border-radius: 4px !important; height: 10px !important; }\n"
    ".progress-bar { background-color: var(--dp-accent) !important; }\n"
    ".progress-bar.bg-success { background-color: var(--dp-teal) !important; }\n"
    ".progress-bar.bg-warning { background-color: var(--dp-warn) !important; }\n"
    ".progress-bar.bg-danger  { background-color: var(--dp-red) !important; }\n"
    ".nav-tabs { border-bottom: 1px solid var(--dp-border) !important; }\n"
    ".nav-tabs .nav-link { color: var(--dp-muted) !important; border: 1px solid transparent !important; border-radius: 6px 6px 0 0 !important; font-size: 0.78rem !important; background: transparent !important; }\n"
    ".nav-tabs .nav-link:hover { color: var(--dp-text) !important; border-color: var(--dp-border) var(--dp-border) transparent !important; background-color: var(--dp-bg3) !important; }\n"
    ".nav-tabs .nav-link.active, .nav-tabs .nav-item.show .nav-link { background-color: var(--dp-bg3) !important; border-color: var(--dp-border) var(--dp-border) var(--dp-bg3) !important; color: var(--dp-accent) !important; }\n"
    ".tab-content { background-color: var(--dp-bg2) !important; border: 1px solid var(--dp-border) !important; border-top: none !important; border-radius: 0 0 8px 8px !important; padding: 1rem !important; }\n"
    ".collapse-toggle, [data-toggle='collapse'], [data-bs-toggle='collapse'] { color: var(--dp-text) !important; background-color: var(--dp-bg3) !important; }\n"
    ".panel, .accordion-item { background-color: var(--dp-bg2) !important; border: 1px solid var(--dp-border) !important; border-radius: 8px !important; margin-bottom: 0.5rem !important; }\n"
    ".panel-heading, .accordion-header, .panel-title { background-color: var(--dp-bg3) !important; border-bottom: 1px solid var(--dp-border) !important; border-radius: 8px 8px 0 0 !important; color: var(--dp-text) !important; }\n"
    ".panel-body, .accordion-body { background-color: var(--dp-bg2) !important; color: var(--dp-text) !important; }\n"
    ".alert { border-radius: 8px !important; font-size: 0.8rem !important; }\n"
    ".alert-success { background-color: rgba(0,212,170,0.1) !important; border-color: rgba(0,212,170,0.3) !important; color: #00d4aa !important; }\n"
    ".alert-info    { background-color: rgba(96,165,250,0.1) !important; border-color: rgba(96,165,250,0.3) !important; color: #60a5fa !important; }\n"
    ".alert-warning { background-color: rgba(245,158,11,0.1) !important; border-color: rgba(245,158,11,0.3) !important; color: #f59e0b !important; }\n"
    ".alert-danger  { background-color: rgba(255,107,107,0.1) !important; border-color: rgba(255,107,107,0.3) !important; color: #ff6b6b !important; }\n"
    ".form-control, .form-select, input[type='text'], input[type='search'], select {\n"
    "  background-color: var(--dp-bg3) !important; border: 1px solid var(--dp-border) !important;\n"
    "  color: var(--dp-text) !important; border-radius: 6px !important;\n"
    "}\n"
    ".form-control:focus, .form-select:focus { border-color: var(--dp-accent) !important; box-shadow: 0 0 0 2px rgba(108,99,255,0.2) !important; background-color: var(--dp-bg3) !important; }\n"
    "::placeholder { color: var(--dp-muted) !important; }\n"
    ".dropdown-menu { background-color: var(--dp-bg2) !important; border: 1px solid var(--dp-border) !important; border-radius: 8px !important; }\n"
    ".dropdown-item { color: var(--dp-text) !important; font-size: 0.8rem !important; }\n"
    ".dropdown-item:hover { background-color: rgba(108,99,255,0.1) !important; color: var(--dp-accent) !important; }\n"
    ".dropdown-divider { border-color: var(--dp-border) !important; }\n"
    "hr { border-color: var(--dp-border) !important; opacity: 0.5; }\n"
    ".text-muted { color: var(--dp-muted) !important; }\n"
    "code, pre { background-color: var(--dp-bg3) !important; color: var(--dp-teal) !important; border: 1px solid var(--dp-border) !important; border-radius: 4px; }\n"
    "svg { background: transparent !important; }\n"
    "img { border-radius: 6px; }\n"
    "::-webkit-scrollbar { width: 6px; height: 6px; }\n"
    "::-webkit-scrollbar-track { background: var(--dp-bg2); }\n"
    "::-webkit-scrollbar-thumb { background: var(--dp-border); border-radius: 3px; }\n"
    "::-webkit-scrollbar-thumb:hover { background: var(--dp-muted); }\n"
    "</style>\n"
)


def _build_css(theme: str) -> str:
    vars_block = _DP_VARS_DARK if theme == "dark" else _DP_VARS_LIGHT
    root_block = ":root {\n" + vars_block + "}\n"
    return _DP_CSS_BODY.replace("VARS_PLACEHOLDER", root_block)


def _inject_dp_theme(html: str, theme: str = "dark") -> str:
    css = _build_css(theme)
    if "</head>" in html:
        return html.replace("</head>", css + "\n</head>", 1)
    return html.replace("<body", css + "\n<body", 1)


def generate_profile_html(df, title: str = "Rapport Qualite", theme: str = "dark") -> str:
    """
    Genere le rapport ydata_profiling et retourne le HTML brut.
    theme : 'dark' ou 'light' — adapte la palette au theme React actif.
    """
    sample_df = df.sample(n=min(len(df), 10_000), random_state=42) if len(df) > 10_000 else df

    config_path = pathlib.Path(__file__).parent.parent / "ydata_config.yml"
    with open(config_path, encoding="utf-8") as f:
        raw_config = yaml.safe_load(f)

    settings = Settings()
    settings = settings.parse_obj(raw_config)

    _apply_datapipeline_theme()
    try:
        profile = ProfileReport(
            sample_df,
            title=title,
            minimal=False,
            explorative=False,
            progress_bar=False,
            config=settings,
        )
        return _inject_dp_theme(profile.to_html(), theme=theme)
    finally:
        _restore_default_theme()
# ══════════════════════════════════════════════════════════════════════════════
# CHARGEMENT DYNAMIQUE (CSV, Excel, JSON, Parquet)
# ══════════════════════════════════════════════════════════════════════════════

MAX_FILE_SIZE_MB = 200
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

ENCODINGS_TO_TRY = ["utf-8", "utf-8-sig", "latin-1", "cp1252", "iso-8859-1"]


def _read_csv_robust(buf: io.BytesIO) -> pd.DataFrame:
    """
    Lit un CSV en détectant automatiquement le séparateur et l'encoding.
    Essaie utf-8 → utf-8-sig (BOM) → latin-1 → cp1252 → iso-8859-1.
    """
    raw = buf.read()
    for encoding in ENCODINGS_TO_TRY:
        try:
            text_buf = io.StringIO(raw.decode(encoding))
            df = pd.read_csv(text_buf, sep=None, engine="python")
            return df
        except (UnicodeDecodeError, Exception):
            continue
    raise ValueError(
        "Impossible de décoder le fichier CSV. "
        "Encodages testés : " + ", ".join(ENCODINGS_TO_TRY)
    )


def load_dataframe(file_storage) -> pd.DataFrame:
    """
    Charge un DataFrame depuis un fichier uploadé Flask (werkzeug FileStorage).
    Supporte : CSV, Excel, JSON, Parquet.
    Détecte automatiquement le séparateur CSV et l'encoding.
    Refuse les fichiers > 200 Mo.
    """
    filename = file_storage.filename.lower()
    content  = file_storage.read()

    if len(content) > MAX_FILE_SIZE_BYTES:
        raise ValueError(
            f"Fichier trop volumineux ({len(content) // 1024 // 1024} Mo). "
            f"Limite : {MAX_FILE_SIZE_MB} Mo."
        )

    buf = io.BytesIO(content)

    if filename.endswith(".csv"):
        return _read_csv_robust(buf)
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

    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Fichier introuvable : {filepath}")

    size = os.path.getsize(filepath)
    if size > MAX_FILE_SIZE_BYTES:
        raise ValueError(
            f"Fichier trop volumineux ({size // 1024 // 1024} Mo). "
            f"Limite : {MAX_FILE_SIZE_MB} Mo."
        )

    if ext == ".csv":
        with open(filepath, "rb") as f:
            return _read_csv_robust(io.BytesIO(f.read()))
    elif ext in (".xlsx", ".xls"):
        return pd.read_excel(filepath)
    elif ext == ".json":
        return pd.read_json(filepath)
    elif ext == ".parquet":
        return pd.read_parquet(filepath)
    else:
        raise ValueError(f"Format non supporté : '{ext}'")


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


CRITICAL_PILLAR_THRESHOLD = 70  # Un pilier sous ce seuil → grade forcé à Critique


def _grade_from_score(score: float) -> str:
    if score > 98:
        return "Excellent"
    if score >= 95:
        return "Très bonne"
    if score >= 90:
        return "Bonne"
    if score >= 80:
        return "À améliorer"
    return "Critique"


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

    # Pilier critique : si un pilier passe sous le seuil, grade forcé à Critique
    critical_pillars = [
        dim for dim in SCORE_WEIGHTS
        if dimensions[dim]["score"] < CRITICAL_PILLAR_THRESHOLD
    ]

    if critical_pillars:
        grade = "Critique"
    else:
        grade = _grade_from_score(global_score)

    return {
        "global_score":      global_score,
        "grade":             grade,
        "weights":           SCORE_WEIGHTS,
        "dimensions":        dimensions,
        "critical_pillars":  critical_pillars,
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