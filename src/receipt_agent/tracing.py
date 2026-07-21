"""Langfuse tracing singleton."""

from dotenv import load_dotenv
from langfuse import Langfuse

_langfuse: Langfuse | None = None


def get_langfuse() -> Langfuse:
    global _langfuse
    if _langfuse is None:
        load_dotenv()
        _langfuse = Langfuse()
    return _langfuse
