import { Suspense } from 'react';
import { searchProducts } from './lib/api';
import { SearchBar } from './components/SearchBar';
import { FilterPanel } from './components/FilterPanel';
import { ProductCard } from './components/ProductCard';

interface PageProps {
  searchParams: Promise<{
    q?: string; category?: string; brand?: string;
    minPrice?: string; maxPrice?: string; sort?: string; page?: string;
  }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const result = await searchProducts({
    q:        sp.q,
    category: sp.category,
    brand:    sp.brand,
    minPrice: sp.minPrice && !isNaN(Number(sp.minPrice)) ? Number(sp.minPrice) : undefined,
    maxPrice: sp.maxPrice && !isNaN(Number(sp.maxPrice)) ? Number(sp.maxPrice) : undefined,
    sort:     sp.sort,
  });

  const products: any[] = result.data ?? [];
  const total: number   = result.meta?.total ?? 0;

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">StyleSense</h1>
        <p className="text-gray-500 text-sm">Fashion Recommendation &amp; Search Engine</p>
      </div>

      <Suspense>
        <SearchBar />
      </Suspense>

      <div className="mt-6 flex gap-8">
        <Suspense>
          <FilterPanel />
        </Suspense>

        <div className="flex-1">
          <p className="text-sm text-gray-500 mb-4">{total} results</p>
          {products.length === 0 ? (
            <p className="text-gray-400 text-center py-20">No products found. Try a different search.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {products.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
