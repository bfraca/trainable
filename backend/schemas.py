"""Pydantic request/response schemas."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class ExperimentCreate(BaseModel):
    """Schema for creating a new experiment."""

    name: str = Field(..., description="Human-readable experiment name")
    description: str = Field("", description="Optional experiment description")
    instructions: str = Field(
        "", description="Custom instructions for the AI agent across all stages"
    )


class MessageCreate(BaseModel):
    """Schema for sending a message to a session."""

    content: str = Field(..., description="The message text content")
    run_agent: bool = Field(
        False,
        description="If true, trigger the AI agent to process this message "
        "in the context of the current stage",
    )


class StageStart(BaseModel):
    """Schema for starting a pipeline stage."""

    gpu: Optional[str] = Field(
        None,
        description="GPU type for training (e.g. 'T4', 'A10G'). "
        "Only applicable for the train stage.",
    )
    instructions: Optional[str] = Field(
        None,
        description="Additional stage-specific instructions appended to "
        "the experiment-level instructions",
    )
