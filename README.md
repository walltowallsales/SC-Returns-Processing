# SellerChamp Returns App

Mobile-friendly front-of-house return intake plus back-of-house return processing.

## Features
- Search SellerChamp by eBay order number. On phones, the order field requests the numeric keyboard and adds hyphens automatically.
- Pull order, SKU, product, marketplace, and inventory-location information.
- Front of house records what they physically observe, up to 6 photos, notes, and chooses the disposition.
- Printable PDF traveler with photos, notes, selected disposition, and a very large item location.
- Back-of-house queue sorted by item location, with saved instructions/photos and PDF reprint.
- Option 1: add quantity back to normal inventory.
- Option 2: add quantity to inventory and increase SellerChamp `reserve_quantity`.
- Option 3: create a separate SellerChamp/eBay listing using a one-item manifest and auto-submit it.

## Render setup
1. Upload this complete package to a GitHub repository.
2. In Render, create a **Blueprint** from that repository. `render.yaml` creates the web service and persistent disk.
3. Set these environment variables:
   - `SELLERCHAMP_API_TOKEN` — required.
   - `APP_PIN` — optional.
   - `RETURN_APP_BASE_URL` — your final Render URL, e.g. `https://sellerchamp-returns.onrender.com`.
   - `SC_SHIP_FROM_ADDRESS_ID` — required for Option 3.
   - `SC_EBAY_TEMPLATE_ID` — required for Option 3.
4. Deploy.

## Option 3 caution
SellerChamp manifest creation requires the ship-from address and eBay template IDs. The app uses the marketplace account from the original order and sets `auto_submit: true`. Test this path on one low-risk item first because your eBay template can have account-specific required fields.

## Persistent data
The Blueprint mounts `/var/data`. Return records and uploaded photos are stored there so redeploying the app does not wipe them.
