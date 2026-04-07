"""S3 browser endpoints for navigating external S3 buckets."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from config import settings
from services.s3_client import get_s3_client, get_s3_external_endpoint

logger = logging.getLogger(__name__)
router = APIRouter(tags=["S3 Browser"])


class PresignRequest(BaseModel):
    """Schema for requesting a presigned S3 upload URL."""

    bucket: str = Field(..., description="Target S3 bucket name")
    key: str = Field(..., description="Object key (path) within the bucket")
    expires_in: int = Field(
        3600, description="URL expiry time in seconds (default: 1 hour)"
    )


@router.get(
    "/buckets",
    summary="List S3 buckets",
    description="Returns a list of all S3 buckets accessible to the configured "
    "S3 client (MinIO in development, AWS S3 in production).",
)
async def list_buckets():
    try:

        def _blocking():
            response = get_s3_client().list_buckets()
            return [b["Name"] for b in response.get("Buckets", [])]

        buckets = await asyncio.to_thread(_blocking)
        return {"buckets": buckets}
    except Exception as e:
        logger.error(f"S3 list_buckets: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/list",
    summary="List S3 objects",
    description="Lists objects and folder prefixes within an S3 bucket. Uses delimiter-based "
    "listing to simulate folder navigation. Returns both folders (common prefixes) and "
    "files (objects) at the given prefix level.",
)
async def list_objects(bucket: str, prefix: Optional[str] = ""):
    try:
        params = {"Bucket": bucket, "Delimiter": "/"}
        if prefix:
            params["Prefix"] = prefix

        def _blocking():
            return get_s3_client().list_objects_v2(**params)

        response = await asyncio.to_thread(_blocking)

        folders = [
            {"name": p["Prefix"].rstrip("/").split("/")[-1], "prefix": p["Prefix"]}
            for p in response.get("CommonPrefixes", [])
        ]
        files = [
            {
                "name": obj["Key"].split("/")[-1],
                "key": obj["Key"],
                "size": obj["Size"],
                "last_modified": obj["LastModified"].isoformat(),
            }
            for obj in response.get("Contents", [])
            if obj["Key"] != prefix
        ]

        return {"bucket": bucket, "prefix": prefix, "folders": folders, "files": files}
    except Exception as e:
        logger.error(f"S3 list_objects: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/presign",
    summary="Generate presigned upload URL",
    description="Generates a presigned S3 URL for uploading a file directly from the "
    "browser. The internal S3 endpoint is replaced with the external endpoint so "
    "the browser can reach it. Default expiry is 1 hour.",
)
async def generate_presigned_url(req: PresignRequest):
    try:

        def _blocking():
            return get_s3_client().generate_presigned_url(
                "put_object",
                Params={"Bucket": req.bucket, "Key": req.key},
                ExpiresIn=req.expires_in,
            )

        url = await asyncio.to_thread(_blocking)
        # Replace internal endpoint with external one for browser access
        internal = settings.s3_endpoint
        external = get_s3_external_endpoint()
        url = url.replace(internal, external)
        return {"url": url, "bucket": req.bucket, "key": req.key}
    except Exception as e:
        logger.error(f"S3 presign: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/upload",
    summary="Upload file to S3",
    description="Uploads a file to the specified S3 bucket and key. The file content "
    "is read into memory and uploaded via the S3 client. For large files, prefer "
    "using the presigned URL endpoint instead.",
)
async def upload_file(bucket: str, key: str, file: UploadFile = File(...)):
    try:
        content = await file.read()

        def _blocking():
            get_s3_client().put_object(
                Bucket=bucket,
                Key=key,
                Body=content,
                ContentType=file.content_type or "application/octet-stream",
            )

        await asyncio.to_thread(_blocking)
        return {
            "status": "uploaded",
            "bucket": bucket,
            "key": key,
            "size": len(content),
        }
    except Exception as e:
        logger.error(f"S3 upload: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/download",
    summary="Get presigned download URL",
    description="Generates a presigned S3 URL for downloading a file. The URL is valid "
    "for 1 hour and uses the external S3 endpoint for browser accessibility.",
)
async def get_download_url(bucket: str, key: str):
    try:

        def _blocking():
            return get_s3_client().generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=3600,
            )

        url = await asyncio.to_thread(_blocking)
        internal = settings.s3_endpoint
        external = get_s3_external_endpoint()
        url = url.replace(internal, external)
        return {"url": url, "bucket": bucket, "key": key}
    except Exception as e:
        logger.error(f"S3 download: {e}")
        raise HTTPException(status_code=500, detail=str(e))
