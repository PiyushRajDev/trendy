import Link from 'next/link';

export function ProductCard({ product }: { product: any }) {
  const minPrice = product.variants?.length
    ? Math.min(...product.variants.map((v: any) => Number(v.price)))
    : null;

  return (
    <Link href={`/products/${product.id}`} className="group block rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="bg-gray-100 h-48 flex items-center justify-center text-gray-400 text-sm">
        {product.image_url
          ? <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
          : 'No image'}
      </div>
      <div className="p-3">
        <p className="text-xs text-gray-500 uppercase tracking-wide">{product.brand}</p>
        <p className="font-medium text-gray-900 text-sm mt-0.5 line-clamp-2">{product.name}</p>
        {minPrice !== null && (
          <p className="mt-1 text-indigo-600 font-semibold">₹{minPrice.toLocaleString('en-IN')}</p>
        )}
        <div className="mt-1 flex gap-1 flex-wrap">
          {product.tags?.slice(0, 3).map((t: string) => (
            <span key={t} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{t}</span>
          ))}
        </div>
      </div>
    </Link>
  );
}
