"""Shared S3 client singleton — all S3 access goes through here."""

import logging

import boto3

from config import settings

logger = logging.getLogger(__name__)

_client = None


def get_s3_client():
    """Return a lazily-initialized boto3 S3 client."""
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            region_name=settings.aws_region,
        )
    return _client


def get_s3_external_endpoint() -> str:
    """Return the externally-reachable S3 endpoint (for presigned URLs / frontend)."""
    return settings.s3_endpoint_external or settings.s3_endpoint
