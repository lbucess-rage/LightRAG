"""
S3 utility functions for LightRAG document storage.
"""

import os
from typing import Optional
from pathlib import Path
from urllib.parse import quote

try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError

    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False

from lightrag.utils import logger


class S3Client:
    """S3 client for document upload, delete, and URL generation."""

    def __init__(self):
        self.enabled = os.getenv("ENABLE_S3_UPLOAD", "false").lower() == "true"
        self.bucket = os.getenv("AWS_S3_BUCKET", "")
        self.region = os.getenv("AWS_S3_REGION", "ap-northeast-2")
        self.prefix = os.getenv("S3_DOCUMENT_PREFIX", "lightrag/documents")

        self._client = None

        if self.enabled:
            if not BOTO3_AVAILABLE:
                logger.warning(
                    "S3 upload is enabled but boto3 is not installed. "
                    "Install with: pip install boto3"
                )
                self.enabled = False
            elif not self.bucket:
                logger.warning(
                    "S3 upload is enabled but AWS_S3_BUCKET is not set."
                )
                self.enabled = False
            else:
                self._init_client()

    def _init_client(self):
        """Initialize the S3 client."""
        try:
            self._client = boto3.client(
                "s3",
                region_name=self.region,
                aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
                aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            )
            logger.info(
                f"S3 client initialized: bucket={self.bucket}, prefix={self.prefix}"
            )
        except NoCredentialsError:
            logger.error("AWS credentials not found. S3 upload disabled.")
            self.enabled = False
        except Exception as e:
            logger.error(f"Failed to initialize S3 client: {e}")
            self.enabled = False

    def _get_s3_key(
        self, filename: str, workspace: str = "", doc_id: str = ""
    ) -> str:
        """Generate S3 key for a file.

        Args:
            filename: The filename
            workspace: Optional workspace name
            doc_id: Optional document ID for organizing files by document

        Returns:
            S3 key string
        """
        parts = [self.prefix]
        if workspace:
            parts.append(workspace)
        if doc_id:
            parts.append(doc_id)
        parts.append(filename)
        return "/".join(parts)

    def get_public_url(
        self, filename: str, workspace: str = "", doc_id: str = ""
    ) -> str:
        """
        Generate public URL for a file in S3.

        Args:
            filename: The filename
            workspace: Optional workspace name
            doc_id: Optional document ID for organizing files by document

        Returns:
            Public URL string
        """
        s3_key = self._get_s3_key(filename, workspace, doc_id)
        # URL encode the key for special characters (Korean, spaces, etc.)
        encoded_key = quote(s3_key, safe="/")
        return f"https://{self.bucket}.s3.{self.region}.amazonaws.com/{encoded_key}"

    async def upload_file(
        self, file_path: Path, filename: str, workspace: str = "", doc_id: str = ""
    ) -> Optional[str]:
        """
        Upload a file to S3.

        Args:
            file_path: Local file path
            filename: Filename to use in S3
            workspace: Optional workspace name
            doc_id: Optional document ID for organizing files by document

        Returns:
            S3 URL if successful, None otherwise
        """
        if not self.enabled or not self._client:
            return None

        s3_key = self._get_s3_key(filename, workspace, doc_id)

        try:
            # Determine content type
            content_type = self._get_content_type(filename)

            self._client.upload_file(
                str(file_path),
                self.bucket,
                s3_key,
                ExtraArgs={
                    "ContentType": content_type,
                    "ContentDisposition": f'inline; filename="{quote(filename)}"',
                },
            )

            url = self.get_public_url(filename, workspace, doc_id)
            logger.info(f"Successfully uploaded to S3: {s3_key}")
            return url

        except ClientError as e:
            logger.error(f"Failed to upload to S3: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error during S3 upload: {e}")
            return None

    async def delete_file(
        self, filename: str, workspace: str = "", doc_id: str = ""
    ) -> bool:
        """
        Delete a file from S3.

        Args:
            filename: Filename to delete
            workspace: Optional workspace name
            doc_id: Optional document ID for organizing files by document

        Returns:
            True if successful, False otherwise
        """
        if not self.enabled or not self._client:
            return False

        s3_key = self._get_s3_key(filename, workspace, doc_id)

        try:
            self._client.delete_object(Bucket=self.bucket, Key=s3_key)
            logger.info(f"Successfully deleted from S3: {s3_key}")
            return True

        except ClientError as e:
            logger.error(f"Failed to delete from S3: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error during S3 delete: {e}")
            return False

    def _get_content_type(self, filename: str) -> str:
        """Get content type based on file extension."""
        ext = Path(filename).suffix.lower()
        content_types = {
            ".pdf": "application/pdf",
            ".txt": "text/plain; charset=utf-8",
            ".md": "text/markdown; charset=utf-8",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".doc": "application/msword",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".xls": "application/vnd.ms-excel",
            ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ".ppt": "application/vnd.ms-powerpoint",
            ".html": "text/html; charset=utf-8",
            ".htm": "text/html; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".xml": "application/xml; charset=utf-8",
            ".csv": "text/csv; charset=utf-8",
            ".rtf": "application/rtf",
            ".odt": "application/vnd.oasis.opendocument.text",
            ".epub": "application/epub+zip",
        }
        return content_types.get(ext, "application/octet-stream")

    def is_enabled(self) -> bool:
        """Check if S3 upload is enabled."""
        return self.enabled


# Global S3 client instance
_s3_client: Optional[S3Client] = None


def get_s3_client() -> S3Client:
    """Get or create the global S3 client instance."""
    global _s3_client
    if _s3_client is None:
        _s3_client = S3Client()
    return _s3_client
