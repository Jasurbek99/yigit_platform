# Run Import Task

Use the `data-importer` agent to execute the next pending import task from `docs/IMPORT_TASKS.md`.

The agent will:
1. Read `docs/IMPORT_TASKS.md` and find the first `[ ]` task
2. Analyze the source Excel file
3. Write the Django management command
4. Run dry-run to verify
5. Run the actual import
6. Mark the task `[x]` with row count
