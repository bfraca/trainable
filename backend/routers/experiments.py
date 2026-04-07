"""Experiment CRUD routes."""

import logging
import os
import re
import tempfile
import uuid
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from config import settings
from db import get_db
from models import Experiment
from models import Session as SessionModel
from services.s3_client import get_s3_client
from services.volume import upload_to_volume

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/experiments")
async def list_experiments(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Experiment)
        .options(selectinload(Experiment.sessions))
        .order_by(Experiment.created_at.desc())
    )
    experiments = result.scalars().all()
    return [e.to_dict(sessions=e.sessions) for e in experiments]


@router.post("/experiments")
async def create_experiment(
    name: str = Form(...),
    description: str = Form(""),
    instructions: str = Form(""),
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    exp_id = str(uuid.uuid4())
    s3 = get_s3_client()
    uploaded_files = []

    for f in files:
        filename = f.filename or "file"
        key = f"datasets/{exp_id}/{filename}"
        content_type = f.content_type or "application/octet-stream"

        # Stream to a temp file instead of accumulating in memory.
        # This keeps memory usage O(chunk_size) instead of O(file_size).
        total_bytes = 0
        tmp_fd, tmp_path = tempfile.mkstemp()
        try:
            with os.fdopen(tmp_fd, "wb") as tmp:
                chunk = await f.read(1024 * 1024)
                while chunk:
                    total_bytes += len(chunk)
                    if total_bytes > settings.max_upload_size_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail=f"File '{filename}' exceeds max upload size of {settings.max_upload_size_bytes // (1024 * 1024)}MB",
                        )
                    tmp.write(chunk)
                    chunk = await f.read(1024 * 1024)
            logger.info("Read %s: %d bytes (streamed to disk)", filename, total_bytes)

            # Upload to S3 from disk — boto3 handles multipart automatically
            with open(tmp_path, "rb") as fobj:
                s3.upload_fileobj(
                    fobj,
                    "datasets",
                    key,
                    ExtraArgs={"ContentType": content_type},
                )

            # Upload to Modal Volume (for sandbox execution)
            try:
                await upload_to_volume(tmp_path, f"/datasets/{exp_id}/{filename}")
            except Exception as e:
                logger.warning(f"Modal Volume upload failed for {filename}: {e}")
        finally:
            os.unlink(tmp_path)

        uploaded_files.append(f"s3://datasets/{key}")
        logger.info(f"Uploaded {filename} ({total_bytes} bytes) → S3 + Modal Volume")

    # dataset_ref: folder for multiple files, single file path otherwise
    if len(uploaded_files) == 1:
        dataset_ref = uploaded_files[0]
    else:
        dataset_ref = f"s3://datasets/datasets/{exp_id}/"

    experiment = Experiment(
        id=exp_id,
        name=name,
        description=description,
        dataset_ref=dataset_ref,
        instructions=instructions,
    )
    db.add(experiment)

    session_id = str(uuid.uuid4())
    session = SessionModel(id=session_id, experiment_id=exp_id)
    db.add(session)

    await db.commit()

    return {
        "id": exp_id,
        "name": name,
        "description": description,
        "dataset_ref": dataset_ref,
        "instructions": instructions,
        "session_id": session_id,
        "uploaded_files": uploaded_files,
    }


@router.post("/experiments/from-s3")
async def create_experiment_from_s3(
    name: str = Form(...),
    description: str = Form(""),
    instructions: str = Form(""),
    s3_path: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    """Create experiment referencing an existing S3 dataset."""

    exp_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())

    # Parse s3://bucket/key or s3://bucket/prefix/
    match = re.match(r"s3://([^/]+)/(.+)", s3_path)
    if not match:
        raise HTTPException(status_code=400, detail=f"Invalid S3 path: {s3_path}")

    bucket = match.group(1)
    key_or_prefix = match.group(2)
    s3 = get_s3_client()

    # Sync files from S3 to Modal Volume so sandboxes can access them
    if key_or_prefix.endswith("/"):
        response = s3.list_objects_v2(Bucket=bucket, Prefix=key_or_prefix)
        for obj in response.get("Contents", []):
            obj_key = obj["Key"]
            filename = obj_key.split("/")[-1]
            if not filename:
                continue
            data = s3.get_object(Bucket=bucket, Key=obj_key)["Body"].read()
            with tempfile.NamedTemporaryFile(delete=False) as tmp:
                tmp.write(data)
                tmp_path = tmp.name
            try:
                await upload_to_volume(tmp_path, f"/datasets/{exp_id}/{filename}")
            except Exception as e:
                logger.warning(f"Modal Volume upload failed for {filename}: {e}")
            finally:
                os.unlink(tmp_path)
    else:
        filename = key_or_prefix.split("/")[-1]
        data = s3.get_object(Bucket=bucket, Key=key_or_prefix)["Body"].read()
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        try:
            await upload_to_volume(tmp_path, f"/datasets/{exp_id}/{filename}")
        except Exception as e:
            logger.warning(f"Modal Volume upload failed for {filename}: {e}")
        finally:
            os.unlink(tmp_path)

    experiment = Experiment(
        id=exp_id,
        name=name,
        description=description,
        dataset_ref=s3_path,
        instructions=instructions,
    )
    db.add(experiment)

    session = SessionModel(id=session_id, experiment_id=exp_id)
    db.add(session)

    await db.commit()

    return {
        "id": exp_id,
        "name": name,
        "description": description,
        "dataset_ref": s3_path,
        "instructions": instructions,
        "session_id": session_id,
    }


@router.get("/experiments/{experiment_id}")
async def get_experiment(experiment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Experiment)
        .where(Experiment.id == experiment_id)
        .options(selectinload(Experiment.sessions))
    )
    experiment = result.scalar_one_or_none()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return {
        **experiment.to_dict(sessions=experiment.sessions),
        "sessions": [s.to_dict() for s in experiment.sessions],
    }


@router.delete("/experiments/{experiment_id}")
async def delete_experiment(experiment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Experiment).where(Experiment.id == experiment_id))
    experiment = result.scalar_one_or_none()
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
    await db.delete(experiment)
    await db.commit()
    return {"deleted": True}
