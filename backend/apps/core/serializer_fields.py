from rest_framework import serializers


class RelativeFileField(serializers.FileField):
    """A ``FileField`` that serialises to a ROOT-RELATIVE URL (``/media/...``).

    DRF's ``FileField`` returns ``request.build_absolute_uri(value.url)`` — an
    ABSOLUTE url built from the ``Host`` header Django received. Neither proxy
    in front of this app sets that header to the browser's actual origin:

      * production nginx sends ``proxy_set_header Host $host`` — ``$host`` DROPS
        the port, so a browser on ``http://10.10.11.25:8080`` was handed
        ``http://10.10.11.25/media/...`` (port 80), which 404s.
      * the Vite dev proxy uses ``changeOrigin: true``, which rewrites the Host
        to the proxy TARGET — so the api returned ``http://127.0.0.1:8000/...``,
        a url that only resolves for a browser running ON the dev machine.

    A relative url is same-origin by construction: whatever host and port served
    the SPA also serves the file, so no header has to be correct for an
    ``<img src>`` to resolve. Only ``to_representation`` is overridden —
    uploads go through ``FileField.to_internal_value`` untouched.
    """

    def to_representation(self, value):
        if not value:
            return None
        try:
            return value.url
        except AttributeError:
            return None
