"""Production adapter for the Opponent Intelligence Engine.

The Coach imports THIS package, never the research modules directly. The
boundary is the point: `server/ml/` may be rebuilt, retrained or replaced
without the Coach knowing, as long as `predict()` keeps returning a
PredictionResult.
"""
