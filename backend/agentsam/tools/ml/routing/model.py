#!/usr/bin/env python3
"""
AgentSam Policy Model Definitions (scikit-learn implementation).
Supports multi-head training: P(Success), Quality, Latency, Cost.
Exports calibrated weights to pure JSON for zero-overhead Edge Worker inference.
"""

import json
import numpy as np
from typing import Dict, Any, List
from sklearn.linear_model import LogisticRegression, Ridge
from features import CANONICAL_FEATURE_NAMES, FEATURE_SCHEMA_VERSION


class AgentSamPolicyModel:
    def __init__(self, version: str = "v1.0_trained"):
        self.version = version
        self.schema_version = FEATURE_SCHEMA_VERSION
        self.feature_names = CANONICAL_FEATURE_NAMES
        self.feature_dim = len(CANONICAL_FEATURE_NAMES)
        
        # Regression heads
        self.success_model = LogisticRegression(C=1.0, max_iter=500, solver="lbfgs")
        self.quality_model = Ridge(alpha=1.0)
        self.latency_model = Ridge(alpha=1.0)
        self.cost_model = Ridge(alpha=1.0)
        self.is_fitted = False

    def fit(self, X: np.ndarray, y_success: np.ndarray, y_quality: np.ndarray, y_latency: np.ndarray, y_cost: np.ndarray):
        """
        Fits all 4 heads simultaneously.
        """
        # P(Success) logistic head
        self.success_model.fit(X, y_success)
        
        # Quality head
        self.quality_model.fit(X, y_quality)
        
        # Latency head in log-space
        y_lat_log = np.log(np.maximum(100.0, y_latency))
        self.latency_model.fit(X, y_lat_log)
        
        # Cost head in log-space
        y_cost_log = np.log(np.maximum(0.00001, y_cost))
        self.cost_model.fit(X, y_cost_log)
        
        self.is_fitted = True

    def export_weights_dict(self) -> Dict[str, Any]:
        """
        Exports the learned parameters as lightweight JSON dict.
        """
        if not self.is_fitted:
            raise RuntimeError("Model must be fitted before exporting weights.")

        return {
            "version": self.version,
            "featureSchemaVersion": self.schema_version,
            "featureDim": self.feature_dim,
            "success": {
                "bias": round(float(self.success_model.intercept_[0]), 4),
                "weights": [round(float(w), 4) for w in self.success_model.coef_[0]]
            },
            "quality": {
                "bias": round(float(self.quality_model.intercept_), 4),
                "weights": [round(float(w), 4) for w in self.quality_model.coef_]
            },
            "latency": {
                "bias": round(float(self.latency_model.intercept_), 4),
                "weights": [round(float(w), 4) for w in self.latency_model.coef_]
            },
            "cost": {
                "bias": round(float(self.cost_model.intercept_), 4),
                "weights": [round(float(w), 4) for w in self.cost_model.coef_]
            }
        }
