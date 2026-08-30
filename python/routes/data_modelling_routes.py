import io
import numpy as np
import pandas as pd
from flask import Blueprint, request, jsonify, send_file
from sklearn.model_selection import train_test_split
from services.session_store import SessionStore

data_modelling_bp = Blueprint('data_modelling', __name__)


def _safe_records(df: pd.DataFrame, n: int = 10) -> list:
    rows = []
    for rec in df.head(n).to_dict('records'):
        safe = {}
        for k, v in rec.items():
            if v is None or (isinstance(v, float) and (np.isnan(v) or np.isinf(v))):
                safe[k] = None
            elif pd.isnull(v):
                safe[k] = None
            elif isinstance(v, (np.integer,)):
                safe[k] = int(v)
            elif isinstance(v, (np.floating,)):
                safe[k] = round(float(v), 4)
            elif isinstance(v, pd.Timestamp):
                safe[k] = str(v)
            elif hasattr(v, 'item'):
                safe[k] = v.item()
            else:
                safe[k] = v
        rows.append(safe)
    return rows


# ── /modelling/init ───────────────────────────────────────────────────────────
# Vérifie que les deux datamarts sont disponibles et retourne leurs infos.
@data_modelling_bp.route('/init', methods=['POST'])
def modelling_init():
    try:
        session_id = request.form.get('session_id')
        if not session_id:
            return jsonify({"error": "session_id manquant"}), 400

        logit_sid = f'{session_id}_logit'
        tree_sid  = f'{session_id}_tree'

        if not SessionStore.exists(logit_sid) or not SessionStore.exists(tree_sid):
            return jsonify({
                "error": "Datamarts non construits — terminez le pipeline Data Cleaning (étape pipelines)"
            }), 404

        meta       = SessionStore.get_meta(session_id)
        target_col = meta.get('target_col')

        df_logit = SessionStore.get(logit_sid)
        df_tree  = SessionStore.get(tree_sid)

        def _col_kind(df, col):
            if pd.api.types.is_numeric_dtype(df[col]):
                return 'numeric'
            return 'categorical'

        return jsonify({
            "success":    True,
            "target_col": target_col,
            "logit": {
                "n_rows":  len(df_logit.dropna(subset=[target_col])),
                "n_cols":  len(df_logit.columns),
                "columns": list(df_logit.columns),
            },
            "tree": {
                "n_rows":  len(df_tree.dropna(subset=[target_col])),
                "n_cols":  len(df_tree.columns),
                "columns": list(df_tree.columns),
            },
        }), 200

    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500


# ── /modelling/models ─────────────────────────────────────────────────────────
@data_modelling_bp.route('/models', methods=['GET'])
def get_available_models():
    from services.training_service import available_models
    return jsonify({'models': available_models()}), 200


