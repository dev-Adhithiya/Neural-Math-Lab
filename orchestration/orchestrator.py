"""GPU-efficient multi-model orchestration with lazy load/unload behavior."""

from __future__ import annotations

import gc
import threading
import time
from concurrent.futures import Future
from dataclasses import dataclass
from queue import Queue
from typing import Any, Callable

from .agent_handler import AgentHandler
from .vision_handler import VisionHandler

try:
    import torch
except ImportError:  # pragma: no cover
    torch = None


class GPUUnavailableError(RuntimeError):
    """Raised when GPU is required but unavailable and CPU fallback is disabled."""


class ModelLoadError(RuntimeError):
    """Raised when model loading fails."""


@dataclass
class ModelRuntime:
    name: str
    model: Any
    device: str
    loaded_at: float
    last_used_at: float


class ModelManager:
    """Responsible for model lifecycle and request routing."""

    def __init__(
        self,
        vision_loader: Callable[[str], Any],
        agent_loader: Callable[[str], Any],
        vision_handler: VisionHandler,
        agent_handler: AgentHandler,
        *,
        keep_agent_loaded: bool = False,
        cache_ttl_s: float = 0.0,
        allow_cpu_fallback: bool = True,
    ) -> None:
        self._loaders: dict[str, Callable[[str], Any]] = {
            "vision": vision_loader,
            "agent": agent_loader,
        }
        self._vision_handler = vision_handler
        self._agent_handler = agent_handler
        self._keep_agent_loaded = keep_agent_loaded
        self._cache_ttl_s = max(0.0, cache_ttl_s)
        self._allow_cpu_fallback = allow_cpu_fallback

        self._loaded: dict[str, ModelRuntime] = {}
        self._evict_timers: dict[str, threading.Timer] = {}
        self._active_gpu_model: str | None = None
        self._lock = threading.RLock()

    def _gpu_available(self) -> bool:
        return bool(torch and torch.cuda.is_available())

    def _resolve_device(self) -> str:
        if self._gpu_available():
            return "cuda"
        if self._allow_cpu_fallback:
            return "cpu"
        raise GPUUnavailableError("GPU unavailable and CPU fallback disabled")

    def _schedule_eviction(self, model_name: str) -> None:
        if self._cache_ttl_s <= 0:
            return
        existing = self._evict_timers.pop(model_name, None)
        if existing:
            existing.cancel()

        timer = threading.Timer(self._cache_ttl_s, self.unload_model, args=(model_name,))
        timer.daemon = True
        self._evict_timers[model_name] = timer
        timer.start()

    def _clear_gpu_memory(self) -> None:
        gc.collect()
        if torch and torch.cuda.is_available():
            torch.cuda.empty_cache()
            try:
                torch.cuda.ipc_collect()
            except Exception:
                pass

    def load_model(self, model_name: str) -> Any:
        """Lazy load a model while enforcing single-model GPU occupancy."""
        if model_name not in self._loaders:
            raise KeyError(f"Unknown model_name: {model_name}")

        with self._lock:
            runtime = self._loaded.get(model_name)
            if runtime:
                runtime.last_used_at = time.time()
                self._schedule_eviction(model_name)
                return runtime.model

            device = self._resolve_device()

            if device == "cuda" and self._active_gpu_model and self._active_gpu_model != model_name:
                self.unload_model(self._active_gpu_model)

            loader = self._loaders[model_name]
            try:
                model = loader(device)
            except Exception as exc:
                raise ModelLoadError(f"Failed to load {model_name} model on {device}: {exc}") from exc

            now = time.time()
            self._loaded[model_name] = ModelRuntime(
                name=model_name,
                model=model,
                device=device,
                loaded_at=now,
                last_used_at=now,
            )
            if device == "cuda":
                self._active_gpu_model = model_name
            self._schedule_eviction(model_name)
            return model

    def unload_model(self, model_name: str) -> None:
        """Unload model and aggressively clear references/caches."""
        with self._lock:
            timer = self._evict_timers.pop(model_name, None)
            if timer:
                timer.cancel()

            runtime = self._loaded.pop(model_name, None)
            if not runtime:
                return

            model = runtime.model
            try:
                close_fn = getattr(model, "close", None)
                if callable(close_fn):
                    close_fn()
                to_cpu = getattr(model, "to", None)
                if callable(to_cpu):
                    try:
                        to_cpu("cpu")
                    except Exception:
                        pass
            finally:
                runtime.model = None
                del model

            if self._active_gpu_model == model_name:
                self._active_gpu_model = None

            self._clear_gpu_memory()

    def route_request(self, input_type: str) -> Callable[[Any], dict[str, Any]]:
        """Return the processing function for a request type."""
        normalized = input_type.strip().lower()
        if normalized == "image":
            return self._process_image_request
        if normalized == "text":
            return self._process_text_request
        raise ValueError(f"Unsupported input_type: {input_type}")

    def _process_image_request(self, request_payload: dict[str, Any]) -> dict[str, Any]:
        image_input = request_payload.get("image")
        if image_input is None:
            raise ValueError("Image request missing 'image' field")

        vision_model = self.load_model("vision")
        try:
            vision_output = self._vision_handler.process(vision_model, image_input)
        finally:
            self.unload_model("vision")

        agent_model = self.load_model("agent")
        try:
            agent_output = self._agent_handler.process(agent_model, vision_output)
        finally:
            if not self._keep_agent_loaded:
                self.unload_model("agent")
            else:
                self._schedule_eviction("agent")

        return {
            "input_type": "image",
            "vision_output": vision_output,
            "agent_output": agent_output,
        }

    def _process_text_request(self, request_payload: dict[str, Any]) -> dict[str, Any]:
        text = request_payload.get("text")
        if text is None:
            raise ValueError("Text request missing 'text' field")

        agent_model = self.load_model("agent")
        try:
            agent_output = self._agent_handler.process(agent_model, {"text": text})
        finally:
            if not self._keep_agent_loaded:
                self.unload_model("agent")
            else:
                self._schedule_eviction("agent")

        return {
            "input_type": "text",
            "agent_output": agent_output,
        }


