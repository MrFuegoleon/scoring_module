import numpy as np
from scipy.stats import gaussian_kde


def safe_kde(data: np.ndarray, x: np.ndarray) -> np.ndarray:
    try:
        return gaussian_kde(data)(x)
    except np.linalg.LinAlgError:
        rng = np.random.default_rng(42)
        jittered = np.clip(data + rng.normal(0, 1e-4, size=len(data)), 0, 1)
        return gaussian_kde(jittered)(x)


def roc_sample(fpr, tpr, n: int = 100) -> dict:
    idx = np.linspace(0, len(fpr) - 1, min(n, len(fpr))).astype(int)
    return {
        'fpr': [round(float(fpr[i]), 4) for i in idx],
        'tpr': [round(float(tpr[i]), 4) for i in idx],
    }
