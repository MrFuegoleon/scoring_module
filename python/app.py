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

app = Flask(__name__)
PORT = 5000

# ── Enregistrement des blueprints ───────────────────────────────────────────
app.register_blueprint(data_quality_bp,   url_prefix="/api/data-quality")
app.register_blueprint(data_cleaning_bp,  url_prefix="/api/data-cleaning")
app.register_blueprint(data_modelling_bp, url_prefix="/api/data-modelling")

if __name__ == '__main__':
    app.run(port=PORT, debug=False)