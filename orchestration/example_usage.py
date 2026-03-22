"""Minimal runnable example for the multi-model orchestrator.

Replace the demo loader/inference functions with your actual model code.
"""

from __future__ import annotations

import time
from typing import Any

from .agent_handler import AgentHandler
from .orchestrator import ModelManager, Orchestrator
from .vision_handler import VisionHandler


class DemoModel:
    def __init__(self, name: str, device: str) -> None:
        self.name = name
        self.device = device

    def to(self, device: str) -> "DemoModel":
        self.device = device
        return self

    def close(self) -> None:
        pass


def load_vision_model(device: str) -> DemoModel:
    time.sleep(0.05)
    return DemoModel("vision", device)


def load_agent_model(device: str) -> DemoModel:
    time.sleep(0.05)
    return DemoModel("agent", device)


def run_vision_inference(model: DemoModel, image_input: Any) -> dict[str, Any]:
    del image_input
    return {
        "label": "TYPE_DOUBT",
        "text": "Solve 2x + 3 = 11",
        "metadata": {"model": model.name, "device": model.device},
    }


def run_agent_inference(model: DemoModel, payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict) and payload.get("text"):
        question = payload["text"]
    else:
        question = str(payload)
    return {
        "response": f"Let's isolate x step by step. Starting from: {question}",
        "metadata": {"model": model.name, "device": model.device},
    }


def build_orchestrator() -> Orchestrator:
    manager = ModelManager(
        vision_loader=load_vision_model,
        agent_loader=load_agent_model,
        vision_handler=VisionHandler(run_vision_inference, timeout_s=20),
        agent_handler=AgentHandler(run_agent_inference, timeout_s=30),
        keep_agent_loaded=False,
        cache_ttl_s=15,
        allow_cpu_fallback=True,
    )
    return Orchestrator(manager=manager, debounce_ms=120)


if __name__ == "__main__":
    orchestrator = build_orchestrator()
    try:
        image_future = orchestrator.submit("image", {"image": b"fake-bytes"})
        print("Image route result:", image_future.result(timeout=10))

        text_future = orchestrator.submit("text", {"text": "How to factor x^2 - 5x + 6?"})
        print("Text route result:", text_future.result(timeout=10))
    finally:
        orchestrator.shutdown()
