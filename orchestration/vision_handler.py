"""Vision model task handling utilities.

This module is intentionally model-agnostic: it accepts an already-loaded model
instance and inference callable, then enforces timeout and output structure.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass
from typing import Any, Callable


class InferenceTimeoutError(RuntimeError):
    """Raised when model inference exceeds the configured timeout."""


@dataclass
class VisionOutput:
    """Structured output expected by downstream agentic processing."""

    label: str
    text: str
    metadata: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "text": self.text,
            "metadata": self.metadata,
        }


class VisionHandler:
    """Runs image tasks with hard timeout and normalized JSON-style output."""

    def __init__(
        self,
        infer_fn: Callable[[Any, Any], dict[str, Any] | VisionOutput],
        timeout_s: float = 30.0,
    ) -> None:
        self._infer_fn = infer_fn
        self._timeout_s = timeout_s

    def process(self, model: Any, image_input: Any) -> dict[str, Any]:
        """Run vision inference and guarantee structured output."""
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self._infer_fn, model, image_input)
            try:
                raw = future.result(timeout=self._timeout_s)
            except FutureTimeout as exc:
                future.cancel()
                raise InferenceTimeoutError(
                    f"Vision inference exceeded {self._timeout_s:.1f}s"
                ) from exc

        if isinstance(raw, VisionOutput):
            return raw.to_dict()

        if not isinstance(raw, dict):
            return {"label": "UNKNOWN", "text": str(raw), "metadata": {}}

        return {
            "label": str(raw.get("label", "UNKNOWN")),
            "text": str(raw.get("text", "")),
            "metadata": dict(raw.get("metadata", {})),
        }
