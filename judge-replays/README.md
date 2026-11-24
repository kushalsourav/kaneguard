# Legacy judge-replay bundles (v29)

KaneGuard v30 no longer automatically generates, backfills, or plays these archives.
The Studio uses a read-only **Workflow Waterfall** generated directly from saved run records:
`/api/runs/<run-id>/workflow`. Original Kane evidence lives in `runs/<run-id>/`.

Existing archives in this directory are preserved deliberately, not deleted during upgrade.
They may include prompts, code paths, and redacted transcripts. Review privacy before publishing.
You can delete old archives *after taking a backup* if you no longer want them; this
does not delete the source run records and authentic Kane evidence.
