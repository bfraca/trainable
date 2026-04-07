"""SSE streaming endpoint."""

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from services.broadcaster import broadcaster

router = APIRouter(tags=["Streaming"])


@router.get(
    "/sessions/{session_id}/stream",
    summary="Stream session events (SSE)",
    description="Opens a Server-Sent Events (SSE) connection that streams real-time "
    "events for the session. Events include agent messages, tool calls, metrics, "
    "file generation, stage transitions, and errors. The frontend uses this to "
    "render the live chat and workspace updates. Supports reconnection with "
    "exponential backoff on the client side.",
)
async def stream_events(session_id: str):
    return EventSourceResponse(broadcaster.stream(session_id))
