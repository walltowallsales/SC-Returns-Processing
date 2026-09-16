# SellerChamp Returns App

Mobile-friendly front-of-house return intake plus back-of-house return processing.

## Features
- Search SellerChamp by eBay order number. On phones, the order field requests the numeric keyboard and adds hyphens automatically.
- Pull order, SKU, product, marketplace, and inventory-location information.
- Front of house records what they physically observe, up to 6 photos, notes, and chooses the disposition.
- Printable PDF traveler with photos, notes, selected disposition, and a very large item location.
- Back-of-house queue sorted by item location, with saved instructions/photos and PDF reprint.
- Option 1: add quantity back to normal inventory, then check SellerChamp `marketplace_status`. If the eBay listing is inactive, choose **Activate eBay Item & Archive Return** or **Leave Inactive & Archive Return**.
- Option 2: add quantity to inventory and increase SellerChamp `reserve_quantity`, then archive the return and return to the queue.
- Option 3: create a separate SellerChamp/eBay listing using a one-item manifest and auto-submit it, then archive the return and return to the queue.

## Render setup
1. Upload this complete package to a GitHub repository.
2. In Render, create a **Blueprint** from that repository. `render.yaml` creates the web service and persistent disk.
3. Set these environment variables:
   - `SELLERCHAMP_API_TOKEN` — required.
   - `APP_PIN` — required if you want PIN protection. Set this to the numeric PIN you want to use. After a successful entry, that browser/device stays authorized for 30 days. The API and uploaded return photos are protected server-side, not just hidden in the browser UI.
   - `RETURN_APP_BASE_URL` — your final Render URL, e.g. `https://sellerchamp-returns.onrender.com`.
   - `SC_SHIP_FROM_ADDRESS_ID` — required for Option 3.
   - `SC_EBAY_TEMPLATE_ID` — required for Option 3.
4. Deploy.

## Option 3 caution
SellerChamp manifest creation requires the ship-from address and eBay template IDs. The app uses the marketplace account from the original order and sets `auto_submit: true`. Test this path on one low-risk item first because your eBay template can have account-specific required fields.

## Persistent data
The Blueprint mounts `/var/data`. Return records and uploaded photos are stored there so redeploying the app does not wipe them.

## Archived returns
After a back-of-house action is completed, the return record is marked `archived` and disappears from the active Returns Queue. The data remains in `returns.json` for history/recovery. Option 1 waits for an eBay decision only when SellerChamp reports that the listing is not active.

## eBay relisting
SellerChamp documents `marketplace_status` on products and supports `PUT /api/products/PRODUCT_ID?relist=true` to relist an inactive marketplace item. The app uses that documented relist path for the **Activate eBay Item** button.

## Version 1.3
- Large Open / Print PDF buttons in intake, processing, and archive views.
- Process Returns now scrolls to the top of the selected return instead of the bottom.


## v1.4
- Doubled the text size throughout the printable return PDF for easier reading.

## v1.5
- Changed SellerChamp links to open the Products section filtered by the item's SKU instead of the product-info route.
- Disabled automatic telephone-number detection on iPhone so SKU text no longer opens the dialer.


## v1.6
- Added a separate **Speak Order** microphone button while keeping the Order ID field numeric-keypad friendly.
- Uses Render persistent storage at `/var/data` for the returns database and uploaded return photos.
- Added **Delete Archived > 60 Days** with two confirmations. It deletes only archived records older than 60 days and their stored photos.

### IMPORTANT: make storage permanent on your existing Render service
The included `render.yaml` defines a 1 GB Persistent Disk mounted at `/var/data` and sets `DATA_DIR=/var/data`.

If your existing Render service was created manually rather than from the included Blueprint, updating the files alone will not create that disk. In Render, add a Persistent Disk mounted at `/var/data`, then set the environment variable `DATA_DIR` to `/var/data` and redeploy. Keep that same disk attached during future app upgrades.

The 60-day cleanup is manual only; records are not automatically deleted.


## V2
- PDF title now uses the largest font that fits `RETURN PROCESSING SHEET` on one line.
- Original condition is translated from common SellerChamp/eBay numeric condition IDs to a condition name.
- Added a blank line between Observed Condition and Front-of-House Decision.
- Instructions / Notes content is bold.
- View in SellerChamp now uses the same `app2.sellerchamp.com/products` SKU-search URL pattern used by the SellerChamp Pick app.
- New release naming starts at `SellerChamp-returns-V2.zip`; future updates should continue from V2.


## V2.1
- Added a Delete button to every record in **2. Process Returns**.
- Deletion requires the dedicated PIN `8880`.
- A confirmation is required after the PIN.
- Deleting permanently removes the active return record and its stored return photos.


## V2.2
- Fixed a PDF title-sizing bug that caused the body text to render invisibly after the V2 title change.
- Preserves all V2 PDF formatting requests and the V2.1 Process Returns delete button/PIN.


