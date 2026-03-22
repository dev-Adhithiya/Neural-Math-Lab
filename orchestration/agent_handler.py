"""Agentic model task handling utilities."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from typing import Any, Callable


class InferenceTimeoutError(RuntimeError):
    """Raised when model inference exceeds the configured timeout."""


class AgentHandler:
    """Runs reasoning/planning response generation with timeout control."""

    def __init__(
        self,
        infer_fn: Callable[[Any, Any], str | dict[str, Any]],
        timeout_s: float = 45.0,
    ) -> None:
        self._infer_fn = infer_fn
        self._timeout_s = timeout_s

    def process(self, model: Any, payload: Any) -> dict[str, Any]:
        """Run agent inference and normalize to a stable response schema."""
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self._infer_fn, model, payload)
            try:
                raw = future.result(timeout=self._timeout_s)
            except FutureTimeout as exc:
                future.cancel()
                raise InferenceTimeoutError(
                    f"Agent inference exceeded {self._timeout_s:.1f}s"
                ) from exc

        if isinstance(raw, dict):
            return {
                "response": str(raw.get("response", "")),
                "metadata": dict(raw.get("metadata", {})),
            }

        return {"response": str(raw), "metadata": {}}
