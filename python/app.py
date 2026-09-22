from flask import Flask
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
from routes.multilabel_routes import multilabel_bp
from routes.deployment_routes import deployment_bp

app = Flask(__name__)
PORT = 5001

# ── Enregistrement des blueprints ───────────────────────────────────────────
app.register_blueprint(data_quality_bp,   url_prefix="/api/data-quality")
app.register_blueprint(data_cleaning_bp,  url_prefix="/api/data-cleaning")
app.register_blueprint(data_modelling_bp, url_prefix="/api/data-modelling")
app.register_blueprint(multilabel_bp,     url_prefix="/api/multilabel")
app.register_blueprint(deployment_bp,     url_prefix="/api/deployment")

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT, debug=False)