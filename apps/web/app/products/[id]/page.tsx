import { notFound } from 'next/navigation';
import { getProduct } from '../../lib/api';
import { Recommendations } from '../../components/Recommendations';
import { TrackView } from './TrackView';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getProduct(id);
  if (!res?.data) return notFound();
  const product = res.data;

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <TrackView productId={product.id} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-gray-100 rounded-xl h-96 flex items-center justify-center text-gray-400">
          {product.image_url
            ? <img src={product.image_url} alt={product.name} className="h-full w-full object-cover rounded-xl" />
            : 'No image'}
        </div>

        <div>
          <p className="text-sm text-gray-500 uppercase tracking-wide">{product.brand}</p>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{product.name}</h1>
          <p className="text-sm text-gray-500 mt-1">{product.category}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {product.tags?.map((t: string) => (
              <span key={t} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full">{t}</span>
            ))}
          </div>

          {product.variants?.length > 0 && (
            <div className="mt-6">
              <p className="text-sm font-medium text-gray-700 mb-2">Available variants</p>
              <div className="space-y-2">
                {product.variants.map((v: any) => (
                  <div key={v.id} className="flex justify-between items-center border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <span className="text-gray-700">{v.size && `Size ${v.size}`}{v.color && ` · ${v.color}`}</span>
                    <span className="font-semibold text-indigo-600">₹{Number(v.price).toLocaleString('en-IN')}</span>
                    <span className={v.stock > 0 ? 'text-green-600' : 'text-red-500'}>
                      {v.stock > 0 ? `${v.stock} left` : 'Out of stock'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Recommendations title="You May Also Like" />
    </main>
  );
}