## V2-3
- Reworked the PDF header positioning to avoid PDFKit's `lineBreak:false` cursor behavior.
- The title is fixed to one centered line at the top.
- The body cursor is explicitly reset to the left margin before return details are written, preventing text from running down the right edge or creating many pages.


## V2-4
- PDF: added SellerChamp Item Remarks Description immediately after Original Condition, followed by a blank line before Observed Condition.
- Process Returns queue placard now shows `Order: <order number>` before the SKU.
- Option 1 now checks and displays the current eBay marketplace status as soon as a return is opened.
- If the listing is not active, the existing post-inventory workflow presents the option to activate/relist it before archiving.


## V2-5
- Prevents an Order ID from being processed more than once, including when its prior return is archived.
- The duplicate check occurs both before SellerChamp order lookup and again server-side when saving the return.
- If the existing return is permanently deleted, that Order ID becomes eligible again.
- Removed the dedicated 8880 delete PIN from Process Returns.
- Delete now uses a clear permanent-delete confirmation to protect against accidental taps.


## V2-6
PDF-only wording/formatting changes:
- `Item Remarks Description` → `Original Item Remarks Description`.
- `Front-of-House Decision` → `Decision`.
- `Instructions / Notes` → `Instructions`.
- Instructions content is no longer bold and is underlined.
- Observed Condition line/content is underlined.


## V2-7
- Fixed Archived `View in SellerChamp` to generate the working app2 Products SKU-search link directly from the archived SKU.
- Added confirmed permanent deletion for individual Archived records.
- Added `Move Back to Process Returns` for Archived records.
- PDF: Observed Condition label is bold; only the observed value is underlined.
- PDF: Instructions is bold with a colon and the instruction text continues on the same line, with no forced carriage return and no underline.


## V2-8
- Return Intake now shows `eBay Condition - Item Remarks Description` directly below the SKU.
- Option 1 now reports the actual SellerChamp quantity at the selected location after the returned inventory is added.
- The user can correct that stock quantity before completing the return.
- Active listings wait for quantity review before archiving; inactive listings still offer activation or leave-inactive choices after the quantity is reviewed/corrected.


## V2-9
- Return Intake now fetches the full SellerChamp product after the SKU match.
- Displays SellerChamp `item_condition` as a readable condition name; eBay numeric condition ID is only a fallback.
- Displays and saves the full product `item_remarks` value as the Item Remarks Description.


## V2-10
- Added **4. Add Direct**.
- Search SellerChamp by SKU.
- Report shows Location, Title, Quantity On Hand, Quantity In Reserve, and `eBay Condition - Item Remarks Description`.
- Shows inventory by location and allows the quantity at each location to be changed, with confirmation.
- If the product has no inventory location, a location and quantity can be entered directly.


## V2-11
- 4. Add Direct SKU field now requests the numeric keypad on mobile.
- Added a separate `Speak SKU` microphone button, matching the Return Intake approach.
- Spoken SKU digits are inserted into the field and searched automatically.


## V2-12
- Added Cancel Listening on tabs 1 and 4.
- Cancel immediately stops voice recognition and focuses the numeric field so typing can begin.


## V2-13
- Tab 4 now supports SellerChamp UPC search.
- Tab 4 now supports full/partial SellerChamp title search.
- When UPC/title search returns multiple products, the app shows SKU, title, UPC, condition and item remarks so the correct product can be selected.
- Selecting a result loads the same Add Direct inventory report and quantity-adjustment controls as SKU search.


## V2-14
- Reworked Tab 4 title search so it no longer depends on SellerChamp accepting a `title=` filter. It searches catalog pages and matches all entered title words case-insensitively.
- SKU, UPC, and Title results now report marketplace item Status (ACTIVE/INACTIVE when SellerChamp supplies it).
- Multiple title/UPC choices also display status before selection.


## V2-15
- Tab 4 now shows an **Activate Item** button whenever the selected product's SellerChamp marketplace status is not active.
- Activation uses the same SellerChamp product relist endpoint already used by the Returns processing workflow.
- Requires confirmation, then refreshes the product and displays SellerChamp's current status.


## V2-20
- Rolled Tab 2 normal-inventory write logic back to the known-working V2-15 implementation.
- Removed the V2-17/V2-18/V2-19 Master Product/Catalog inventory experiments from this build.
- Added zero-quantity old-location cleanup as a separate post-write step only when the location was changed. Cleanup failure does not undo or block the inventory update.
- Corrected the relist request while retaining the V2-15 archive flow.
- Added visible V2-20 version at the top of the app.


## V2-21
- Found a concrete regression introduced after V2-15: once a return was marked `inventory_added_pending_listing`, pressing Add to Inventory again returned early and never sent another SellerChamp inventory update.
- Removed that silent skip so the existing stuck return can actually be retried.
- Added before/after verification: the app records SellerChamp's quantity before the write, adds the return quantity, reads SellerChamp again, and requires the new quantity to equal `before + added`.
- If SellerChamp does not reflect the expected change, the app shows the exact before/added/expected/actual quantities and leaves the return in Process Returns.
- Visible version updated to V2-21.


