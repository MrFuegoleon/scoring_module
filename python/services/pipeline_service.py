import numpy as np
import pandas as pd
from services.modelling_service import ModellingService


class PipelineService:

    # ── Pipeline 1 : Régression Logistique (WOE) ──────────────────────────────
    @staticmethod
    def build_logit_pipeline(df: pd.DataFrame, target_col: str,
                              n_bins: int = 10) -> tuple[pd.DataFrame, dict]:
        """
        Numeric  : inf/-inf → NaN → -999, puis WOE
        Categoric: NaN → 'unknown', puis WOE
        """
        df = df.copy()
        num_cols = [c for c in df.columns
                    if c != target_col and pd.api.types.is_numeric_dtype(df[c])]
        cat_cols = [c for c in df.columns
                    if c != target_col and not pd.api.types.is_numeric_dtype(df[c])]

        # 1. inf/-inf → NaN
        if num_cols:
            df[num_cols] = df[num_cols].replace([np.inf, -np.inf], np.nan)

        # 2. Numériques : NaN → -999
        if num_cols:
            df[num_cols] = df[num_cols].fillna(-999)

        # 3. Catégoriques : NaN → 'unknown'
        for col in cat_cols:
            df[col] = df[col].astype(object).fillna('unknown').infer_objects(copy=False).astype(str)

        # 4. WOE sur toutes les features
        woe_report = ModellingService.compute_woe_iv(df, target_col, n_bins=n_bins)
        df_out = ModellingService.apply_woe_transform(df, target_col, woe_report, n_bins=n_bins)

        iv_summary = {'Inutile': 0, 'Faible': 0, 'Moyen': 0, 'Fort': 0, 'Suspect': 0}
        for info in woe_report.values():
            lbl = info['iv_label']
            iv_summary[lbl] = iv_summary.get(lbl, 0) + 1

        summary = {
            'n_numeric':      len(num_cols),
            'n_categorical':  len(cat_cols),
            'n_features_woe': len(woe_report),
            'n_rows':         len(df_out),
            'n_cols':         len(df_out.columns),
            'columns':        list(df_out.columns),
            'iv_summary':     iv_summary,
        }
        return df_out, summary

    # ── Pipeline 2 : Tree-based (OHE + Target Encoding) ──────────────────────
    @staticmethod
    def build_tree_pipeline(df: pd.DataFrame, target_col: str,
                             cardinality_threshold: int = 10,
                             smoothing: float = 0.2) -> tuple[pd.DataFrame, dict]:
        """
        Numeric      : inf/-inf → NaN → -999
        Cat. faible  : OHE
        Cat. haute   : Target Encoding avec lissage bayésien (smoothing)
        """
        df = df.copy()
        num_cols = [c for c in df.columns
                    if c != target_col and pd.api.types.is_numeric_dtype(df[c])]
        cat_cols = [c for c in df.columns
                    if c != target_col and not pd.api.types.is_numeric_dtype(df[c])]

        # 1. inf/-inf → NaN
        if num_cols:
            df[num_cols] = df[num_cols].replace([np.inf, -np.inf], np.nan)

        # 2. Numériques : NaN → -999
        if num_cols:
            df[num_cols] = df[num_cols].fillna(-999)

        # 3. Catégoriques : NaN → 'unknown'
        for col in cat_cols:
            df[col] = df[col].astype(object).fillna('unknown').infer_objects(copy=False).astype(str)

        # 4. Calcul de y binaire pour Target Encoding
        target_series = df[target_col].dropna()
        vals = sorted(target_series.unique(), key=str)
        target_map = {vals[0]: 0, vals[1]: 1}
        y = df[target_col].map(target_map).fillna(0)
        global_mean = float(y.mean())
        N = len(df)
        m = smoothing * N  # prior count

        ohe_cols, te_cols = [], []
        for col in cat_cols:
            if df[col].nunique() <= cardinality_threshold:
                ohe_cols.append(col)
            else:
                te_cols.append(col)

        # OHE
        ohe_new_cols = []
        if ohe_cols:
            dummies = pd.get_dummies(
                df[ohe_cols], columns=ohe_cols,
                prefix=ohe_cols, drop_first=False, dtype=int,
            )
            ohe_new_cols = list(dummies.columns)
            df = pd.concat([df.drop(columns=ohe_cols), dummies], axis=1)

        # Target Encoding : λᵢ = nᵢ / (nᵢ + m)
        for col in te_cols:
            col_data = pd.DataFrame({'cat': df[col], 'target': y})
            stats = col_data.groupby('cat')['target'].agg(['mean', 'count']).reset_index()
            stats.columns = ['cat', 'cat_mean', 'count']
            stats['encoded'] = (
                (stats['count'] * stats['cat_mean'] + m * global_mean) /
                (stats['count'] + m)
            )
            enc_map = dict(zip(stats['cat'], stats['encoded']))
            df[col] = df[col].map(enc_map).fillna(global_mean)

        summary = {
            'n_numeric':             len(num_cols),
            'n_ohe':                 len(ohe_cols),
            'n_target_enc':          len(te_cols),
            'ohe_cols':              ohe_cols,
            'ohe_new_cols':          ohe_new_cols,
            'te_cols':               te_cols,
            'cardinality_threshold': cardinality_threshold,
            'smoothing':             smoothing,
            'global_mean':           round(global_mean, 4),
            'n_rows':                len(df),
            'n_cols':                len(df.columns),
            'columns':               list(df.columns),
        }
        return df, summary
