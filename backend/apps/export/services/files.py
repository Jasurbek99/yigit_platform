"""File validation for quality-certificate scans — JPG or PDF.

A fourth near-copy of the same validator (``feedback.services.files`` takes
images with no PDF signature, ``contracts.services.files`` takes PDFs only,
``transport.services.files`` takes both). The transport one is byte-for-byte
what is needed here, but ``transport`` imports from ``export`` — it is
downstream — so importing it back would invert the dependency graph
(backend/CLAUDE.md). Copied rather than hoisted into ``core``: hoisting would
mean four call sites moving in one commit for no behavioural gain, and each
app's limits are allowed to diverge.

A certificate arrives either as a phone photo of the paper or as a scanner PDF,
so this accepts both and nothing else.
"""
import os

from rest_framework import serializers

# ── Constants ──────────────────────────────────────────────────────────────────
MAX_FILE_SIZE = 10 * 1024 * 1024   # 10 MB per file (phone photos and scans)
MAX_FILES_PER_TYPE = 5             # multi-page certificate, re-issue, spare

ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.pdf'}

_JPEG_MAGIC = b'\xff\xd8\xff'
_PDF_MAGIC = b'%PDF-'


def sanitise_filename(original: str) -> str:
    """Strip path components to prevent directory traversal."""
    return os.path.basename(original)


def detect_mime(uploaded_file) -> str:
    """MIME type from the file's own magic bytes, not the client's claim.

    Only called after ``validate_quality_certificate`` has passed, so the
    header is known to be one of the two.
    """
    uploaded_file.seek(0)
    header = uploaded_file.read(5)
    uploaded_file.seek(0)
    return 'application/pdf' if header.startswith(_PDF_MAGIC) else 'image/jpeg'


def validate_quality_certificate(uploaded_file) -> None:
    """Validate one uploaded certificate scan for size, extension, magic bytes.

    Args:
        uploaded_file: A Django InMemoryUploadedFile or TemporaryUploadedFile.

    Raises:
        serializers.ValidationError: If the file fails any check.
    """
    if uploaded_file.size > MAX_FILE_SIZE:
        raise serializers.ValidationError(
            f"File '{uploaded_file.name}' is too large "
            f"({uploaded_file.size // 1024} KB). Maximum allowed size is 10 MB."
        )

    _, ext = os.path.splitext(uploaded_file.name.lower())
    if ext not in ALLOWED_EXTENSIONS:
        raise serializers.ValidationError(
            f"File '{uploaded_file.name}' has an unsupported extension '{ext}'. "
            f"Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}."
        )

    # Magic bytes — the extension is the client's claim, the header is evidence.
    uploaded_file.seek(0)
    header = uploaded_file.read(5)
    uploaded_file.seek(0)
    if not (header.startswith(_JPEG_MAGIC) or header.startswith(_PDF_MAGIC)):
        raise serializers.ValidationError(
            f"File '{uploaded_file.name}' is not a valid JPEG or PDF."
        )
