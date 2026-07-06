"""File validation for contract document attachments (PDF only)."""
import os

from rest_framework import serializers

# ── Constants ──────────────────────────────────────────────────────────────────
MAX_FILE_SIZE = 20 * 1024 * 1024   # 20 MB per file (scanned contracts run large)
MAX_FILES_PER_CONTRACT = 20

ALLOWED_EXTENSIONS = {'.pdf'}
ALLOWED_MIME_TYPES = {'application/pdf'}

_PDF_MAGIC = b'%PDF-'


def sanitise_filename(original: str) -> str:
    """Strip path components to prevent directory traversal."""
    return os.path.basename(original)


def validate_contract_document(uploaded_file) -> None:
    """Validate a single uploaded contract document for size, extension, magic bytes.

    Args:
        uploaded_file: A Django InMemoryUploadedFile or TemporaryUploadedFile.

    Raises:
        serializers.ValidationError: If the file fails any check.
    """
    # Size check
    if uploaded_file.size > MAX_FILE_SIZE:
        raise serializers.ValidationError(
            f"File '{uploaded_file.name}' is too large "
            f"({uploaded_file.size // 1024} KB). Maximum allowed size is 20 MB."
        )

    # Extension check
    _, ext = os.path.splitext(uploaded_file.name.lower())
    if ext not in ALLOWED_EXTENSIONS:
        raise serializers.ValidationError(
            f"File '{uploaded_file.name}' has an unsupported extension '{ext}'. "
            f"Only PDF files are accepted."
        )

    # Magic-byte check — read header without consuming the upload stream
    uploaded_file.seek(0)
    header = uploaded_file.read(5)
    uploaded_file.seek(0)

    if not header.startswith(_PDF_MAGIC):
        raise serializers.ValidationError(
            f"File '{uploaded_file.name}' does not appear to be a valid PDF "
            f"(magic-byte check failed)."
        )
