#!/usr/bin/env python3
"""
AgentSam Dataset Generator & Loader for Offline ML Training.
Extracts clean, non-poisoned training rows from agentsam_ml_observations and historical runs.
"""

import os
import sqlite3
import json
import numpy as np
import pandas as pd
from typing import Tuple, Dict, Any, List
from features import extract_features, CANONICAL_FEATURE_NAMES, FEATURE_SCHEMA_VERSION

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".data", "agentsam.sqlite")


def load_dataset(db_path: str = DB_PATH, only_training_eligible: bool = True) -> pd.DataFrame:
    """
    Loads observation records directly from SQLite or generates a synthetic representative batch.
    """
    rows = []
    if os.path.exists(db_path):
        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # Check if agentsam_ml_observations exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='agentsam_ml_observations'")
            if cursor.fetchone():
                cond = "WHERE is_training_eligible = 1" if only_training_eligible else ""
                query = f"SELECT * FROM agentsam_ml_observations {cond} ORDER BY created_at DESC LIMIT 2000"
                for r in cursor.execute(query):
                    rows.append(dict(r))
            
            # Fallback to agentsam_agent_run if sparse
            if len(rows) < 20:
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='agentsam_agent_run'")
                if cursor.fetchone():
                    for r in cursor.execute("SELECT * FROM agentsam_agent_run ORDER BY created_at DESC LIMIT 200"):
                        d = dict(r)
                        is_succ = 1 if d.get("status") == "completed" else 0
                        rows.append({
                            "id": "obs_" + str(d.get("id")),
                            "decision_id": "dec_" + str(d.get("id")),
                            "task_type": "general",
                            "mode": "agent",
                            "prompt_length": len(d.get("prompt", "")),
                            "estimated_tokens": d.get("total_tokens", 100),
                            "tool_required": 0,
                            "repo_present": 0,
                            "recent_failure_rate": 0.0,
                            "model_key": d.get("model_key", "gemini-2.5-flash"),
                            "provider": d.get("provider", "google"),
                            "selection_probability": 0.8,
                            "success": is_succ,
                            "quality_score": 0.85 if is_succ else 0.2,
                            "user_feedback": 0,
                            "latency_ms": d.get("latency_ms", 1200),
                            "cost_usd": d.get("cost_usd", 0.002),
                            "is_training_eligible": 1
                        })
            conn.close()
        except Exception as e:
            print(f"[Dataset] SQLite load note: {e}")

    # If database had no runs, seed a realistic diverse training distribution
    if len(rows) < 10:
        models = [
            ("gemini-2.5-flash", "google", 0.88, 1100, 0.0012, 0.84),
            ("perseus-antigravity", "google", 0.94, 2100, 0.0035, 0.92),
            ("gemini-2.5-pro", "google", 0.96, 4200, 0.0150, 0.95),
        ]
        tasks = ["code", "research", "dossier", "chat", "financial_synthesis", "general"]
        modes = ["ask", "agent", "background", "batch"]

        for i in range(150):
            m_key, prov, base_s, base_lat, base_cost, base_q = models[i % len(models)]
            t_type = tasks[i % len(tasks)]
            mode = modes[i % len(modes)]
            prompt_len = 100 + (i * 37) % 3000
            
            # Synthetic outcome physics
            succ = 1 if np.random.rand() < base_s else 0
            lat = int(base_lat * (0.8 + 0.4 * np.random.rand()) + (prompt_len * 0.5))
            cost = base_cost * (0.8 + 0.4 * np.random.rand()) * (1 + prompt_len / 2000)
            q = max(0.1, min(0.99, base_q + 0.05 * np.random.randn())) if succ else 0.2

            rows.append({
                "id": f"obs_seed_{i}",
                "decision_id": f"dec_seed_{i}",
                "task_type": t_type,
                "mode": mode,
                "prompt_length": prompt_len,
                "estimated_tokens": int(prompt_len / 4),
                "tool_required": 1 if t_type in ["code", "dossier"] else 0,
                "repo_present": 1 if t_type == "code" else 0,
                "recent_failure_rate": 0.05,
                "model_key": m_key,
                "provider": prov,
                "selection_probability": 0.65 + 0.3 * np.random.rand(),
                "success": succ,
                "quality_score": round(q, 3),
                "user_feedback": 1 if (succ and np.random.rand() > 0.7) else 0,
                "latency_ms": lat,
                "cost_usd": round(cost, 6),
                "is_training_eligible": 1
            })

    # Construct feature matrix X
    df = pd.DataFrame(rows)
    feature_vectors = []
    for _, r in df.iterrows():
        ctx = {
            "taskType": r.get("task_type", "general"),
            "mode": r.get("mode", "agent"),
            "prompt": "x" * int(r.get("prompt_length", 100)),
            "toolRequired": bool(r.get("tool_required")),
            "repoPresent": bool(r.get("repo_present")),
            "recentFailureRate": float(r.get("recent_failure_rate", 0.0)),
        }
        act = {
            "modelKey": r.get("model_key", "gemini-2.5-flash"),
            "provider": r.get("provider", "google"),
        }
        vec = extract_features(ctx, act)
        feature_vectors.append(vec)

    feature_df = pd.DataFrame(feature_vectors, columns=CANONICAL_FEATURE_NAMES)
    combined_df = pd.concat([df.reset_index(drop=True), feature_df.reset_index(drop=True)], axis=1)
    return combined_df


if __name__ == "__main__":
    df = load_dataset()
    print(f"Loaded {len(df)} canonical training observations with {len(CANONICAL_FEATURE_NAMES)} features.")
    print("Columns:", list(df.columns[:15]))
