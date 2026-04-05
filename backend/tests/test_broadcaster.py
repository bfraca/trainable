"""Tests for services/broadcaster.py — SSE event pub/sub."""

import asyncio
import json

import pytest

from services.broadcaster import Broadcaster


@pytest.mark.asyncio
async def test_subscribe_and_publish():
    b = Broadcaster()
    queue = await b.subscribe("sess-1")
    await b.publish("sess-1", {"type": "test", "data": "hello"})
    event = await asyncio.wait_for(queue.get(), timeout=1.0)
    assert event == {"type": "test", "data": "hello"}


@pytest.mark.asyncio
async def test_multiple_subscribers():
    b = Broadcaster()
    q1 = await b.subscribe("sess-1")
    q2 = await b.subscribe("sess-1")
    await b.publish("sess-1", {"type": "event"})

    e1 = await asyncio.wait_for(q1.get(), timeout=1.0)
    e2 = await asyncio.wait_for(q2.get(), timeout=1.0)
    assert e1 == e2 == {"type": "event"}


@pytest.mark.asyncio
async def test_unsubscribe():
    b = Broadcaster()
    queue = await b.subscribe("sess-1")
    b.unsubscribe("sess-1", queue)
    await b.publish("sess-1", {"type": "event"})
    assert queue.empty()


@pytest.mark.asyncio
async def test_publish_to_different_session_isolated():
    b = Broadcaster()
    q1 = await b.subscribe("sess-1")
    q2 = await b.subscribe("sess-2")
    await b.publish("sess-1", {"type": "for-1"})
    await b.publish("sess-2", {"type": "for-2"})

    e1 = await asyncio.wait_for(q1.get(), timeout=1.0)
    e2 = await asyncio.wait_for(q2.get(), timeout=1.0)
    assert e1["type"] == "for-1"
    assert e2["type"] == "for-2"
    # Each queue should have exactly 1 event
    assert q1.empty()
    assert q2.empty()


@pytest.mark.asyncio
async def test_publish_no_subscribers():
    b = Broadcaster()
    # Should not raise
    await b.publish("no-one", {"type": "event"})


@pytest.mark.asyncio
async def test_unsubscribe_nonexistent_queue():
    b = Broadcaster()
    queue = asyncio.Queue()
    # Should not raise
    b.unsubscribe("sess-1", queue)


@pytest.mark.asyncio
async def test_stream_yields_events():
    b = Broadcaster()

    async def producer():
        await asyncio.sleep(0.05)
        await b.publish("sess-1", {"type": "metric", "data": {"step": 1}})
        await asyncio.sleep(0.05)
        await b.publish("sess-1", {"type": "done"})

    task = asyncio.create_task(producer())
    events = []
    async for event in b.stream("sess-1"):
        events.append(event)
        parsed = json.loads(event["data"])
        if parsed.get("type") == "done":
            break

    await task
    assert len(events) == 2
    assert json.loads(events[0]["data"])["type"] == "metric"
    assert json.loads(events[1]["data"])["type"] == "done"
