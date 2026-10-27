# Tracker snapshot — shop project

Repository binding is configured in this fixture; no live operations are available.
Inventory is complete: 7 open issues. Existing milestones: "Orders" (open, broad area, empty), "Label printing" (open, empty). Tracker permits one milestone per issue. All supplied discussions are complete.

## Open issues

### #1 — Import shop orders
Body: Import all historical and future orders; support replay.
Comment 11, later: Implementation merged for forward-only intake. Governing scope amendment is closed #6, comment 61. Do not use the original history/replay requirement as this feature's finish line.
### #2 — Enable order intake on production
Body: Configure webhook and credentials and activate the forward-only cutoff. Not done. Requires #1 and #3.
### #3 — Safe worker retry recovery
Body: Fix duplicate side effects after worker restarts. Blocks order intake and shipping-label generation. Not done.
### #4 — Generate shipping labels for accepted orders
Body: Finish carrier integration and validate one label end to end. Requires #3. Order import is not a prerequisite: staff can enter orders manually.
### #5 — Offer delivery-date predictions during order intake
Body: Optional future improvement after baseline intake is operational. Not part of #1's first delivery.
### #7 — Clean up platform modules
Body: Make these modules cleaner.
Comments: none. No measurable outcome or feature relationship specified.
### #8 — Validate intake after deployment
Body: Verify one post-cutoff paid order arrives once, retains correct totals and is acknowledged; record operational evidence. Requires #2 and #3.

## Related closed history

### #6 — Decide order-import launch boundary
Body: Resolve what the initial launch imports.
Comment 61, final approved decision: Initial delivery is forward-only from an explicitly configured cutoff, with duplicate-safe processing and one verified live post-cutoff paid order. Historical replay and delivery predictions are later capabilities. Supersedes #1's original body.
### #9 — Implement order parser
Body: Parser implemented and unit tests passed. No deployment or live flow validation recorded.
