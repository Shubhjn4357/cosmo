"""
Cosmo AI - Shared Type Definitions
==================================
Centralized location for common backend types to ensure strict type safety.
"""

from typing import Union, Dict, List, Any, Optional
from typing_extensions import TYPE_CHECKING, TypedDict

# Primitive JSON types
JsonPrimitive = Union[str, int, float, bool, None]
JsonValue = Union[JsonPrimitive, Dict[str, "JsonValue"], List["JsonValue"]]

# SQLite compatible values
SqlValue = Union[str, int, float, bytes, None]

class ToolDefinition(TypedDict):
    name: str
    description: str
    input_schema: Dict[str, Any] # Schema often complex, Any is tolerated for top-level schema

class StepInfo(TypedDict):
    id: str
    tool: str
    goal: str
    reason: str
    status: str # "pending" | "running" | "completed" | "failed"
    output_preview: Optional[str]

class ToolResult(TypedDict, total=False):
    tool: str
    summary: str
    context: Optional[str]
    sources: Optional[List[Dict[str, Any]]]
    image_url: Optional[str]
    answer: Optional[str]
    stdout: Optional[str]
    stderr: Optional[str]
    combined: Optional[str]
    returncode: Optional[int]
    content: Optional[str]
    status_code: Optional[int]
    result: Optional[Any]

class AgentEvent(TypedDict):
    timestamp: float
    kind: str
    message: str
    # extra data handled via keys outside the typed dict if needed,
    # or we can use a recursive approach.

class AgentSessionMinimal(TypedDict):
    id: str
    status: str
    progress: int
    created_at: float
