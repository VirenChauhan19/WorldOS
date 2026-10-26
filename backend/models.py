from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Box(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def within_image(self):
        if self.x + self.width > 1.00000001 or self.y + self.height > 1.00000001:
            raise ValueError("Bounding boxes must stay inside the normalized image.")
        return self


class SceneObject(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=80)
    box: Box
    locked: bool = False
    source: Literal["manual", "sam_3_1", "ai_corrected"] = "manual"
    confidence: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)


class PlanningConstraints(BaseModel):
    """Only currently supported constraints can reach the deterministic planner."""
    model_config = ConfigDict(extra="forbid")
    protected_object_ids: list[str] = Field(max_length=12)
    summary: str = Field(min_length=1, max_length=1000)
    unsupported_requirements: list[str] = Field(max_length=12)
    needs_clarification: bool


class ReasonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    objects: list[SceneObject] = Field(min_length=1, max_length=12)
    goal: str = Field(min_length=1, max_length=1000)
    image_url: str | None = Field(default=None, max_length=18_000_000)
    target: Box | None = None


class AIAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    image_url: str = Field(max_length=18_000_000)
    # One noun phrase per entry. Empty means ask Muse Spark to discover concepts.
    concepts: list[str] = Field(default_factory=list, max_length=12)


class PlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    objects: list[SceneObject] = Field(min_length=1, max_length=12)
    target: Box
    workspace: Box = Field(default_factory=lambda: Box(x=0, y=0, width=1, height=1))
    goal: str = Field(min_length=1, max_length=1000)
    clearance: float = Field(default=0.008, ge=0, le=0.05)
    constraints: PlanningConstraints | None = None

    @model_validator(mode="after")
    def unique_ids(self):
        if len({obj.id for obj in self.objects}) != len(self.objects):
            raise ValueError("Object IDs must be unique.")
        if self.constraints:
            if not set(self.constraints.protected_object_ids) <= {obj.id for obj in self.objects}:
                raise ValueError("Constraints reference unknown object IDs.")
            if self.constraints.needs_clarification or self.constraints.unsupported_requirements:
                raise ValueError("Resolve unsupported or unclear goal requirements before planning, or explicitly return to manual mode.")
        return self


class Movement(BaseModel):
    number: int
    object_id: str
    label: str
    source: Box
    destination: Box
    instruction: str


class PlanResponse(BaseModel):
    status: Literal["ready", "already_clear", "impossible", "search_limit"]
    message: str
    movements: list[Movement] = Field(default_factory=list)
    final_objects: list[SceneObject]
    locked_ids: list[str]
    warnings: list[str] = Field(default_factory=list)
    explored_states: int = 0
    reasoning_source: str = "deterministic_rules"


class VerifyRequest(BaseModel):
    plan_request: PlanRequest
    observed_objects: list[SceneObject] = Field(min_length=1, max_length=12)
    tolerance: float = Field(default=0.025, ge=0.001, le=0.1)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({obj.id for obj in self.observed_objects}) != len(self.observed_objects):
            raise ValueError("Observed object IDs must be unique.")
        return self
