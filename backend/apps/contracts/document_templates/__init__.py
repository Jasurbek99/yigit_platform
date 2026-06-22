"""Document templates for contract/invoice generators.

Holds the registry and the authored ``.docx`` templates (Jinja-tagged, filled at
runtime by ``docxtpl`` via ``apps.contracts.services.document_render``).

The ``.docx`` files in this directory are the source-of-truth layouts. They are
regenerated from ``build_templates.py`` but, once a human refines layout in Word,
the ``.docx`` becomes authoritative — re-running the builder would overwrite it,
so only re-run when intentionally resetting a template.
"""
