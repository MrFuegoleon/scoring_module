import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_predict, train_test_split, RandomizedSearchCV
from sklearn.preprocessing import LabelEncoder
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score, roc_curve, confusion_matrix, f1_score, balanced_accuracy_score
from scipy.stats import gaussian_kde

try:
    from imblearn.over_sampling import SMOTE
    from imblearn.under_sampling import RandomUnderSampler
    HAS_IMBLEARN = True
except ImportError:
    HAS_IMBLEARN = False

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


PARAM_GRIDS = {
    'logit': {
        'C': [0.001, 0.01, 0.1, 1, 10, 100],
        'penalty': ['l1', 'l2'],
        'solver': ['liblinear', 'saga'],          # supportent l1 et l2
        'max_iter': [500, 1000, 2000],            # 'auto' n'existe pas pour LogisticRegression
        'class_weight': [None, 'balanced'],
    },
    'random_forest': {
        'n_estimators': [100, 200, 400],
        'max_depth': [None, 10, 20, 30],
        'min_samples_split': [2, 5, 10],
        'min_samples_leaf': [1, 2, 4],            # régularise mieux que split seul
        'max_features': ['sqrt', 'log2', 0.5],    # diversité réelle
        'class_weight': [None, 'balanced'],
    },
    'xgboost': {
        'n_estimators': [100, 200, 400],
        'max_depth': [3, 5, 7, 9],
        'learning_rate': [0.01, 0.05, 0.1, 0.2],
        'subsample': [0.7, 0.8, 1.0],
        'colsample_bytree': [0.7, 0.8, 1.0],
        'min_child_weight': [1, 3, 5],
        'gamma': [0, 0.1, 0.3],
        'reg_alpha': [0, 0.1, 1],
    },
    'lightgbm': {
        'n_estimators': [100, 200, 400],
        'max_depth': [-1, 5, 10],
        'learning_rate': [0.01, 0.05, 0.1],
        'num_leaves': [15, 31, 63, 127],
        'min_child_samples': [10, 20, 50],
        'subsample': [0.7, 0.8, 1.0],
        'colsample_bytree': [0.7, 0.8, 1.0],
        'reg_alpha': [0, 0.1, 1],
        # 'importance_type' fixé dans le constructeur (n'affecte pas la perf)
    },
}


def available_models():
    return {
        'logit':         {'name': 'Régression Logistique', 'pipeline': 'woe',  'available': True},
        'xgboost':       {'name': 'XGBoost',               'pipeline': 'raw',  'available': HAS_XGB},
        'lightgbm':      {'name': 'LightGBM',              'pipeline': 'raw',  'available': HAS_LGB},
        'random_forest': {'name': 'Random Forest',         'pipeline': 'raw',  'available': True},
    }


