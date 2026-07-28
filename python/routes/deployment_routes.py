import io
import json

import numpy as np
import pandas as pd
from flask import Blueprint, request, jsonify, send_file

from services.session_store import SessionStore
from services import deployment_service as DS

deployment_bp = Blueprint('deployment', __name__)


def _safe(v):
    if v is None or (isinstance(v, float) and (np.isnan(v) or np.isinf(v))):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return round(float(v), 6)
    return v


# ── /deployment/export ────────────────────────────────────────────────────────
# Sérialise (joblib) le modèle entraîné mis en cache pour cette session.
@deployment_bp.route('/export', methods=['POST'])
def export_model():
    try:
        session_id = request.form.get('session_id')
        model_type = request.form.get('model_type')
        print(f'Export du modèle {model_type} pour session {session_id}')
        if not session_id or not model_type:
            return jsonify({'error': 'session_id et model_type requis'}), 400

        artifact = SessionStore.cache_get(f'{session_id}_{model_type}_artifact')
        if artifact is None:
            return jsonify({'error': "Modèle non disponible — relancez l'entraînement de ce modèle"}), 404

        model_id = DS.make_model_id(model_type, session_id)
        from datetime import datetime
        bundle = dict(artifact)
        bundle['model_id']   = model_id
        bundle['created_at'] = datetime.now().isoformat(timespec='seconds')

        DS.save_bundle(bundle)
        return jsonify({'success': True, 'model_id': model_id, 'meta': DS.get_meta(model_id)}), 200

    except Exception as e:
        return jsonify({'error': f'Erreur serveur : {str(e)}'}), 500


# ── /deployment/models ────────────────────────────────────────────────────────
@deployment_bp.route('/models', methods=['GET'])
def list_models():
    return jsonify({'success': True, 'models': DS.list_models()}), 200


# ── /deployment/models/<id> (DELETE) ──────────────────────────────────────────
@deployment_bp.route('/models/<model_id>', methods=['DELETE'])
def delete_model(model_id):
    ok = DS.delete_model(model_id)
    return jsonify({'success': ok}), (200 if ok else 404)


# ── /deployment/models/<id>/schema ────────────────────────────────────────────
@deployment_bp.route('/models/<model_id>/schema', methods=['GET'])
def model_schema(model_id):
    meta = DS.get_meta(model_id)
    if meta is None:
        return jsonify({'error': 'Modèle introuvable'}), 404
    return jsonify({
        'success':     True,
        'model_id':    model_id,
        'model_type':  meta.get('model_type'),
        'target_col':  meta.get('target_col'),
        'class_names': meta.get('class_names'),
        'threshold':   meta.get('threshold'),
        'raw_schema':  meta.get('raw_schema', []),
    }), 200


# ── /deployment/models/<id>/download ──────────────────────────────────────────
@deployment_bp.route('/models/<model_id>/download', methods=['GET'])
def download_model(model_id):
    path = DS.bundle_path(model_id)
    if path is None:
        return jsonify({'error': 'Modèle introuvable'}), 404
    return send_file(path, as_attachment=True, download_name=f'{model_id}.joblib')


# ── /deployment/results/<id>/download ─────────────────────────────────────────
# Télécharge le dataset scoré complet (trié par score décroissant + déciles).
@deployment_bp.route('/results/<result_id>/download', methods=['GET'])
def download_result(result_id):
    csv_str = SessionStore.cache_get(f'result_{result_id}')
    if csv_str is None:
        return jsonify({'error': 'Résultat introuvable ou expiré — relancez la prédiction'}), 404
    buf = io.BytesIO(csv_str.encode('utf-8'))
    buf.seek(0)
    return send_file(buf, mimetype='text/csv', as_attachment=True, download_name='dataset_score.csv')


# ── /deployment/predict ───────────────────────────────────────────────────────
# Deux modes : record JSON (1 client) OU fichier CSV (lot).
@deployment_bp.route('/predict', methods=['POST'])
def predict():
    try:
        model_id = request.form.get('model_id')
        if not model_id:
            return jsonify({'error': 'model_id requis'}), 400

        bundle = DS.load_bundle(model_id)
        if bundle is None:
            return jsonify({'error': 'Modèle introuvable'}), 404

        # Construction du DataFrame d'entrée
        file = request.files.get('file')
        if file is not None:
            df = pd.read_csv(file)
            mode = 'batch'
        else:
            record_raw = request.form.get('record')
            if not record_raw:
                return jsonify({'error': 'Fournir un CSV (file) ou un enregistrement (record)'}), 400
            record = json.loads(record_raw)
            df = pd.DataFrame([record])
            mode = 'single'

        if len(df) == 0:
            return jsonify({'error': 'Aucune ligne à scorer'}), 400

        proba, pred, labels = DS.predict(bundle, df)
        threshold = bundle['threshold']

        warning = DS.version_warning(bundle)

        if mode == 'single':
            return jsonify({
                'success':   True,
                'mode':      'single',
                'score':     round(float(proba[0]), 4),
                'decision':  labels[0],
                'positive':  bool(pred[0]),
                'threshold': round(float(threshold), 4),
                'class_names': bundle.get('class_names'),
                'version_warning': warning,
            }), 200

        # batch : aperçu + stats. Dp = décile par rang sur l'ensemble scoré
        # (top 10% des probas → décile 1, … dernier 10% → décile 10).
        deciles = DS.assign_deciles_by_rank(proba)
        scores  = [round(float(p), 4) for p in proba]
        results = []
        preview_df = df.head(200).copy()
        for i in range(len(preview_df)):
            results.append({
                'score': scores[i],
                'Dp':    int(deciles[i]),
            })

        # Dataset complet scoré, trié par score décroissant — mis en cache pour téléchargement
        import uuid
        full = df.copy()
        full['score'] = np.round(proba, 6)
        full['Dp']    = deciles
        full = full.sort_values('score', ascending=False)
        download_id = uuid.uuid4().hex[:12]
        SessionStore.cache_set(f'result_{download_id}', full.to_csv(index=False))

        return jsonify({
            'success':    True,
            'mode':       'batch',
            'n_rows':     int(len(df)),
            'n_positive': int(pred.sum()),
            'rate':       round(float(pred.mean()), 4),
            'threshold':  round(float(threshold), 4),
            'columns':    list(df.columns),
            'preview':    [
                {**{c: _safe(preview_df.iloc[i][c]) for c in preview_df.columns}, **results[i]}
                for i in range(len(preview_df))
            ],
            'download_id':     download_id,
            'class_names':     bundle.get('class_names'),
            'version_warning': warning,
        }), 200

    except Exception as e:
        return jsonify({'error': f'Erreur serveur : {str(e)}'}), 500
