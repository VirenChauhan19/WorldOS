"""Strict contracts for reusable visual inspection, independent of desk tasks."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .models import Box, SceneObject
from .planner import contains, overlaps


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class TemplateObject(SceneObject):
    required: bool = True
    tolerance: float = Field(default=.025, ge=.005, le=.1)


class ReferenceAnalysis(StrictModel):
    objects: list[SceneObject] = Field(max_length=12)
    concepts: list[str] = Field(max_length=12)
    summary: str
    message: str
    warnings: list[str]
    provider: str
    model: str
    annotation_source: str = "sam_3_1"
    image_width: int | None = None
    image_height: int | None = None
    concept_latency_ms: dict[str, int] = Field(default_factory=dict)
    inferred_at: str | None = None
    inference_cache: dict | None = None


class TemplateInput(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    location: str = Field(default="", max_length=200)
    reference_image_url: str = Field(max_length=18_000_000)
    objects: list[TemplateObject] = Field(min_length=1, max_length=12)
    workspace: Box = Field(default_factory=lambda: Box(x=.03, y=.03, width=.94, height=.94))
    clearance: float = Field(default=.005, ge=0, le=.03)
    annotations_reviewed: bool = False
    revision: int | None = Field(default=None, ge=1)
    reference_analysis: ReferenceAnalysis | None = None
    reference_inference_wall_ms: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def review_scene(self):
        if not self.name.strip() or not self.annotations_reviewed:
            raise ValueError("Name the workspace and confirm all reference annotations before saving.")
        if len({o.id for o in self.objects}) != len(self.objects):
            raise ValueError("Reference identities must be unique.")
        for i, obj in enumerate(self.objects):
            if not obj.label.strip() or not contains(self.workspace, obj.box):
                raise ValueError("Label every reference object and keep its box within the workspace.")
            if any(overlaps(obj.box, other.box, self.clearance) for other in self.objects[:i]):
                raise ValueError("Reference footprints need non-overlapping boxes and the selected clearance.")
        return self


class Alignment(StrictModel):
    # Current image -> reference frame. Translation is relative to reference axes;
    # scale is isotropic in pixels; rotation is clockwise in screen coordinates.
    tx: float = Field(default=0, ge=-.5, le=.5)
    ty: float = Field(default=0, ge=-.5, le=.5)
    scale: float = Field(default=1, ge=.5, le=2)
    rotation: float = Field(default=0, ge=-30, le=30)
    confirmed: bool = False


class AlignmentRequest(StrictModel):
    template_id: str
    image_url: str = Field(max_length=18_000_000)
    alignment: Alignment = Field(default_factory=Alignment)
    automatic: bool = False
    previous_inspection_id: str | None = None
    evaluation_trial_id: str | None = None


class InspectionInput(StrictModel):
    template_id: str
    template_revision: int = Field(ge=1)
    image_url: str = Field(max_length=18_000_000)
    alignment: Alignment
    inventory_confirmed: bool = False
    discover_unexpected: bool = True
    extra_concepts: list[str] = Field(default_factory=list, max_length=12)
    previous_inspection_id: str | None = None
    evaluation_capture_id: str | None = None


class InspectionReview(StrictModel):
    # Only entries explicitly reviewed by the user belong here. None requires
    # a separate absence confirmation; it must not silently erase an identity.
    assignments: dict[str, str | None] = Field(default_factory=dict, max_length=12)
    confirmed_missing_ids: list[str] = Field(default_factory=list, max_length=12)
    manual_objects: list[SceneObject] = Field(default_factory=list, max_length=12)
    ignored_detection_ids: list[str] = Field(default_factory=list, max_length=24)
    inventory_confirmed: bool
    revision: int = Field(ge=1)


class RecordAction(StrictModel):
    revision: int = Field(ge=1)


class InspectionExplanation(StrictModel):
    summary: str = Field(min_length=1, max_length=2000)
    findings: list["InspectionFinding"] = Field(max_length=24)


class InspectionFinding(StrictModel):
    object_id: str
    explanation: str = Field(min_length=1, max_length=1000)
    next_step: str = Field(min_length=1, max_length=1000)