# ── /modelling/train ──────────────────────────────────────────────────────────
@data_modelling_bp.route('/train', methods=['POST'])
def train_model():
    try:
        from services.training_service import TrainingService

        session_id   = request.form.get('session_id')
        model_type   = request.form.get('model_type')
        use_tuning   = request.form.get('use_tuning', 'false').lower() == 'true'
        n_iter       = int(request.form.get('n_iter', 20))

        if not session_id or not model_type:
            return jsonify({"error": "Paramètres manquants (session_id, model_type)"}), 400

        # Détermine quel datamart utiliser
        pipeline  = 'logit' if model_type == 'logit' else 'tree'
        sid       = f'{session_id}_{pipeline}'

        if not SessionStore.exists(sid):
            return jsonify({"error": f"Datamart '{pipeline}' non trouvé — construisez les pipelines d'abord"}), 404

        meta       = SessionStore.get_meta(session_id)
        target_col = meta.get('target_col')
        if not target_col:
            return jsonify({"error": "Variable cible introuvable dans le datamart"}), 400

        # Modalité codée 1 — choisie à la construction des pipelines.
        # None pour les sessions antérieures → repli alphabétique historique.
        positive_class = meta.get('positive_class')

        # Réglages figés à la construction des datamarts : le ré-encodage train/test
        # doit les rejouer, sans quoi le modèle serait entraîné sur un encodage
        # différent de celui que l'utilisateur a paramétré et prévisualisé.
        # Sessions antérieures (meta sans ces clés) → anciennes valeurs par défaut.
        n_bins       = int(meta.get('n_bins') or 10)
        cardinality  = int(meta.get('cardinality_threshold') or 10)
        smoothing    = meta.get('smoothing')
        smoothing    = 0.2 if smoothing is None else float(smoothing)

        # ── Chemin sans leakage : split sur données brutes avant encodage ───────
        # Le split encodé est mis en cache : recliquer "Relancer" ne recalcule plus
        # WOE/OHE+TE (invalidé au rebuild des pipelines via cache_clear_prefix).
        cache_key       = f'{session_id}_{pipeline}_split'
        cached          = SessionStore.cache_get(cache_key)
        feature_names   = class_names = None
        used_split_path = False
        X_tr = y_tr = X_te = y_te = None
        encoders = raw_schema = None

        if cached is not None:
            X_tr, y_tr, X_te, y_te, feature_names, class_names, encoders, raw_schema = cached
            used_split_path = True
        else:
            df_raw = SessionStore.get(session_id)
            if df_raw is not None and target_col in df_raw.columns:
                from services.pipeline_service import PipelineService

                from services.modelling_service import ModellingService

                raw_vals = sorted(df_raw[target_col].dropna().unique(), key=str)
                if len(raw_vals) == 2:   # cible binaire requise pour le chemin sans leakage
                    raw_map, _ = ModellingService.build_target_map(df_raw[target_col], positive_class)
                    y_strat = df_raw[target_col].map(raw_map).dropna().astype(int)
                    df_raw  = df_raw.loc[y_strat.index]

                    df_train_raw, df_test_raw = train_test_split(
                        df_raw, test_size=0.2, stratify=y_strat, random_state=42
                    )

                    try:
                        from services.deployment_service import build_raw_schema
                        if pipeline == 'logit':
                            df_tr_enc, df_te_enc, encoders = PipelineService.build_logit_pipeline_split(
                                df_train_raw, df_test_raw, target_col,
                                n_bins=n_bins,
                                positive_class=positive_class
                            )
                        else:
                            df_tr_enc, df_te_enc, encoders = PipelineService.build_tree_pipeline_split(
                                df_train_raw, df_test_raw, target_col,
                                cardinality_threshold=cardinality,
                                smoothing=smoothing,
                                positive_class=positive_class
                            )

                        raw_schema = build_raw_schema(df_raw, target_col)
                        X_tr, y_tr, feature_names, class_names = TrainingService.prepare_preencoded_features(
                            df_tr_enc, target_col, positive_class=positive_class)
                        X_te, y_te, _, _                       = TrainingService.prepare_preencoded_features(
                            df_te_enc, target_col, positive_class=positive_class)
                        SessionStore.cache_set(cache_key, (X_tr, y_tr, X_te, y_te, feature_names, class_names, encoders, raw_schema))
                        used_split_path = True
                    except Exception:
                        used_split_path = False

        if used_split_path:
            results, artifact = TrainingService.train_and_evaluate(
                X_tr, y_tr, model_type,
                class_names=class_names, use_tuning=use_tuning, n_iter=n_iter,
                X_test_pre=X_te, y_test_pre=y_te, return_artifact=True,
            )
            # Met en cache l'artifact de déploiement (réutilisé au clic « Déployer »)
            try:
                from services import deployment_service as DS
                artifact.update({
                    'model_type':     model_type,
                    'pipeline':       pipeline,
                    'target_col':     target_col,
                    'positive_class': (class_names or ['0', '1'])[1],
                    'encoders':       encoders,
                    'raw_schema':     raw_schema,
                    'meta': {
                        'auc_test':    results.get('auc_test'),
                        'gini_test':   results.get('gini_test'),
                        'ks_test':     results.get('ks_test'),
                        'n_features':  results.get('n_features'),
                        'calibration': results.get('calibration'),
                        'calibration_quality': results.get('calibration_quality'),
                        'versions':    DS.current_versions(),
                    },
                })
                SessionStore.cache_set(f'{session_id}_{model_type}_artifact', artifact)
            except Exception:
                pass
        else:
            # Fallback : datamart pré-encodé (split interne) — datamart chargé ici uniquement
            df = SessionStore.get(sid)
            if target_col not in df.columns:
                return jsonify({"error": "Variable cible introuvable dans le datamart"}), 400
            X, y, feature_names, class_names = TrainingService.prepare_preencoded_features(
                df, target_col, positive_class=positive_class)
            results = TrainingService.train_and_evaluate(
                X, y, model_type,
                class_names=class_names, use_tuning=use_tuning, n_iter=n_iter,
            )

        response = {
            'success':        True,
            'pipeline':       pipeline,
            'model_type':     model_type,
            'target_col':     target_col,
            'positive_class': (class_names or ['0', '1'])[1],
            'class_names':    class_names,
            'results':        results,
            'feature_names':  feature_names,
        }
        return jsonify(response), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500


