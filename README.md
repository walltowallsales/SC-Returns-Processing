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
