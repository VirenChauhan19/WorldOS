"""Contracts for goal-driven workspace coaching; progress is user-reported."""
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool


class MissionModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class MissionCreate(MissionModel):
    id: UUID
    goal: str = Field(min_length=3, max_length=500)
    constraints: str = Field(default='', max_length=600)
    image_url: str = Field(min_length=1, max_length=8_500_000)
    routine_id: str | None = Field(default=None, max_length=80)


class MissionRevision(MissionModel):
    revision: int = Field(ge=1)


class MissionObserve(MissionRevision):
    image_url: str | None = Field(default=None, max_length=8_500_000)


class MissionPlanning(MissionRevision):
    protected_ids: list[str] = Field(default_factory=list, max_length=12)
    feedback: str = Field(default='', max_length=600)


class MissionStep(MissionModel):
    title: str = Field(min_length=1, max_length=100)
    instruction: str = Field(min_length=1, max_length=500)
    why: str = Field(min_length=1, max_length=350)
    success_check: str = Field(min_length=1, max_length=300)
    object_ids: list[str] = Field(max_length=12)
    move_ids: list[str] = Field(max_length=12)


class MissionPlan(MissionModel):
    title: str = Field(min_length=1, max_length=100)
    outcome: str = Field(min_length=1, max_length=450)
    steps: list[MissionStep] = Field(min_length=1, max_length=6)
    limitation: str = Field(max_length=500)


class MissionProgress(MissionRevision):
    step_id: str = Field(min_length=1, max_length=80)
    done: StrictBool


class MissionCheck(MissionRevision):
    image_url: str = Field(min_length=1, max_length=8_500_000)


class StepAssessment(MissionModel):
    step_id: str = Field(min_length=1, max_length=80)
    status: Literal['looks_done', 'needs_attention', 'uncertain']
    evidence: str = Field(min_length=1, max_length=450)


class MissionAssessment(MissionModel):
    comparable: StrictBool
    summary: str = Field(min_length=1, max_length=800)
    steps: list[StepAssessment] = Field(min_length=1, max_length=6)
    next_step: str = Field(min_length=1, max_length=500)


class RoutineSave(MissionRevision):
    name: str = Field(min_length=1, max_length=100)
    preferred_setup_confirmed: StrictBool


class RoutineImport(MissionModel):
    name: str = Field(min_length=1, max_length=100)
    goal: str = Field(min_length=3, max_length=500)
    constraints: str = Field(default='', max_length=600)
    image_url: str = Field(min_length=1, max_length=8_500_000)
    keep_preferences: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(default_factory=list, max_length=1000)
