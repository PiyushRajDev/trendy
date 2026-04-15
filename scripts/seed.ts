// scripts/seed.ts
const API = 'http://localhost:3000';

const products = [
  { name: 'Anarkali Kurta Set', brand: 'Biba', category: 'Ethnic Wear', tags: ['cotton', 'festive', 'printed'], image_url: null,
    variants: [{ sku_code: 'AK-S-RED', size: 'S', color: 'Red', price: '1299.00', stock: 30 }, { sku_code: 'AK-M-RED', size: 'M', color: 'Red', price: '1299.00', stock: 20 }] },
  { name: 'Classic White Sneakers', brand: 'Puma', category: 'Footwear', tags: ['casual', 'leather', 'everyday'], image_url: null,
    variants: [{ sku_code: 'CWS-42', size: '42', color: 'White', price: '2499.00', stock: 15 }] },
  { name: 'Slim Fit Chinos', brand: 'Marks & Spencer', category: 'Casual Wear', tags: ['stretch', 'office'], image_url: null,
    variants: [{ sku_code: 'SFC-32-KHA', size: '32', color: 'Khaki', price: '1799.00', stock: 40 }, { sku_code: 'SFC-34-KHA', size: '34', color: 'Khaki', price: '1799.00', stock: 25 }] },
  { name: 'Floral Maxi Dress', brand: 'W', category: 'Casual Wear', tags: ['summer', 'floral', 'rayon'], image_url: null,
    variants: [{ sku_code: 'FMD-M-BLU', size: 'M', color: 'Blue', price: '1599.00', stock: 18 }] },
  { name: 'Leather Handbag', brand: 'Baggit', category: 'Accessories', tags: ['vegan', 'office', 'tote'], image_url: null,
    variants: [{ sku_code: 'LHB-BRN', color: 'Brown', price: '1999.00', stock: 12 }] },
  { name: 'Sports Running Shoes', brand: 'Nike', category: 'Footwear', tags: ['running', 'mesh', 'cushioned'], image_url: null,
    variants: [{ sku_code: 'SRS-41-BLK', size: '41', color: 'Black', price: '3499.00', stock: 22 }, { sku_code: 'SRS-43-BLK', size: '43', color: 'Black', price: '3499.00', stock: 10 }] },
  { name: 'Silk Saree', brand: 'Nalli', category: 'Ethnic Wear', tags: ['silk', 'wedding', 'traditional'], image_url: null,
    variants: [{ sku_code: 'SS-GOLD', color: 'Gold', price: '8999.00', stock: 5 }] },
  { name: 'Yoga Pants', brand: 'Decathlon', category: 'Sportswear', tags: ['flex', 'gym', 'moisture-wicking'], image_url: null,
    variants: [{ sku_code: 'YP-S-BLK', size: 'S', color: 'Black', price: '799.00', stock: 60 }, { sku_code: 'YP-M-BLK', size: 'M', color: 'Black', price: '799.00', stock: 50 }] },
];

async function seed() {
  console.log('Seeding products...');
  for (const p of products) {
    const res = await fetch(`${API}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    const data = await res.json() as any;
    console.log(`  ✓ ${data.data?.name ?? JSON.stringify(data)}`);
  }

  // Trigger reindex
  await fetch(`${API}/search/reindex`, { method: 'POST' });
  console.log('Reindexed all products in Elasticsearch.');
  console.log('Done! Visit http://localhost:3001');
}

seed().catch(console.error);
