# Sample input

Penpot "Add a sample file" and "/ Name taken". Three fixed samples (users.csv,
product-ids.csv, order-body.json) are generated deterministically in the browser
and uploaded through the input-upload `UploadWorkflow`, to the workspace root.
No backend sample catalogue. Names are not unique server-side, so "Name taken"
checks the listed inventory names; on an incomplete page only that page is checked
and the field says so. Closing the dialog retires the draft like any upload.
Check: vitest run web/src/features/input-sample.