class TrainingService:

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

        class_names = [str(vals[0]), str(vals[1])]
        return X, y, list(X.columns), class_names

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

    # ── Helper : seuil de classification optimal (sans data leakage) ─────────
    @staticmethod
    def _find_optimal_threshold(y_true, y_prob, strategy: str = 'f1') -> float:
        if strategy == 'youden':
            _, tpr, thresholds = roc_curve(y_true, y_prob)
            fpr, _, _          = roc_curve(y_true, y_prob)
            return float(thresholds[np.argmax(tpr - fpr)])
        thresholds = np.linspace(0.05, 0.95, 91)
        if strategy == 'balanced_accuracy':
            scores = [balanced_accuracy_score(y_true, (y_prob >= t).astype(int))
                      for t in thresholds]
        else:  # f1
            scores = [f1_score(y_true, (y_prob >= t).astype(int), zero_division=0)
                      for t in thresholds]
        return float(thresholds[np.argmax(scores)])

    # ── Helper : détection du déséquilibre des classes ────────────────────────
    @staticmethod
    def _detect_imbalance(y) -> dict:
        counts         = np.bincount(y)
        minority_ratio = float(counts.min() / counts.sum())
        return {
            'minority_ratio': round(minority_ratio, 4),
            'is_imbalanced':  minority_ratio < 0.3,
            'is_severe':      minority_ratio < 0.1,
        }

    # ── Helper : n_iter adaptatif selon la taille de la grille ───────────────
    @staticmethod
    def _adaptive_n_iter(grid_size, n_iter_requested: int,
                         target_coverage: float = 0.05) -> int:
        if grid_size == float('inf'):
            return max(n_iter_requested, 50)
        if grid_size <= n_iter_requested:
            return int(grid_size)
        return min(max(n_iter_requested, int(grid_size * target_coverage)), 300)

    # ── Helper : validation du dataset + cv_folds recommandés ────────────────
    @staticmethod
    def _validate_dataset(X, y, min_samples: int = 50, min_per_class: int = 10) -> dict:
        warnings_list  = []
        counts         = np.bincount(y)
        min_class_count = int(counts.min())
        minority_ratio  = float(counts.min() / counts.sum())

        if len(y) < min_samples:
            raise ValueError(f"Dataset trop petit : {len(y)} obs (minimum {min_samples}).")
        if min_class_count < min_per_class:
            raise ValueError(
                f"Classe minoritaire trop petite : {min_class_count} obs (minimum {min_per_class})."
            )

        stds = np.std(X, axis=0)
        n_const = int(np.sum(stds < 1e-10))
        if n_const > 0:
            warnings_list.append(f"{n_const} feature(s) constante(s) détectée(s) (std < 1e-10).")

        recommended_cv_folds = max(2, min(10, min_class_count // 5))
        return {
            'warnings':             warnings_list,
            'recommended_cv_folds': recommended_cv_folds,
            'minority_ratio':       round(minority_ratio, 4),
        }

    # ── Helper : taille de grille robuste aux distributions continues ────────
    @staticmethod
    def _compute_grid_size(grid: dict) -> float:
        """Retourne le nombre de combinaisons. inf si distributions continues."""
        try:
            size = 1
            for v in grid.values():
                size *= len(v)
            return size
        except TypeError:
            return float('inf')

    # ── Entraînement + évaluation ─────────────────────────────────────────────
    @staticmethod
    def train_and_evaluate(X: pd.DataFrame, y: pd.Series,
                           model_type: str, cv_folds: int = 5,
                           test_size: float = 0.2,
                           resampling: str = 'none',
                           class_names: list = None,
                           use_tuning: bool = False,
                           n_iter: int = 20) -> dict:
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

        # ── Validation du dataset + ajustement cv_folds ──────────────────────
        cv_folds_requested = cv_folds
        dataset_val = TrainingService._validate_dataset(X_train, y_train)
        if cv_folds > dataset_val['recommended_cv_folds']:
            dataset_val['warnings'].append(
                f"cv_folds réduit de {cv_folds} à {dataset_val['recommended_cv_folds']} "
                f"(classe minoritaire : {int(dataset_val['minority_ratio'] * len(y_train))} obs)."
            )
            cv_folds = dataset_val['recommended_cv_folds']

        imbalance = TrainingService._detect_imbalance(y_train)

        resampling_info = {'method': resampling, 'n_before': int(len(y_train)), 'n_after': int(len(y_train))}

        if resampling != 'none' and not HAS_IMBLEARN:
            raise ValueError("imbalanced-learn non installé — pip install imbalanced-learn")

        def _make_sampler():
            if resampling == 'undersample':
                return RandomUnderSampler(random_state=42)
            elif resampling == 'oversample':
                return SMOTE(random_state=42)
            elif resampling == 'combined':
                from imblearn.combine import SMOTETomek
                return SMOTETomek(random_state=42)

        # ── RandomSearch optionnel ────────────────────────────────────────────
        tuning_info = None
        best_params = {}
        if use_tuning and model_type in PARAM_GRIDS:
            # Copie de la grille pour pouvoir l'ajuster sans toucher au global
            grid = {k: list(v) if isinstance(v, list) else v
                    for k, v in PARAM_GRIDS[model_type].items()}

            # Éviter la double correction du déséquilibre : si rééchantillonnage
            # actif, on force class_weight=None
            if resampling != 'none' and 'class_weight' in grid:
                grid['class_weight'] = [None]

            if model_type == 'logit':
                base = LogisticRegression(random_state=42)
            elif model_type == 'random_forest':
                base = RandomForestClassifier(random_state=42, n_jobs=-1)
            elif model_type == 'xgboost':
                base = xgb.XGBClassifier(random_state=42, eval_metric='logloss', verbosity=0)
            elif model_type == 'lightgbm':
                base = lgb.LGBMClassifier(random_state=42, verbosity=-1, importance_type='gain')

            grid_size = TrainingService._compute_grid_size(grid)

            search_scoring = (
                'average_precision' if (imbalance['is_severe'] or imbalance['is_imbalanced'])
                else 'roc_auc'
            )
            n_candidates = TrainingService._adaptive_n_iter(grid_size, n_iter)
            cv_search    = StratifiedKFold(n_splits=3, shuffle=True, random_state=42)
            search       = RandomizedSearchCV(
                base, grid, n_iter=n_candidates, scoring=search_scoring,
                cv=cv_search, n_jobs=-1, refit=False, random_state=42, error_score=np.nan,
            )

            search.fit(X_train, y_train)
            best_params = search.best_params_
            tuning_info = {
                'strategy':     'random',
                'scoring':      search_scoring,
                'best_params':  best_params,
                'best_auc_cv':  round(float(search.best_score_), 4),
                'n_candidates': n_candidates,
                'grid_size':    grid_size if grid_size != float('inf') else 'continuous',
            }

        # ── Construction du modèle (avec ou sans meilleurs params) ───────────
        if model_type == 'logit':
            p = dict(best_params)
            p.setdefault('max_iter', 1000)
            p.setdefault('solver', 'saga')
            p.setdefault('penalty', 'l1')
            model = LogisticRegression(random_state=42, **p)
        elif model_type == 'random_forest':
            model = RandomForestClassifier(random_state=42, n_jobs=-1, **best_params)
        elif model_type == 'xgboost':
            if not HAS_XGB:
                raise ValueError("XGBoost non installé — pip install xgboost")
            model = xgb.XGBClassifier(random_state=42, eval_metric='logloss', verbosity=0, **best_params)
        elif model_type == 'lightgbm':
            if not HAS_LGB:
                raise ValueError("LightGBM non installé — pip install lightgbm")
            model = lgb.LGBMClassifier(random_state=42, verbosity=-1,
                                       importance_type='gain', **best_params)
        else:
            raise ValueError(f"Modèle inconnu : {model_type}")

        # Validation croisée — SMOTE appliqué à l'intérieur de chaque fold
        cv = StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=42)
        if resampling != 'none':
            from imblearn.pipeline import Pipeline as ImbPipeline
            cv_estimator = ImbPipeline([('sampler', _make_sampler()), ('model', model)])
        else:
            cv_estimator = model
        y_prob_cv = cross_val_predict(cv_estimator, X_train, y_train, cv=cv,
                                      method='predict_proba')[:, 1]
        auc_cv  = round(float(roc_auc_score(y_train, y_prob_cv)), 4)
        gini_cv = round(2 * auc_cv - 1, 4)
        ks_cv   = TrainingService._ks(y_train, y_prob_cv)

        # Seuil optimal calculé sur le train (CV) — jamais sur le test
        optimal_threshold = TrainingService._find_optimal_threshold(y_train, y_prob_cv, strategy='f1')

        # Entraînement final — rééchantillonnage sur le train complet
        if resampling != 'none':
            X_train_fit, y_train_fit = _make_sampler().fit_resample(X_train, y_train)
            resampling_info['n_after'] = int(len(y_train_fit))
            model.fit(X_train_fit, y_train_fit)
        else:
            model.fit(X_train, y_train)

        # Évaluation sur le test set (données jamais vues)
        y_prob_test = model.predict_proba(X_test)[:, 1]
        y_pred_test = (y_prob_test >= optimal_threshold).astype(int)

        # Distributions des probas prédites pour les classes 0 et 1
        x = np.linspace(0, 1, 200)

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
            'class_names':        class_names or ['0', '1'],
            'optimal_threshold':  round(float(optimal_threshold), 4),
            'tuning':             tuning_info,
            'dataset_diagnostic': {
                'minority_ratio':     imbalance['minority_ratio'],
                'is_imbalanced':      imbalance['is_imbalanced'],
                'warnings':           dataset_val['warnings'],
                'cv_folds_used':      cv_folds,
                'cv_folds_requested': cv_folds_requested,
            },
            'roc_curve':          roc,
            'feature_importance': feature_importance,
            'importance_type':    imp_type,
            'n_features':         X_train.shape[1],
            'n_samples':          int(len(y_arr)),
            'n_train':            int(len(y_train)),
            'n_test':             int(len(y_test)),
            'cv_folds':           cv_folds_requested,
            'resampling':         resampling_info,
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