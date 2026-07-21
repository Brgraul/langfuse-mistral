"""Environment + client wiring (Person A — infra).

Loads .env and constructs the Mistral and Langfuse clients. Langfuse is optional:
if keys are absent we return a no-op shim so the pipeline still runs offline.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Optional

from dotenv import load_dotenv

load_dotenv()


def get_env(name: str, default: Optional[str] = None) -> Optional[str]:
    val = os.getenv(name, default)
    return val.strip() if isinstance(val, str) else val


@lru_cache(maxsize=1)
def mistral_client():
    """Return a configured Mistral client, or raise if no key."""
    from mistralai.client import Mistral

    api_key = get_env("MISTRAL_API_KEY")
    if not api_key:
        raise RuntimeError(
            "MISTRAL_API_KEY not set. Copy .env.example to .env and fill it in, "
            "or run OCR with --mock."
        )
    return Mistral(api_key=api_key)


@lru_cache(maxsize=1)
def langfuse_client():
    """Return a Langfuse client if configured, else a no-op shim.

    The shim implements the subset of the context-manager API we use so callers
    never need to branch on whether tracing is enabled.
    """
    pub = get_env("LANGFUSE_PUBLIC_KEY")
    sec = get_env("LANGFUSE_SECRET_KEY")
    host = get_env("LANGFUSE_HOST", "https://cloud.langfuse.com")

    if not (pub and sec):
        return _NoopLangfuse()

    from langfuse import Langfuse

    return Langfuse(public_key=pub, secret_key=sec, host=host)


# --------------------------------------------------------------------------- #
# No-op tracing shim
# --------------------------------------------------------------------------- #
class _NoopSpan:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def update(self, **kwargs):
        pass

    def update_trace(self, **kwargs):
        pass

    def score(self, **kwargs):
        pass

    def score_trace(self, **kwargs):
        pass

    def start_as_current_observation(self, **kwargs):
        return _NoopSpan()

    def start_as_current_generation(self, **kwargs):
        return _NoopSpan()


class _NoopLangfuse:
    """Stands in for the Langfuse client when keys are absent."""

    enabled = False

    def start_as_current_observation(self, **kwargs):
        return _NoopSpan()

    def score_current_trace(self, **kwargs):
        pass

    def update_current_trace(self, **kwargs):
        pass

    def flush(self):
        pass
