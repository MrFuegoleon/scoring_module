import uuid
import pandas as pd
from threading import Lock


class SessionStore:
    """
    Stockage en mémoire des dataframes de nettoyage, indexés par session_id.
    Thread-safe via un verrou.

    Cycle de vie :
        1. create(df)    → session_id  (upload initial)
        2. get(sid)      → df (copie)  (lectures par les étapes)
        3. update(sid, df)             (après chaque étape de transformation)
        4. delete(sid)                 (fin de session ou reset)
    """

    _store: dict[str, pd.DataFrame] = {}
    _lock = Lock()

    @classmethod
    def create(cls, df: pd.DataFrame) -> str:
        sid = uuid.uuid4().hex[:12]
        with cls._lock:
            cls._store[sid] = df.copy()
        return sid

    @classmethod
    def get(cls, sid: str) -> pd.DataFrame | None:
        with cls._lock:
            df = cls._store.get(sid)
            return df.copy() if df is not None else None

    @classmethod
    def update(cls, sid: str, df: pd.DataFrame) -> None:
        with cls._lock:
            if sid not in cls._store:
                raise KeyError(f"Session inconnue : {sid}")
            cls._store[sid] = df.copy()

    @classmethod
    def delete(cls, sid: str) -> None:
        with cls._lock:
            cls._store.pop(sid, None)

    @classmethod
    def exists(cls, sid: str) -> bool:
        with cls._lock:
            return sid in cls._store
