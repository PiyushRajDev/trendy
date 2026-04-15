'use client';
import { useEffect, useState } from 'react';
import { getRecommendations } from '../lib/api';
import { getUserId } from '../lib/user-id';
import { ProductCard } from './ProductCard';

export function Recommendations({ title = 'You May Also Like' }: { title?: string }) {
  const [products, setProducts] = useState<any[]>([]);

  useEffect(() => {
    const userId = getUserId();
    getRecommendations(userId).then((res) => setProducts(res.data ?? []));
  }, []);

  if (!products.length) return null;

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {products.slice(0, 8).map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
}
