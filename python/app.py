from flask import Flask, request, jsonify
import pandas as pd
import os
import logging

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
    force=True,
)
# Silence les librairies trop verboses
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# ── Blueprints ──────────────────────────────────────────────────────────────
from routes.data_quality_routes import data_quality_bp
from routes.data_cleaning_routes import data_cleaning_bp
from routes.data_modelling_routes import data_modelling_bp

app = Flask(__name__)
PORT = 5000

# ── Enregistrement des blueprints ───────────────────────────────────────────
app.register_blueprint(data_quality_bp,   url_prefix="/api/data-quality")
app.register_blueprint(data_cleaning_bp,  url_prefix="/api/data-cleaning")
app.register_blueprint(data_modelling_bp, url_prefix="/api/data-modelling")
# ── Routes existantes (inchangées) ──────────────────────────────────────────
@app.route('/api/test', methods=['GET'])
def test():
    return jsonify({'message': 'Python OK', 'timestamp': pd.Timestamp.now().isoformat()})


@app.route('/api/analyze', methods=['POST'])
def analyze():
    try:
        data = request.get_json()
        filepath = data.get('filepath')

        if not filepath or not os.path.exists(filepath):
            return jsonify({'error': 'Fichier non trouvé'}), 400

        df = pd.read_csv(filepath)

        result = {
            'rows': len(df),
            'columns': len(df.columns),
            'column_names': df.columns.tolist(),
            'dtypes': df.dtypes.astype(str).to_dict(),
            'null_counts': df.isnull().sum().to_dict(),
            'sample': df.head(3).to_dict('records')
        }

        try:
            os.remove(filepath)
        except (OSError, FileNotFoundError):
            pass

        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(port=PORT, debug=False)