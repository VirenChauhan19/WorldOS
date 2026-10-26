"""Provider boundaries. No guessed URLs, SDKs, tokens, or AI claims."""
import re
from typing import Protocol

from .models import PlanningConstraints, ReasonRequest, SceneObject


class SegmentationAdapter(Protocol):
    async def segment(self, image: dict, concept: str) -> list[SceneObject]: ...


class ReasoningAdapter(Protocol):
    async def interpret(self, request: ReasonRequest) -> PlanningConstraints: ...


class ManualSegmentation:
    def segment(self, image_bytes: bytes) -> list[SceneObject]:
        return []  # An empty list explicitly requires manual annotation.


class RuleBasedReasoning:
    """Conservative label matching. UI locks remain the explicit source of truth."""
    def locked_ids(self, goal: str, objects: list[SceneObject]) -> set[str]:
        locked = {obj.id for obj in objects if obj.locked}
        # Every supported clause protects all matching labels until punctuation.
        clauses = re.findall(
            r"(?:without\s+moving|do\s+not\s+move|don't\s+move|keep|leave|avoid\s+moving)\s+([^.!?;\n]+)",
            goal.casefold(),
        )
        for obj in objects:
            label = obj.label.casefold().strip()
            if any(re.search(r"(?<!\w)" + re.escape(label) + r"(?!\w)", clause) for clause in clauses):
                locked.add(obj.id)
        return locked


# Public provider adapters now live separately from local rules.
from .ai_adapters import MuseSparkReasoning, SAM31Segmentation  # noqa: E402,F401
