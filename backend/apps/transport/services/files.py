"""File validation for fleet documents — driver passports and truck-head tech
passports (JPG or PDF).

Neither existing validator covers this pair: `feedback.services.files` takes
images but has no `%PDF-` signature, and `contracts.services.files` takes PDFs
only. A scan arrives either as a phone photo or as a scanner PDF, so this one
accepts both and nothing else.
"""
import os

from rest_framework import serializers

# ── Constants ──────────────────────────────────────────────────────────────────
MAX_FILE_SIZE = 10 * 1024 * 1024   # 10 MB per file (phone photos and scans)
MAX_FILES_PER_RECORD = 5           # both passport pages, front and back, spare

ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.pdf'}

_JPEG_MAGIC = b'\xff\xd8\xff'
_PDF_MAGIC = b'%PDF-'


def sanitise_filename(original: str) -> str:
    """Strip path components to prevent directory traversal."""
    return os.path.basename(original)


def detect_mime(uploaded_file) -> str:
    """MIME type from the file's own magic bytes, not the client's claim.

    Only called after ``validate_fleet_document`` has passed, so the header is
    known to be one of the two.
    """
    uploaded_file.seek(0)
    header = uploaded_file.read(5)
    uploaded_file.seek(0)
    return 'application/pdf' if header.startswith(_PDF_MAGIC) else 'image/jpeg'


def validate_fleet_document(uploaded_file) -> None:
    """Validate one uploaded scan for size, extension and magic bytes.

    Args:
        uploaded_file: A Django InMemoryUploadedFile or TemporaryUploadedFile.

    Raises:
        serializers.ValidationError: If the file fails any check.
    """
    # Size check
    if uploaded_file.size > MAX_FILE_SIZE:
        raise serializers.ValidationError(
            f"File '{uploaded_file.name}' is too large "
            f"({uploaded_file.size // 1024} KB). Maximum allowed size is 10 MB."
        )

    # Extension check
    _, ext = os.path.splitext(uploaded_file.name.lower())
    if ext not in ALLOWED_EXTENSIONS:
        raise serializers.ValidationError(
            f"File '{uploaded_file.name}' has an unsupported extension '{ext}'. "
            f"Only JPG and PDF files are accepted."
        )

    # Magic-byte check — read the header without consuming the upload stream
    uploaded_file.seek(0)
    header = uploaded_file.read(5)
    uploaded_file.seek(0)

    is_pdf = header.startswith(_PDF_MAGIC)
    is_jpeg = header.startswith(_JPEG_MAGIC)
    if ext == '.pdf' and not is_pdf:
        raise serializers.ValidationError(
            f"File '{uploaded_file.name}' does not appear to be a valid PDF "
            f"(magic-byte check failed)."
        )
    if ext in ('.jpg', '.jpeg') and not is_jpeg:
        raise serializers.ValidationError(
            f"File '{uploaded_file.name}' does not appear to be a valid JPEG "
            f"(magic-byte check failed)."
        )
