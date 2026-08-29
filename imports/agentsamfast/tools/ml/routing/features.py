#!/usr/bin/env python3
"""
AgentSam Canonical Feature Engineering.
Maintains exact parity with TypeScript FeatureExtractor (schema v1.0).
"""

import math
from typing import Dict, Any, List, Tuple

FEATURE_SCHEMA_VERSION = "v1.0"

CANONICAL_FEATURE_NAMES = [
    # 0..5: Task Type One-Hot
    "is_task_code",
    "is_task_research",
    "is_task_dossier",
    "is_task_chat",
    "is_task_financial_synthesis",
    "is_task_general",

    # 6..9: Execution Mode One-Hot
    "is_mode_ask",
    "is_mode_agent",
    "is_mode_background",
    "is_mode_batch",

    # 10..13: Prompt & Context Dimensions (Normalized)
    "norm_prompt_chars",
    "norm_estimated_tokens",
    "norm_tool_count",
    "tool_required_flag",

    # 14..17: Repo Intelligence Features
    "repo_present_flag",
    "norm_repo_files",
    "is_repo_typescript",
    "is_repo_dirty",

    # 18..20: Prior Performance & Reliability
    "recent_failure_rate",
    "historical_task_success",
    "task_complexity_score",

    # 21..23: Model Action Parameters (Normalized)
    "model_cost_tier",
    "model_supports_tools",
    "model_reasoning_effort",
]


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, math.ceil(len(text) / 4))


def compute_complexity(prompt: str, repo_files: int = 0, tools_count: int = 0) -> float:
    score = 0.2
    lower = prompt.lower() if prompt else ""

    length = len(prompt) if prompt else 0
    if length > 3000:
        score += 0.3
    elif length > 800:
        score += 0.2
    elif length > 200:
        score += 0.1

    complex_keywords = [
        "migrate", "refactor", "architect", "synthesize", "comprehensive",
        "forensic", "investigate", "multi-step", "security", "dossier", "10-k", "10-q"
    ]
    matches = sum(1 for kw in complex_keywords if kw in lower)
    score += min(0.3, matches * 0.08)

    if repo_files > 100:
        score += 0.15
    elif repo_files > 20:
        score += 0.08

    if tools_count > 3:
        score += 0.1

    return min(1.0, max(0.05, score))


def extract_features(context: Dict[str, Any], action: Dict[str, Any] = None) -> List[float]:
    task = str(context.get("taskType", "general")).lower()
    mode = str(context.get("mode", "agent")).lower()
    prompt = str(context.get("prompt", ""))
    prompt_len = len(prompt)
    tokens = estimate_tokens(prompt)
    tools_count = len(context.get("toolsRequested", [])) or (1 if context.get("toolRequired") else 0)
    repo_files = int(context.get("repoFilesCount", 0))
    complexity = compute_complexity(prompt, repo_files, tools_count)

    vec = [0.0] * len(CANONICAL_FEATURE_NAMES)

    # Task One-Hot (0..5)
    if "code" in task or "dev" in task:
        vec[0] = 1.0
    elif "research" in task or "investigat" in task:
        vec[1] = 1.0
    elif "dossier" in task or "sec" in task or "filing" in task:
        vec[2] = 1.0
    elif "chat" in task or "convers" in task:
        vec[3] = 1.0
    elif "financial" in task or "synth" in task:
        vec[4] = 1.0
    else:
        vec[5] = 1.0

    # Mode One-Hot (6..9)
    if mode == "ask":
        vec[6] = 1.0
    elif mode == "agent":
        vec[7] = 1.0
    elif mode == "background":
        vec[8] = 1.0
    elif mode == "batch":
        vec[9] = 1.0

    # Prompt Dimensions (10..13)
    vec[10] = min(1.0, math.log1p(prompt_len) / 10.0)
    vec[11] = min(1.0, math.log1p(tokens) / 10.0)
    vec[12] = min(1.0, tools_count / 10.0)
    vec[13] = 1.0 if (context.get("toolRequired") or tools_count > 0) else 0.0

    # Repo Intelligence (14..17)
    vec[14] = 1.0 if (context.get("repoPresent") or repo_files > 0) else 0.0
    vec[15] = min(1.0, math.log1p(repo_files) / 10.0)
    repo_lang = str(context.get("repoLanguage", "")).lower()
    vec[16] = 1.0 if ("typescript" in repo_lang or "javascript" in repo_lang) else 0.0
    vec[17] = 1.0 if context.get("repoDirty") else 0.0

    # Priors (18..20)
    vec[18] = max(0.0, min(1.0, float(context.get("recentFailureRate", 0.0))))
    vec[19] = max(0.0, min(1.0, float(context.get("historicalTaskSuccessRate", 0.85))))
    vec[20] = complexity

    # Action Parameters (21..23)
    if action:
        model_lower = str(action.get("modelKey", "")).lower()
        if any(k in model_lower for k in ["pro", "sonnet", "opus", "gpt-4o"]):
            cost_tier = 0.9
        elif any(k in model_lower for k in ["perseus", "antigravity", "haiku"]):
            cost_tier = 0.5
        else:
            cost_tier = 0.15
        vec[21] = cost_tier
        vec[22] = 1.0 if action.get("supportsTools", True) else 0.0

        effort = str(action.get("reasoningEffort", "medium")).lower()
        if effort == "low":
            vec[23] = 0.3
        elif effort == "high":
            vec[23] = 1.0
        else:
            vec[23] = 0.6
    else:
        vec[21] = 0.4
        vec[22] = 1.0
        vec[23] = 0.6

    return vec
