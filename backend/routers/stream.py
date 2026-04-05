"""SSE streaming endpoint."""

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from services.broadcaster import broadcaster

router = APIRouter()


@router.get("/sessions/{session_id}/stream")
async def stream_events(session_id: str):
    return EventSourceResponse(broadcaster.stream(session_id))
