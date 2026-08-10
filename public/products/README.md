# Product photography

Drop a file here named after the product's **SKU** and the till tile picks it up
on the next load. No code change, no catalog edit, no deploy step beyond the file
itself.

```
public/products/SG-0101.jpg     → Mama Gold Rice 5kg
public/products/SG-0207.jpg     → Peak Milk 400g
```

The SKU is shown on the shelf label and in HQ → Master catalog.

## What to supply

| | |
|---|---|
| Format | `.jpg` (photographs) — smaller than PNG at the same quality |
| Aspect | **4:3 landscape.** The tile crops to 4:3, so anything else loses its edges |
| Size | 640×480 is plenty. The tile renders around 220px wide on a 10" till |
| Weight | Under 60 KB each. A till pulls the whole grid over branch wi-fi |
| Background | Plain and light. The tile sits on white, and a busy background reads as clutter at arm's length |

## When there is no file

The tile renders no picture at all and gives the space back to the name and the
price. That is deliberate — see the note in `src/components/shared/product-image.tsx`.
A missing file is the normal case, not an error, and nothing is logged.

## A product with a photo somewhere else

Set `imageUrl` on the product to an absolute URL and it wins over the file here.
That is the path the real catalog service will use once it exists.

## Where the shipped photos came from

Twelve products carry a real photograph and the manufacturer's real barcode,
pulled from [Open Food Facts](https://world.openfoodfacts.org) — an open food
database. Product data is ODbL; **product images are CC-BY-SA**, so keep that
attribution if these ship beyond a demo, or replace them with Swiftgrocers'
own photography.

Because those barcodes are real, a physical pack of Golden Penny Spaghetti,
Coca-Cola 50cl, Peak Milk, Maltina, Gala or Devon King's oil scans against this
build and resolves.

One upstream code (`0154000424008`, Garri Ijebu) was rejected: it does not pass
the EAN-13 checksum. Open Food Facts is user-contributed and occasionally wrong,
and a bad code in the index resolves a real scan to the wrong product.
