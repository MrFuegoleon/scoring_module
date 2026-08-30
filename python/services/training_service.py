import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_predict, cross_val_score, train_test_split, RandomizedSearchCV
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.decomposition import PCA
from sklearn.calibration import CalibratedClassifierCV
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score, roc_curve, confusion_matrix, f1_score, balanced_accuracy_score
from utils import safe_kde, roc_sample


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
        # n_estimators fixé haut (300) dans le constructeur — plus c'est élevé mieux c'est,
        # jamais d'overfit → inutile de gaspiller du budget de recherche dessus.
        'max_depth': [None, 10, 20, 30],
        'min_samples_split': [2, 5, 10],
        'min_samples_leaf': [1, 2, 4],            # régularise mieux que split seul
        'max_features': ['sqrt', 'log2', 0.5],    # diversité réelle
        'class_weight': [None, 'balanced'],
    },
    'xgboost': {
        # n_estimators trouvé par early stopping (hors grille)
        'max_depth': [3, 5, 7, 9],
        'learning_rate': [0.01, 0.03, 0.05, 0.1],
        'subsample': [0.7, 0.8, 1.0],
        'colsample_bytree': [0.7, 0.8, 1.0],
        'min_child_weight': [1, 3, 5],
        'gamma': [0, 0.1, 0.3],
        'reg_alpha': [0, 0.1, 1],
        'reg_lambda': [0.5, 1, 2, 5],           
    },
    'lightgbm': {
        # n_estimators trouvé par early stopping (hors grille)
        'max_depth': [-1, 5, 10],
        'learning_rate': [0.01, 0.03, 0.05, 0.1],
        'num_leaves': [15, 31, 63, 127],
        'min_child_samples': [10, 20, 50],
        'subsample': [0.7, 0.8, 1.0],             # actif via subsample_freq=1 (constructeur)
        'colsample_bytree': [0.7, 0.8, 1.0],
        'reg_alpha': [0, 0.1, 1],
        'reg_lambda': [0, 0.1, 1],               
        'min_split_gain': [0.0, 0.1],
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
    def prepare_preencoded_features(df: pd.DataFrame, target_col: str,
                                    positive_class=None):
        """
        Extraction X/y depuis un datamart déjà encodé (logit WOE ou tree OHE+TE).
        Pas de transformation supplémentaire — juste conversion des types résiduels.
        positive_class : modalité codée 1 (l'événement modélisé).
        """
        from services.modelling_service import ModellingService

        feature_cols = [c for c in df.columns if c != target_col]

        target_map, class_names = ModellingService.build_target_map(
            df[target_col], positive_class
        )
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

        return X, y, list(X.columns), class_names

    # ── Métriques ─────────────────────────────────────────────────────────────

    @staticmethod
    def _ks(y_true, y_prob):
        fpr, tpr, _ = roc_curve(y_true, y_prob)
        return round(float(np.max(tpr - fpr)), 4)

    # ── Importance des features (gère le wrapper de calibration) ──────────────
    @staticmethod
    def _model_importance(model) -> tuple[list, str]:
        """
        Extrait l'importance des features d'un modèle brut (coef_ / feature_importances_)
        ou d'un CalibratedClassifierCV (moyenne sur les estimateurs des folds).
        """
        if hasattr(model, 'coef_'):
            return [float(abs(v)) for v in model.coef_[0]], 'Coefficient |β|'
        if hasattr(model, 'feature_importances_'):
            return [float(v) for v in model.feature_importances_], 'Feature importance'

        # CalibratedClassifierCV : agréger les estimateurs internes des folds
        calibrated = getattr(model, 'calibrated_classifiers_', None)
        if calibrated:
            imps = []
            label = 'Feature importance'
            for cc in calibrated:
                est = getattr(cc, 'estimator', None) or getattr(cc, 'base_estimator', None)
                if est is None:
                    continue
                if hasattr(est, 'feature_importances_'):
                    imps.append(np.asarray(est.feature_importances_, dtype=float))
                elif hasattr(est, 'coef_'):
                    # Logit calibré : ce sont bien des coefficients, pas des gains d'arbre
                    imps.append(np.abs(np.asarray(est.coef_[0], dtype=float)))
                    label = 'Coefficient |β|'
            if imps:
                return [float(v) for v in np.mean(imps, axis=0)], label

        return [], 'N/A'

    # ── Helper : seuil de classification optimal (sans data leakage) ─────────
    @staticmethod
    def _find_optimal_threshold(y_true, y_prob, strategy: str = 'f1') -> float:
        if strategy == 'youden':
            fpr, tpr, thresholds = roc_curve(y_true, y_prob)
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
    def _adaptive_n_iter(grid_size, n_iter_requested: int) -> int:
        if grid_size == float('inf'):
            return n_iter_requested
        # Ne jamais dépasser la taille de la grille, mais respecter le choix utilisateur
        return min(n_iter_requested, int(grid_size))

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

    # ── Helper : nombre d'arbres optimal par early stopping (boosting) ────────
    @staticmethod
    def _early_stopping_n_estimators(model_type: str, params: dict,
                                     X_train, y_train,
                                     max_trees: int = 2000, patience: int = 50):
        """
        Trouve le nombre optimal d'arbres via early stopping sur un split interne
        train/validation. Retourne un n_estimators à FIXER pour la suite (CV + fit
        final) — plus efficace et plus robuste que de tuner n_estimators dans la grille.
        Retourne None si indisponible (fallback sur le défaut du modèle).
        """
        try:
            X_es, X_val, y_es, y_val = train_test_split(
                X_train, y_train, test_size=0.2, stratify=y_train, random_state=42
            )
        except ValueError:
            return None

        p = dict(params)
        p.pop('n_estimators', None)
        try:
            if model_type == 'xgboost':
                m = xgb.XGBClassifier(
                    random_state=42, eval_metric='logloss', verbosity=0,
                    n_estimators=max_trees, early_stopping_rounds=patience, **p,
                )
                m.fit(X_es, y_es, eval_set=[(X_val, y_val)], verbose=False)
                best = getattr(m, 'best_iteration', None)
                return max(50, int(best) + 1) if best is not None else None
            if model_type == 'lightgbm':
                m = lgb.LGBMClassifier(
                    random_state=42, verbosity=-1, importance_type='gain',
                    subsample_freq=1, n_estimators=max_trees, **p,
                )
                m.fit(X_es, y_es, eval_set=[(X_val, y_val)],
                      callbacks=[lgb.early_stopping(patience, verbose=False)])
                best = getattr(m, 'best_iteration_', None)
                return max(50, int(best)) if best else None
        except Exception:
            return None
        return None

    # ── ACP automatique validée par CV sur l'AUC ─────────────────────────────
    @staticmethod
    def _auto_pca(X_train: np.ndarray, y_train: np.ndarray,
                  cv_folds: int = 3,
                  tolerance: float = 0.005) -> tuple:
        """
        Détermine automatiquement si l'ACP améliore ou maintient l'AUC en CV.

        Logique :
          1. AUC baseline sans ACP (LR rapide, 3-fold CV)
          2. AUC avec ACP pour plusieurs valeurs de k (20/40/60/80 % des features)
             — k validé sur l'AUC, pas sur la variance expliquée
          3. Si best_AUC_pca >= baseline_AUC - tolerance → ACP acceptée
             Sinon → ACP rejetée, features originales conservées

        Returns : (should_apply: bool, fitted_pca | None, report: dict)
        """
        n_features = X_train.shape[1]
        n_samples  = X_train.shape[0]

        # Pas de réduction utile si trop peu de features
        if n_features < 5:
            return False, None, {
                'applied': False,
                'reason':  'Trop peu de features pour l\'ACP',
                'n_features_original': n_features,
            }

        # Modèle léger pour la validation — indépendant du modèle final
        # lbffs : bien plus rapide que saga pour une pénalité L2 (proxy de validation)
        quick_model = LogisticRegression(max_iter=500, random_state=42,
                                         solver='lbfgs', penalty='l2')
        cv = StratifiedKFold(n_splits=min(cv_folds, 3), shuffle=True, random_state=42)

        # Baseline sans ACP
        try:
            baseline_auc = float(
                cross_val_score(quick_model, X_train, y_train,
                                cv=cv, scoring='roc_auc').mean()
            )
        except Exception:
            return False, None, {
                'applied': False,
                'reason':  'Erreur baseline CV',
                'n_features_original': n_features,
            }

        # Candidats : proportions de n_features, bornés à [2, n_features-1]
        max_k = min(n_features - 1, n_samples - 2)
        raw_candidates = [
            max(2, int(max_k * 0.20)),
            max(2, int(max_k * 0.40)),
            max(2, int(max_k * 0.60)),
            max(2, int(max_k * 0.80)),
        ]
        candidates = sorted(set(k for k in raw_candidates if 1 < k < n_features))

        evaluated = []
        for k in candidates:
            try:
                pipe   = Pipeline([('scaler', StandardScaler()),
                                   ('pca', PCA(n_components=k, random_state=42)),
                                   ('clf', quick_model)])
                scores = cross_val_score(pipe, X_train, y_train,
                                         cv=cv, scoring='roc_auc')
                evaluated.append({
                    'n_components': k,
                    'auc':          round(float(scores.mean()), 4),
                    'std':          round(float(scores.std()),  4),
                })
            except Exception:
                pass

        if not evaluated:
            return False, None, {
                'applied':             False,
                'reason':              'Tous les candidats ont échoué',
                'baseline_auc':        round(baseline_auc, 4),
                'n_features_original': n_features,
            }

        best     = max(evaluated, key=lambda r: r['auc'])
        delta    = round(best['auc'] - baseline_auc, 4)
        accepted = delta >= -tolerance   # ACP acceptée si perte ≤ tolérance

        fitted_pca = None
        if accepted:
            fitted_pca = Pipeline([
                ('scaler', StandardScaler()),
                ('pca',    PCA(n_components=best['n_components'], random_state=42)),
            ])
            fitted_pca.fit(X_train)

        return accepted, fitted_pca, {
            'applied':              accepted,
            'reason':               'ACP acceptée' if accepted else
                                    f'ACP rejetée — perte AUC = {abs(delta):.4f} > tolérance {tolerance}',
            'baseline_auc':         round(baseline_auc, 4),
            'best_n_components':    best['n_components'],
            'best_auc_pca':         best['auc'],
            'auc_delta':            delta,
            'tolerance':            tolerance,
            'candidates':           evaluated,
            'n_features_original':  n_features,
            'n_features_after':     best['n_components'] if accepted else n_features,
            'variance_explained':   (
                round(float(fitted_pca.named_steps['pca'].explained_variance_ratio_.sum()), 4)
                if fitted_pca else None
            ),
        }

    # ── Entraînement + évaluation ─────────────────────────────────────────────
    @staticmethod
    def train_and_evaluate(X: pd.DataFrame, y: pd.Series,
                           model_type: str, cv_folds: int = 5,
                           test_size: float = 0.2,
                           class_names: list = None,
                           use_tuning: bool = False,
                           n_iter: int = 20,
                           X_test_pre=None, y_test_pre=None,
                           return_artifact: bool = False):
        X_arr = X.values.astype(float)
        y_arr = np.array(y, dtype=int)
        encoded_features = list(X.columns)   # ordre des features encodées (avant ACP/scaler)
        post_transformers = []               # transformeurs post-encodage à rejouer au déploiement

        if X_test_pre is not None and y_test_pre is not None:
            # Chemin sans leakage — X/y sont déjà le train, test fourni séparément
            X_train  = X_arr
            y_train  = y_arr
            X_test   = X_test_pre.values.astype(float) if hasattr(X_test_pre, 'values') else np.array(X_test_pre, dtype=float)
            y_test   = y_test_pre.values.astype(int)   if hasattr(y_test_pre, 'values') else np.array(y_test_pre, dtype=int)
            n_total  = int(len(y_train) + len(y_test))
        else:
            # Chemin legacy — split interne
            X_train, X_test, y_train, y_test = train_test_split(
                X_arr, y_arr, test_size=test_size, stratify=y_arr, random_state=42
            )
            n_total = int(len(y_arr))

        # Imputation ajustée sur le train uniquement — seulement si NaN réels présents.
        # Les datamarts n'en ont pas : le WOE mappe tout bin (y compris '__missing__')
        # sur une valeur, et le pipeline tree impute en -999. SimpleImputer serait
        # un no-op coûteux.
        if np.isnan(X_train).any() or np.isnan(X_test).any():
            imp     = SimpleImputer(strategy='median')
            X_train = imp.fit_transform(X_train)
            X_test  = imp.transform(X_test)
            post_transformers.append(imp)

        # Noms de features — mis à jour si l'ACP réduit les dimensions
        feat_names = list(X.columns)

        # ── Validation du dataset sur les features originales ─────────────────
        cv_folds_requested = cv_folds
        dataset_val = TrainingService._validate_dataset(X_train, y_train)
        if cv_folds > dataset_val['recommended_cv_folds']:
            dataset_val['warnings'].append(
                f"cv_folds réduit de {cv_folds} à {dataset_val['recommended_cv_folds']} "
                f"(classe minoritaire : {int(dataset_val['minority_ratio'] * len(y_train))} obs)."
            )
            cv_folds = dataset_val['recommended_cv_folds']

        imbalance = TrainingService._detect_imbalance(y_train)

        # ── ACP automatique — logit uniquement, validée par CV sur l'AUC ─────
        pca_auto_report = None
        if model_type == 'logit':
            pca_applied, fitted_pca, pca_auto_report = TrainingService._auto_pca(
                X_train, y_train, cv_folds=min(cv_folds, 3)
            )
            if pca_applied and fitted_pca is not None:
                X_train    = fitted_pca.transform(X_train)
                X_test     = fitted_pca.transform(X_test)
                feat_names = [f'PC{i + 1}' for i in range(X_train.shape[1])]
                post_transformers.append(fitted_pca)
            else:
                # Fix #5 : le baseline _auto_pca était calculé sur données scalées (StandardScaler
                # dans le pipeline) — on applique le même scaling si l'ACP est rejetée.
                _sc        = StandardScaler()
                X_train    = _sc.fit_transform(X_train)
                X_test     = _sc.transform(X_test)
                post_transformers.append(_sc)

        # ── RandomSearch optionnel ────────────────────────────────────────────
        tuning_info = None
        best_params = {}
        early_stopping_info = None
        if use_tuning and model_type in PARAM_GRIDS:
            # Copie de la grille pour pouvoir l'ajuster sans toucher au global
            grid = {k: list(v) if isinstance(v, list) else v
                    for k, v in PARAM_GRIDS[model_type].items()}

            if model_type == 'logit':
                base = LogisticRegression(random_state=42)
            elif model_type == 'random_forest':
                base = RandomForestClassifier(random_state=42, n_jobs=-1, n_estimators=300)
            elif model_type == 'xgboost':
                base = xgb.XGBClassifier(random_state=42, eval_metric='logloss', verbosity=0)
            elif model_type == 'lightgbm':
                base = lgb.LGBMClassifier(random_state=42, verbosity=-1,
                                          importance_type='gain', subsample_freq=1)

            grid_size = TrainingService._compute_grid_size(grid)

            search_scoring = (
                'average_precision' if (imbalance['is_severe'] or imbalance['is_imbalanced'])
                else 'roc_auc'
            )
            n_candidates = TrainingService._adaptive_n_iter(grid_size, n_iter)
            # Fix #3 : cv_search adapté au même cv_folds que l'évaluation principale
            cv_search    = StratifiedKFold(n_splits=min(cv_folds, 3), shuffle=True, random_state=42)
            # Fix #2 : error_score=0.0 pour éviter NaN non-sérialisable en JSON
            search       = RandomizedSearchCV(
                base, grid, n_iter=n_candidates, scoring=search_scoring,
                cv=cv_search, n_jobs=-1, refit=False, random_state=42, error_score=0.0,
            )

            search.fit(X_train, y_train)
            best_params  = search.best_params_
            best_score   = search.best_score_
            # Fix #2 : garde NaN si tous les candidats ont échoué (score=0.0 suspect)
            safe_score   = round(float(best_score), 4) if (best_score is not None and not np.isnan(best_score)) else None
            tuning_info  = {
                'strategy':         'random',
                'scoring':          search_scoring,
                'best_params':      best_params,
                # Fix #1 : renommé best_score_cv (peut être AP ou AUC selon scoring)
                'best_score_cv':    safe_score,
                'n_candidates':     n_candidates,
                # Fix #4 : n_iter_requested exposé pour transparence si adapté
                'n_iter_requested': n_iter,
                'grid_size':        grid_size if grid_size != float('inf') else 'continuous',
            }

        # ── Construction du modèle (avec ou sans meilleurs params) ───────────
        if model_type == 'logit':
            p = dict(best_params)
            p.setdefault('max_iter', 1000)
            # lbfgs : rapide pour penalty=None/l2. Le tuning passe le solver à saga/liblinear
            # quand il sélectionne L1 (best_params contient alors 'solver').
            p.setdefault('solver', 'lbfgs')
            p.setdefault('penalty', None)
            # Pas de class_weight='balanced' automatique : rééquilibrer déplace
            # l'intercept, la proba cesse d'être une PD lisible et surestime le risque.
            # Le déséquilibre est déjà pris en charge par le seuil optimal calculé
            # plus bas — le rééquilibrage ferait doublon. Si le tuning retient malgré
            # tout 'balanced', le modèle est calibré comme les arbres (cf. plus bas).
            base_model = LogisticRegression(random_state=42, **p)
        elif model_type == 'random_forest':
            params = dict(best_params)
            params.setdefault('n_estimators', 300)   # fixé haut (hors grille)
            if imbalance['is_imbalanced']:
                params.setdefault('class_weight', 'balanced')
            base_model = RandomForestClassifier(random_state=42, n_jobs=-1, **params)
        elif model_type == 'xgboost':
            if not HAS_XGB:
                raise ValueError("XGBoost non installé — pip install xgboost")
            xp = dict(best_params)
            n_es = TrainingService._early_stopping_n_estimators('xgboost', xp, X_train, y_train)
            if n_es:
                xp['n_estimators'] = n_es
                early_stopping_info = {'n_estimators': n_es}
            base_model = xgb.XGBClassifier(random_state=42, eval_metric='logloss', verbosity=0, **xp)
        elif model_type == 'lightgbm':
            if not HAS_LGB:
                raise ValueError("LightGBM non installé — pip install lightgbm")
            lp = dict(best_params)
            n_es = TrainingService._early_stopping_n_estimators('lightgbm', lp, X_train, y_train)
            if n_es:
                lp['n_estimators'] = n_es
                early_stopping_info = {'n_estimators': n_es}
            base_model = lgb.LGBMClassifier(random_state=42, verbosity=-1,
                                            importance_type='gain', subsample_freq=1, **lp)
        else:
            raise ValueError(f"Modèle inconnu : {model_type}")

        # ── Calibration des probabilités ─────────────────────────────────────────
        # En scoring la proba EST le score : elle doit rester lisible comme une PD.
        # Deux sources de distorsion, traitées par la même règle :
        #   1. les arbres produisent des probas mal calibrées par construction ;
        #   2. tout rééquilibrage de classes (class_weight) déplace l'intercept —
        #      y compris sur un logit, que le tuning peut choisir de pondérer.
        # Un logit non pondéré est calibré par construction → laissé intact.
        # La calibration étant monotone, elle ne dégrade ni l'AUC ni le Gini.
        reweighted = best_params.get('class_weight') is not None
        needs_calibration = model_type in ('random_forest', 'xgboost', 'lightgbm') or reweighted

        calibration_info = None
        if needs_calibration:
            calib_method = 'isotonic' if len(y_train) >= 1000 else 'sigmoid'
            calib_cv     = max(2, min(3, cv_folds))
            model = CalibratedClassifierCV(base_model, method=calib_method, cv=calib_cv)
            calibration_info = {
                'method': calib_method,
                'cv':     calib_cv,
                'reason': 'rééquilibrage des classes' if (reweighted and model_type == 'logit')
                          else 'modèle à base d\'arbres',
            }
        else:
            model = base_model

        cv = StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=42)
        y_prob_cv = cross_val_predict(model, X_train, y_train, cv=cv,
                                      method='predict_proba')[:, 1]
        auc_cv  = round(float(roc_auc_score(y_train, y_prob_cv)), 4)
        gini_cv = round(2 * auc_cv - 1, 4)
        ks_cv   = TrainingService._ks(y_train, y_prob_cv)

        # Seuil optimal calculé sur le train (CV) — jamais sur le test
        optimal_threshold = TrainingService._find_optimal_threshold(y_train, y_prob_cv, strategy='f1')

        model.fit(X_train, y_train)

        # Évaluation sur le test set (données jamais vues)
        y_prob_test = model.predict_proba(X_test)[:, 1]
        y_pred_test = (y_prob_test >= optimal_threshold).astype(int)

        # Distributions des probas prédites pour les classes 0 et 1
        x = np.linspace(0, 1, 200)

        prob_0 = y_prob_test[y_test == 0]
        prob_1 = y_prob_test[y_test == 1]

        group_0 = safe_kde(prob_0, x)
        group_1 = safe_kde(prob_1, x)

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

        # ── Qualité de calibration (test) ────────────────────────────────────
        # L'AUC ne mesure que le classement ; ces indicateurs disent si la proba
        # est lisible telle quelle comme probabilité d'événement.
        #   brier  : erreur quadratique moyenne sur la proba (plus bas = mieux)
        #   gap    : proba moyenne prédite − taux observé. Un modèle rééquilibré
        #            non calibré affiche ici un écart franchement positif.
        mean_pred     = float(np.mean(y_prob_test))
        observed_rate = float(np.mean(y_test))
        calibration_quality = {
            'brier':          round(float(np.mean((y_prob_test - y_test) ** 2)), 4),
            'mean_predicted': round(mean_pred, 4),
            'observed_rate':  round(observed_rate, 4),
            'gap':            round(mean_pred - observed_rate, 4),
        }

        fpr, tpr, _ = roc_curve(y_test, y_prob_test)
        roc = roc_sample(fpr, tpr)
        cm  = confusion_matrix(y_test, y_pred_test).tolist()

        # Importance des features — gère aussi le wrapper de calibration
        raw_imp, imp_type = TrainingService._model_importance(model)

        feature_importance = sorted(
            [{'feature': n, 'importance': round(v, 4)}
             for n, v in zip(feat_names, raw_imp)],
            key=lambda x: x['importance'], reverse=True
        )[:20]

        result = {
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
            'calibration':        calibration_info,
            'calibration_quality': calibration_quality,
            'early_stopping':     early_stopping_info,
            'dataset_diagnostic': {
                'minority_ratio':     imbalance['minority_ratio'],
                'is_imbalanced':      imbalance['is_imbalanced'],
                'is_severe':          imbalance['is_severe'],
                'warnings':           dataset_val['warnings'],
                'cv_folds_used':      cv_folds,
                'cv_folds_requested': cv_folds_requested,
            },
            'roc_curve':          roc,
            'feature_importance': feature_importance,
            'importance_type':    imp_type,
            'n_features':         X_train.shape[1],
            'n_samples':          n_total,
            'n_train':            int(len(y_train)),
            'n_test':             int(len(y_test)),
            'cv_folds':           cv_folds_requested,
            'pca_auto':           pca_auto_report,
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

        if return_artifact:
            # Artifact de déploiement : tout ce qu'il faut pour rejouer la chaîne
            # encodage → post-transformeurs → modèle sur de nouvelles données brutes.
            artifact = {
                'model':             model,               # logit nu OU CalibratedClassifierCV
                'post_transformers': post_transformers,   # imputeur / scaler / ACP (dans l'ordre)
                'encoded_features':  encoded_features,     # ordre des colonnes encodées attendu
                'threshold':         float(optimal_threshold),
                'class_names':       class_names or ['0', '1'],
            }
            return result, artifact

        return result