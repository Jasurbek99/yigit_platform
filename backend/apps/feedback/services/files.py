import logging
import os

from rest_framework import serializers

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB per file
MAX_FILES_PER_PARENT = 5         # max files per ticket or per reply

ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}
ALLOWED_MIME_TYPES = {'image/png', 'image/jpeg', 'image/webp', 'image/gif'}

# Magic-byte signatures — (offset, bytes_to_match)
# WebP: bytes 0-3 = RIFF, bytes 8-11 = WEBP
_MAGIC_SIGNATURES = [
    (b'\x89PNG\r\n\x1a\n', 'image/png'),    # PNG
    (b'\xff\xd8\xff', 'image/jpeg'),          # JPEG
    (b'GIF87a', 'image/gif'),                 # GIF 87a
    (b'GIF89a', 'image/gif'),                 # GIF 89a
]
_WEBP_RIFF = b'RIFF'
_WEBP_TAG = b'WEBP'


def _detect_mime_from_magic(header: bytes) -> str | None:
    """Detect MIME type from first 12 bytes using magic-byte signatures.

    Returns the detected MIME type string, or None if no signature matches.
    """
    for signature, mime in _MAGIC_SIGNATURES:
        if header.startswith(signature):
            return mime
    # WebP: bytes 0-3 == RIFF and bytes 8-11 == WEBP
    if len(header) >= 12 and header[:4] == _WEBP_RIFF and header[8:12] == _WEBP_TAG:
        return 'image/webp'
    return None


def sanitise_filename(original: str) -> str:
    """Strip path components to prevent directory traversal.

    Args:
        original: Raw filename as provided by the client.

    Returns:
        Basename only, safe to store as original_filename.
    """
    return os.path.basename(original)


def validate_attachment(uploaded_file) -> None:
    """Validate a single uploaded file for size, extension, and magic bytes.

    Args:
        uploaded_file: A Django InMemoryUploadedFile or TemporaryUploadedFile.

    Raises:
        serializers.ValidationError: If the file fails any check.
    """
    # Size check
    if uploaded_file.size > MAX_FILE_SIZE:
        raise serializers.ValidationError(
            f"File '{uploaded_file.name}' is too large "
            f"({uploaded_file.size // 1024} KB). Maximum allowed size is 5 MB."
        )

    # Extension check
    _, ext = os.path.splitext(uploaded_file.name.lower())
    if ext not in ALLOWED_EXTENSIONS:
        raise serializers.ValidationError(
            f"File '{uploaded_file.name}' has an unsupported extension '{ext}'. "
            f"Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # Magic-byte check — read first 12 bytes without consuming the upload stream
    uploaded_file.seek(0)
    header = uploaded_file.read(12)
    uploaded_file.seek(0)

    detected_mime = _detect_mime_from_magic(header)
    if detected_mime is None:
        raise serializers.ValidationError(
            f"File '{uploaded_file.name}' does not appear to be a valid image "
            f"(magic-byte check failed). Only PNG, JPEG, WebP, and GIF are accepted."
        )
    if detected_mime not in ALLOWED_MIME_TYPES:
        raise serializers.ValidationError(
            f"File '{uploaded_file.name}' detected as '{detected_mime}', "
            f"which is not allowed. Accepted types: {', '.join(sorted(ALLOWED_MIME_TYPES))}"
        )
