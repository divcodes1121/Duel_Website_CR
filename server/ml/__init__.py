"""Opponent Intelligence Engine.

PHASE 1 ONLY: dataset + evaluation harness. There is no model here yet, and
that is deliberate — the benchmark this package produces is what decides which
models are worth building. Nothing in `server/ml` is imported by any production
module; the engine ships dark until a measured result says otherwise.
"""