class Orchestrator:
    """Queue-backed orchestrator to handle rapid requests safely."""

    def __init__(self, manager: ModelManager, debounce_ms: int = 120) -> None:
        self._manager = manager
        self._debounce_s = max(0, debounce_ms) / 1000.0
        self._queue: Queue[tuple[str, dict[str, Any], Future]] = Queue()
        self._latest_image_by_session: dict[str, tuple[dict[str, Any], Future]] = {}
        self._last_image_submit_at: dict[str, float] = {}
        self._stop_event = threading.Event()
        self._worker = threading.Thread(target=self._worker_loop, daemon=True)
        self._worker.start()

    def submit(self, input_type: str, payload: dict[str, Any], session_id: str = "default") -> Future:
        future: Future = Future()
        normalized = input_type.strip().lower()

        if normalized == "image":
            now = time.monotonic()
            last = self._last_image_submit_at.get(session_id, 0.0)
            self._last_image_submit_at[session_id] = now

            # Debounce burst uploads from the same session and keep only the latest image.
            if now - last < self._debounce_s:
                previous = self._latest_image_by_session.get(session_id)
                if previous:
                    prev_payload, prev_future = previous
                    if not prev_future.done():
                        prev_future.set_exception(RuntimeError("Dropped by debounce: superseded image request"))
                self._latest_image_by_session[session_id] = (payload, future)
                return future

            latest = self._latest_image_by_session.pop(session_id, None)
            if latest:
                payload, future = latest

        self._queue.put((normalized, payload, future))
        return future

    def flush_debounced_images(self) -> None:
        """Move debounced image requests into the processing queue."""
        for session_id, (payload, future) in list(self._latest_image_by_session.items()):
            if not future.done():
                self._queue.put(("image", payload, future))
            self._latest_image_by_session.pop(session_id, None)

    def shutdown(self) -> None:
        self._stop_event.set()
        self.flush_debounced_images()
        self._queue.put(("text", {"text": "__shutdown__"}, Future()))
        self._worker.join(timeout=2.0)
        self._manager.unload_model("vision")
        self._manager.unload_model("agent")

    def _worker_loop(self) -> None:
        while not self._stop_event.is_set():
            input_type, payload, future = self._queue.get()
            if self._stop_event.is_set():
                break

            try:
                processor = self._manager.route_request(input_type)
                result = processor(payload)
                if not future.done():
                    future.set_result(result)
            except Exception as exc:
                if not future.done():
                    future.set_exception(exc)