# ── /modelling/datamart/<type> ────────────────────────────────────────────────
# Retourne le profil colonnes + aperçu du datamart (logit ou tree).
@data_modelling_bp.route('/datamart/<pipeline_type>', methods=['GET'])
def datamart_preview(pipeline_type):
    try:
        session_id = request.args.get('session_id')
        n          = int(request.args.get('n', 100))

        if not session_id:
            return jsonify({'error': 'session_id manquant'}), 400
        if pipeline_type not in ('logit', 'tree'):
            return jsonify({'error': 'pipeline_type doit être logit ou tree'}), 400

        sid = f'{session_id}_{pipeline_type}'
        if not SessionStore.exists(sid):
            return jsonify({'error': 'Datamart introuvable — construisez les pipelines d\'abord'}), 404

        df    = SessionStore.get(sid)
        total = len(df)

        col_profiles = {}
        for col in df.columns:
            n_missing = int(df[col].isna().sum())
            n_unique  = int(df[col].nunique(dropna=True))
            profile   = {
                'dtype':     str(df[col].dtype),
                'n_missing': n_missing,
                'n_unique':  n_unique,
                'fill_rate': round((total - n_missing) / total * 100, 1) if total > 0 else 0,
            }
            if pd.api.types.is_numeric_dtype(df[col]):
                desc = df[col].describe()
                profile.update({
                    'min': round(float(desc.get('min', 0) or 0), 4),
                    'max': round(float(desc.get('max', 0) or 0), 4),
                    'mean': round(float(desc.get('mean', 0) or 0), 4),
                })
            col_profiles[col] = profile

        return jsonify({
            'success':      True,
            'pipeline':     pipeline_type,
            'shape':        {'rows': total, 'cols': len(df.columns)},
            'col_profiles': col_profiles,
            'preview':      _safe_records(df, n),
        }), 200

    except Exception as e:
        return jsonify({'error': f'Erreur serveur : {str(e)}'}), 500


# ── /modelling/datamart/<type>/download ───────────────────────────────────────
@data_modelling_bp.route('/datamart/<pipeline_type>/download', methods=['GET'])
def datamart_download(pipeline_type):
    session_id = request.args.get('session_id')
    if not session_id:
        return jsonify({'error': 'session_id manquant'}), 400
    if pipeline_type not in ('logit', 'tree'):
        return jsonify({'error': 'pipeline_type doit être logit ou tree'}), 400

    sid = f'{session_id}_{pipeline_type}'
    if not SessionStore.exists(sid):
        return jsonify({'error': 'Datamart introuvable'}), 404

    df  = SessionStore.get(sid)
    buf = io.BytesIO()
    df.to_csv(buf, index=False)
    buf.seek(0)

    return send_file(
        buf,
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'datamart_{pipeline_type}_{session_id[:8]}.csv',
    )