## V2-22
- Preserves V2-21's confirmed-working Add to Inventory code unchanged.
- Zero-quantity location cleanup now happens only AFTER SellerChamp has confirmed the inventory quantity changed correctly.
- All other locations with quantity exactly 0 are removed; the destination location is always preserved and any location with quantity above 0 is never touched.
- Cleanup first attempts an explicit inventory-location DELETE, with `delete_if_empty=true` as a fallback.
- The Process Returns result reports which zero-quantity locations were removed and any that SellerChamp would not remove.


## V2-23
- Preserves the V2-21/V2-22 confirmed-working return inventory update.
- Zero-location cleanup now first uses SellerChamp's documented `PUT /api/inventory_locations/bulk_update` endpoint with the existing inventory-location IDs and `delete_if_empty: true`.
- If an already-zero location remains, the cleanup sets that location to quantity 1 with `delete_if_empty: true`, then sets it back to 0 so the location actually *reaches* zero while deletion-on-empty is enabled.
- The destination location and every location with non-zero stock are excluded from cleanup.
- The app verifies each target location is gone afterward and reports any location SellerChamp still would not remove.


## V2-24
- Reports the exact zero-location cleanup method that succeeded for each location.
- Displays `Removed [location] using Bulk Update`, `Removed [location] using 1 → 0 Delete-if-Empty`, or `Could not remove [location] — neither method worked`.
- Inventory-add behavior remains unchanged from the confirmed-working V2-21 path.


## V2-25
- Stopped attempting to remove old zero-quantity inventory locations.
- After a successful return inventory update, each other location whose quantity is exactly 0 is simply updated with `delete_if_empty: true`.
- No 1 → 0 quantity manipulation and no bulk/delete attempt.
- The app reports each zero location whose delete-if-empty setting was updated.
- Confirmed-working V2-21 inventory-add path remains unchanged.


## V2-26
- Focused fix for `Activate eBay Item & Archive Return`.
- Activation no longer sends `quantity_available` in the product relist payload, avoiding an inventory overwrite/conflict.
- After the relist request, the server rechecks SellerChamp status up to four times.
- The return archives only after SellerChamp reports the item ACTIVE.
- If SellerChamp still reports inactive/pending/unknown, the return remains in Process Returns and the exact status is shown.
- V2-25 zero-location behavior remains unchanged.


## V2-27
- Activation-only change; working inventory and zero-location behavior are untouched.
- Fetches the complete SellerChamp product immediately before activation and preserves its writable listing data in the relist update rather than sending a hand-built partial product.
- Removes obvious read-only/inventory fields from the relist payload so activation cannot overwrite the inventory quantity.
- Captures SellerChamp API rejection text and the relist response in the return history for diagnosis.
- Rechecks status six times (about 7.5 seconds total) and archives only after SellerChamp reports ACTIVE.
- Visible version updated to V2-27.


## V2-28
- Changed only the eBay activation/relist operation.
- Uses SellerChamp's documented `PUT /api/products/bulk_update` request with `relist: true`.
- Identifies the product by its exact SellerChamp product ID, avoiding SKU/account ambiguity.
- Sends no inventory or listing-field changes with the relist request.
- Rechecks SellerChamp status up to eight times and archives only after ACTIVE is confirmed.
- Working inventory and delete_if_empty behavior remain unchanged.


## V2-29
- Corrected activation completion logic based on SellerChamp's own UI behavior: relisting is queued and SellerChamp says it may take a few minutes.
- Keeps the documented bulk relist request (`relist: true`) from V2-28.
- A successful SellerChamp API response now means the relist request was accepted/queued; the return is archived immediately after that successful response instead of incorrectly requiring marketplace status to become ACTIVE within seconds.
- If SellerChamp rejects the relist API request, the return remains in Process Returns.
- The success message clearly says relisting may take a few minutes and shows the immediate status for reference.
- Inventory and delete_if_empty behavior are unchanged.


## V2-30
- After `Activate eBay Item & Archive Return` succeeds and archives the return, the app opens Signal for the employee at +1 501-538-6504.
- Prefills: `Check in 30 minutes to see if this (SKU-[SKU]) is active on eBay. If it is not, relist it.`
- Signal is opened only after SellerChamp accepts the relist request and the return has been archived.
- The user still taps Send in Signal.


## V2-31
- Fixed `Can't find variable: returnsCache` when activating and archiving.
- The client no longer depends on a nonexistent `returnsCache` variable.
- The server returns the archived return's SKU with the successful relist response, so the Signal message always has the SKU.
- Relist, archive, inventory, and delete_if_empty behavior otherwise remain unchanged.
