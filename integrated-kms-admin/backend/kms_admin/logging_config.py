from __future__ import annotations

import logging
import os
from logging.handlers import TimedRotatingFileHandler

from .config import settings


def configure_logging() -> None:
    os.makedirs(settings.log_dir, exist_ok=True)
    log_path = os.path.join(settings.log_dir, "kms-admin.log")

    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )

    file_handler = TimedRotatingFileHandler(
        log_path,
        when="midnight",
        interval=1,
        backupCount=settings.log_backup_days,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler.suffix = "%Y-%m-%d"

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))

    root = logging.getLogger()
    root.handlers = []
    root.setLevel(os.getenv("KMS_ADMIN_LOG_LEVEL", "INFO").upper())
    root.addHandler(console_handler)
    root.addHandler(file_handler)
