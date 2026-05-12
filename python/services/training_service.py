import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_predict, train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score, roc_curve, confusion_matrix
from sklearn.utils.multiclass import unique_labels
from scipy.stats import gaussian_kde

try:
    import xgboost as xgb
    HAS_XGB = True
except ImportError:
    HAS_XGB = False

try:
    import lightgbm as lgb
    HAS_LGB = True
except ImportError:
    HAS_LGB = False


def available_models():
    return {
        'logit':         {'name': 'Régression Logistique', 'pipeline': 'woe',  'available': True},
        'xgboost':       {'name': 'XGBoost',               'pipeline': 'raw',  'available': HAS_XGB},
        'lightgbm':      {'name': 'LightGBM',              'pipeline': 'raw',  'available': HAS_LGB},
        'random_forest': {'name': 'Random Forest',         'pipeline': 'raw',  'available': True},
    }


class TrainingService:

    # ── Pipeline WOE → Logit ──────────────────────────────────────────────────
    @staticmethod
    def prepare_woe_features(df: pd.DataFrame, target_col: str,
                             woe_report: dict, iv_threshold: float = 0.02):
        from services.modelling_service import ModellingService

        selected = {
            col: info for col, info in woe_report.items()
            if info['iv'] >= iv_threshold and col in df.columns
        }
        if not selected:
            raise ValueError(f"Aucune variable avec IV ≥ {iv_threshold}. "
                             "Baissez le seuil ou relancez le WOE.")

        target_series = df[target_col].dropna()
        vals = sorted(target_series.unique(), key=str)
        target_map = {vals[0]: 0, vals[1]: 1}
        y = df[target_col].map(target_map).dropna().astype(int)

        df_woe   = ModellingService.apply_woe_transform(df, target_col, selected, n_bins=10)
        woe_cols = [c for c in df_woe.columns if c != target_col]
        X = df_woe[woe_cols].loc[y.index].copy()

        return X, y, list(selected.keys())

    # ── Pipeline brut → Tree-based ────────────────────────────────────────────
    @staticmethod
    def prepare_raw_features(df: pd.DataFrame, target_col: str):
        feature_cols = [c for c in df.columns if c != target_col]

        target_series = df[target_col].dropna()
        vals = sorted(target_series.unique(), key=str)
        target_map = {vals[0]: 0, vals[1]: 1}
        y = df[target_col].map(target_map).dropna().astype(int)

        X = df[feature_cols].loc[y.index].copy()

        # Exclure colonnes identifiantes (cardinalité ≥ 90%)
        total = len(X)
        X = X[[c for c in X.columns if X[c].nunique() / total < 0.9]]

        # Encoder les colonnes non-numériques
        for col in X.select_dtypes(exclude=[np.number]).columns:
            le = LabelEncoder()
            # Cast to object first — Categorical dtype blocks assignment of new values
            X[col] = X[col].astype(object)
            mask = X[col].notna()
            X.loc[mask, col] = le.fit_transform(X.loc[mask, col].astype(str))
            X[col] = pd.to_numeric(X[col], errors='coerce')

        return X, y, list(X.columns)

    # ── Pipeline pré-encodé (datamarts pipeline_service) ─────────────────────
    @staticmethod
    def prepare_preencoded_features(df: pd.DataFrame, target_col: str):
        """
        Extraction X/y depuis un datamart déjà encodé (logit WOE ou tree OHE+TE).
        Pas de transformation supplémentaire — juste conversion des types résiduels.
        """
        feature_cols = [c for c in df.columns if c != target_col]

        target_series = df[target_col].dropna()
        vals = sorted(target_series.unique(), key=str)
        target_map = {vals[0]: 0, vals[1]: 1}
        y = df[target_col].map(target_map).dropna().astype(int)

        X = df[feature_cols].loc[y.index].copy()

        # Convertir les booléens OHE en int
        for col in X.select_dtypes(include=['bool']).columns:
            X[col] = X[col].astype(int)

        # Convertir les non-numériques résiduels (sécurité)
        for col in X.select_dtypes(exclude=[np.number]).columns:
            X[col] = X[col].astype(object)
            mask = X[col].notna()
            le = LabelEncoder()
            X.loc[mask, col] = le.fit_transform(X.loc[mask, col].astype(str))
            X[col] = pd.to_numeric(X[col], errors='coerce')

        return X, y, list(X.columns)

    # ── ACP optionnelle ───────────────────────────────────────────────────────
    @staticmethod
    def apply_pca(X: pd.DataFrame, n_components: int | None = None,
                  variance_threshold: float = 0.95):
        imp    = SimpleImputer(strategy='median')
        X_imp  = imp.fit_transform(X.values.astype(float))

        pca_full = PCA().fit(X_imp)
        cum_var  = np.cumsum(pca_full.explained_variance_ratio_)

        if n_components is None:
            n_components = int(np.searchsorted(cum_var, variance_threshold) + 1)
        n_components = min(n_components, X_imp.shape[1], X_imp.shape[0] - 1)

        pca   = PCA(n_components=n_components)
        X_pca = pca.fit_transform(X_imp)
        X_out = pd.DataFrame(X_pca,
                             columns=[f"PC{i+1}" for i in range(n_components)],
                             index=X.index)

        evr = pca.explained_variance_ratio_
        return X_out, {
            'n_components':        n_components,
            'n_input_features':    X.shape[1],
            'explained_variance':  [round(float(v), 4) for v in evr],
            'cumulative_variance': [round(float(v), 4) for v in np.cumsum(evr)],
            'total_variance_kept': round(float(evr.sum()), 4),
        }

    # ── Métriques ─────────────────────────────────────────────────────────────

    @staticmethod
    def _safe_kde(data: np.ndarray, x: np.ndarray) -> np.ndarray:
        try:
            return gaussian_kde(data)(x)
        except np.linalg.LinAlgError:
            # Variance quasi-nulle (proba concentrées) → jitter pour régulariser
            rng = np.random.default_rng(42)
            jittered = np.clip(data + rng.normal(0, 1e-4, size=len(data)), 0, 1)
            return gaussian_kde(jittered)(x)

    @staticmethod
    def _ks(y_true, y_prob):
        fpr, tpr, _ = roc_curve(y_true, y_prob)
        return round(float(np.max(tpr - fpr)), 4)

    @staticmethod
    def _roc_sample(fpr, tpr, n=120):
        idx = np.linspace(0, len(fpr) - 1, min(n, len(fpr))).astype(int)
        return {
            'fpr': [round(float(fpr[i]), 4) for i in idx],
            'tpr': [round(float(tpr[i]), 4) for i in idx],
        }

    # ── Entraînement + évaluation ─────────────────────────────────────────────
    @staticmethod
    def train_and_evaluate(X: pd.DataFrame, y: pd.Series,
                           model_type: str, cv_folds: int = 5,
                           test_size: float = 0.2) -> dict:
        X_arr = X.values.astype(float)
        y_arr = np.array(y, dtype=int)

        # Split train / test avant toute transformation
        X_train, X_test, y_train, y_test = train_test_split(
            X_arr, y_arr, test_size=test_size, stratify=y_arr, random_state=42
        )

        # Imputation ajustée sur le train uniquement
        imp     = SimpleImputer(strategy='median')
        X_train = imp.fit_transform(X_train)
        X_test  = imp.transform(X_test)

        if model_type == 'logit':
            model = LogisticRegression(max_iter=1000, random_state=42, solver='lbfgs')
        elif model_type == 'random_forest':
            model = RandomForestClassifier(n_estimators=200, random_state=42, n_jobs=-1)
        elif model_type == 'xgboost':
            if not HAS_XGB:
                raise ValueError("XGBoost non installé — pip install xgboost")
            model = xgb.XGBClassifier(n_estimators=100, random_state=42,
                                       eval_metric='logloss', verbosity=0)
        elif model_type == 'lightgbm':
            if not HAS_LGB:
                raise ValueError("LightGBM non installé — pip install lightgbm")
            model = lgb.LGBMClassifier(n_estimators=100, random_state=42, verbosity=-1)
        else:
            raise ValueError(f"Modèle inconnu : {model_type}")

        # Validation croisée sur le train set uniquement
        cv          = StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=42)
        y_prob_cv   = cross_val_predict(model, X_train, y_train, cv=cv,
                                        method='predict_proba')[:, 1]
        auc_cv  = round(float(roc_auc_score(y_train, y_prob_cv)), 4)
        gini_cv = round(2 * auc_cv - 1, 4)
        ks_cv   = TrainingService._ks(y_train, y_prob_cv)

        # Entraînement final sur le train set complet
        model.fit(X_train, y_train)

        # Évaluation sur le test set (données jamais vues)
        y_prob_test = model.predict_proba(X_test)[:, 1]
        y_pred_test = (y_prob_test >= 0.5).astype(int)
        
        # Distributions des probas prédites pour les classes 0 et 1

        x = np.linspace(0,1,200)

        prob_0 = y_prob_test[y_test == 0]
        prob_1 = y_prob_test[y_test == 1]

        group_0 = TrainingService._safe_kde(prob_0, x)
        group_1 = TrainingService._safe_kde(prob_1, x)

        # ----------------------------------------------------------
        # Courbe lift et gain

        order           = np.argsort(y_prob_test)[::-1]
        y_sorted        = y_test[order]
        cum_positives   = np.cumsum(y_sorted)
        total_positives = cum_positives[-1]
        cum_pct_samples = np.arange(1, len(y_test) + 1) / len(y_test)
        cum_pct_pos     = cum_positives / total_positives if total_positives > 0 else np.zeros_like(cum_positives, dtype=float)
        lift            = cum_pct_pos / cum_pct_samples

        idx_lift = np.linspace(0, len(cum_pct_samples) - 1, 100).astype(int)

        # ----------------------------------------------------------


        auc_test  = round(float(roc_auc_score(y_test, y_prob_test)), 4)
        gini_test = round(2 * auc_test - 1, 4)
        ks_test   = TrainingService._ks(y_test, y_prob_test)

        fpr, tpr, _ = roc_curve(y_test, y_prob_test)
        roc = TrainingService._roc_sample(fpr, tpr)
        cm  = confusion_matrix(y_test, y_pred_test).tolist()

        # Importance des features
        feat_names = list(X.columns)
        if hasattr(model, 'coef_'):
            raw_imp  = [float(abs(v)) for v in model.coef_[0]]
            imp_type = 'Coefficient |β|'
        elif hasattr(model, 'feature_importances_'):
            raw_imp  = [float(v) for v in model.feature_importances_]
            imp_type = 'Feature importance'
        else:
            raw_imp  = []
            imp_type = 'N/A'

        feature_importance = sorted(
            [{'feature': n, 'importance': round(v, 4)}
             for n, v in zip(feat_names, raw_imp)],
            key=lambda x: x['importance'], reverse=True
        )[:20]

        return {
            'model_type':         model_type,
            # Métriques CV (train set)
            'auc':                auc_cv,
            'gini':               gini_cv,
            'ks':                 ks_cv,
            # Métriques test set (hold-out)
            'auc_test':           auc_test,
            'gini_test':          gini_test,
            'ks_test':            ks_test,
            'confusion_matrix':   cm,
            'roc_curve':          roc,
            'feature_importance': feature_importance,
            'importance_type':    imp_type,
            'n_features':         X_train.shape[1],
            'n_samples':          int(len(y_arr)),
            'n_train':            int(len(y_train)),
            'n_test':             int(len(y_test)),
            'cv_folds':           cv_folds,
            'prob_distribution': {
                'x': [round(float(v), 4) for v in x],
                'group_0': [round(float(p), 4) for p in group_0],
                'group_1': [round(float(p), 4) for p in group_1],
            },
            'lift_curve': {
                'x':    [round(float(cum_pct_samples[i]), 4) for i in idx_lift],
                'lift': [round(float(lift[i]),            4) for i in idx_lift],
            },
        }
