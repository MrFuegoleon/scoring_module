"""
Service de déploiement : sérialisation d'un modèle entraîné (bundle joblib) et
prédiction sur de nouvelles données brutes.

Un « bundle » contient toute la chaîne de scoring :
    données brutes → encodage (WOE / OHE+TE) → post-transformeurs (imputeur/scaler/ACP)
                   → modèle (calibré pour les arbres) → proba ≥ seuil → décision
"""
import json
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn

from services.pipeline_service import PipelineService
from services.modelling_service import ModellingService

MODELS_DIR = Path(__file__).resolve().parent.parent / 'models'


def _versions() -> dict:
    v = {'sklearn': sklearn.__version__}
    try:
        import xgboost as xgb
        v['xgboost'] = xgb.__version__
    except ImportError:
        pass
    try:
        import lightgbm as lgb
        v['lightgbm'] = lgb.__version__
    except ImportError:
        pass
    return v


def _safe(x):
    if x is None:
        return None
    if isinstance(x, (np.bool_, bool)):
        return bool(x)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating,)):
        f = float(x)
        return None if (np.isnan(f) or np.isinf(f)) else round(f, 4)
    if isinstance(x, float) and (np.isnan(x) or np.isinf(x)):
        return None
    if hasattr(x, 'item'):
        try:
            return x.item()
        except Exception:
            return x
    return x


