// AAA clones some RTPHK SKUs with "-A" added (NR132911RP75 → NR132911RP75-A);
// both count as the same SKU. Pure — used on the server and in the browser.
export const baseSku = (sku: string) => sku.trim().replace(/-A$/i, '');
export const skuVariants = (sku: string) => [baseSku(sku), `${baseSku(sku)}-A`];
// Key for looking a SKU up across companies: the base SKU, upper case.
export const skuKey = (sku: string) => baseSku(sku).toUpperCase();