def _json_default(o):
    """Filet de sécurité pour json.dump : convertit les scalaires numpy résiduels."""
    if isinstance(o, (np.bool_, bool)):
        return bool(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if hasattr(o, 'item'):
        return o.item()
    raise TypeError(f'Type non sérialisable : {type(o)}')


# ── Schéma des features brutes (pour générer le formulaire de prédiction) ─────
def build_raw_schema(df: pd.DataFrame, target_col: str) -> list:
    schema = []
    for col in df.columns:
        if col == target_col:
            continue
        s = df[col]
        if pd.api.types.is_numeric_dtype(s):
            schema.append({
                'name': col, 'kind': 'numeric',
                'min': _safe(s.min()), 'max': _safe(s.max()), 'median': _safe(s.median()),
            })
        else:
            cats = sorted({str(v) for v in s.dropna().unique()})[:50]
            schema.append({'name': col, 'kind': 'categorical', 'categories': cats})
    return schema


# ── Transformation de service (rejoue l'encodage du train) ────────────────────
def _transform_logit(df_raw: pd.DataFrame, encoders: dict) -> pd.DataFrame:
    woe_report = encoders['woe_report']
    target_col = encoders.get('target_col')
    df, _, _ = PipelineService._preprocess(df_raw, target_col)
    out = pd.DataFrame(index=df.index)
    for col, info in woe_report.items():
        bin_to_woe  = {b['bin']: b['woe'] for b in info['bins']}
        missing_woe = bin_to_woe.get('__missing__', 0.0)
        wname = f'{col}_woe'
        if col not in df.columns:
            out[wname] = missing_woe
            continue
        edges = info.get('edges')
        binned = (ModellingService._apply_edges(df[col], edges)
                  if edges is not None else ModellingService._bin_categorical(df[col]))
        out[wname] = binned.map(lambda lbl: bin_to_woe.get(lbl, missing_woe))
    return out


def _transform_tree(df_raw: pd.DataFrame, encoders: dict) -> pd.DataFrame:
    target_col  = encoders.get('target_col')
    df, _, _    = PipelineService._preprocess(df_raw, target_col)
    ohe_cols    = encoders['ohe_cols']
    ohe_columns = encoders['ohe_columns']
    te_cols     = encoders['te_cols']
    te_maps     = encoders['te_maps']
    gmean       = encoders['global_mean']

    if ohe_cols:
        present = [c for c in ohe_cols if c in df.columns]
        if present:
            dums = pd.get_dummies(df[present], columns=present, prefix=present,
                                  drop_first=False, dtype=int)
        else:
            dums = pd.DataFrame(index=df.index)
        dums = dums.reindex(columns=ohe_columns, fill_value=0)
        df = pd.concat([df.drop(columns=present), dums], axis=1)

    for col in te_cols:
        m = te_maps.get(col, {})
        if col in df.columns:
            df[col] = df[col].astype(str).map(m).fillna(gmean)
        else:
            df[col] = gmean
    return df


def transform_for_serving(df_raw: pd.DataFrame, bundle: dict) -> np.ndarray:
    enc = bundle['encoders']
    df_enc = _transform_logit(df_raw, enc) if enc['type'] == 'logit' else _transform_tree(df_raw, enc)
    X = df_enc.reindex(columns=bundle['encoded_features'], fill_value=0.0).astype(float).values
    for t in bundle['post_transformers']:
        X = t.transform(X)
    return X


def coerce_to_schema(df: pd.DataFrame, raw_schema: list) -> pd.DataFrame:
    """Force les types selon le schéma d'entraînement (numérique vs catégoriel)."""
    df = df.copy()
    for f in raw_schema or []:
        col = f['name']
        if col not in df.columns:
            continue
        if f['kind'] == 'numeric':
            df[col] = pd.to_numeric(df[col], errors='coerce')
        else:
            df[col] = df[col].astype(str)
    return df


def predict(bundle: dict, df_raw: pd.DataFrame):
    """Retourne (probas, décisions binaires, libellés de classe)."""
    df_raw = coerce_to_schema(df_raw, bundle.get('raw_schema', []))
    X     = transform_for_serving(df_raw, bundle)
    proba = bundle['model'].predict_proba(X)[:, 1]
    thr   = bundle['threshold']
    pred  = (proba >= thr).astype(int)
    names = bundle.get('class_names') or ['0', '1']
    labels = [names[p] for p in pred]
    return proba, pred, labels


# ── Persistance (joblib + sidecar JSON pour le listing) ───────────────────────
def _meta_summary(bundle: dict) -> dict:
    return {
        'model_id':    bundle['model_id'],
        'model_type':  bundle['model_type'],
        'pipeline':    bundle['pipeline'],
        'target_col':  bundle.get('target_col'),
        'class_names': bundle.get('class_names'),
        'threshold':   bundle.get('threshold'),
        'raw_schema':  bundle.get('raw_schema', []),
        'meta':        bundle.get('meta', {}),
        'created_at':  bundle.get('created_at'),
    }


def save_bundle(bundle: dict) -> str:
    MODELS_DIR.mkdir(exist_ok=True)
    mid  = bundle['model_id']
    path = MODELS_DIR / f'{mid}.joblib'
    joblib.dump(bundle, path)
    with open(MODELS_DIR / f'{mid}.json', 'w', encoding='utf-8') as f:
        json.dump(_meta_summary(bundle), f, ensure_ascii=False, indent=2)
    return str(path)


def load_bundle(model_id: str):
    path = MODELS_DIR / f'{model_id}.joblib'
    if not path.exists():
        return None
    return joblib.load(path)


def get_meta(model_id: str):
    path = MODELS_DIR / f'{model_id}.json'
    if not path.exists():
        return None
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def bundle_path(model_id: str):
    path = MODELS_DIR / f'{model_id}.joblib'
    return str(path) if path.exists() else None


def list_models() -> list:
    if not MODELS_DIR.exists():
        return []
    out = []
    for p in sorted(MODELS_DIR.glob('*.json'), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            with open(p, encoding='utf-8') as f:
                out.append(json.load(f))
        except Exception:
            pass
    return out


def delete_model(model_id: str) -> bool:
    found = False
    for ext in ('joblib', 'json'):
        path = MODELS_DIR / f'{model_id}.{ext}'
        if path.exists():
            path.unlink()
            found = True
    return found


def version_warning(bundle: dict) -> str | None:
    """Avertit si les versions de chargement diffèrent de celles de l'entraînement."""
    trained = (bundle.get('meta') or {}).get('versions', {})
    current = _versions()
    diffs = [f"{k}: entraîné {trained[k]} ≠ actuel {current.get(k)}"
             for k in trained if current.get(k) and current.get(k) != trained[k]]
    return ' · '.join(diffs) if diffs else None


def make_model_id(model_type: str, session_id: str) -> str:
    ts = datetime.now().strftime('%Y%m%d-%H%M%S')
    return f'{model_type}_{ts}_{session_id[:6]}'


def current_versions() -> dict:
    return _versions()
