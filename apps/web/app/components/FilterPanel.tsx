'use client';
import { useRouter, useSearchParams } from 'next/navigation';

const CATEGORIES = ['Ethnic Wear', 'Casual Wear', 'Footwear', 'Accessories', 'Sportswear'];
const SORTS = [
  { value: 'relevance',  label: 'Relevance' },
  { value: 'price_asc',  label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'popularity', label: 'Popularity' },
];

export function FilterPanel() {
  const router = useRouter();
  const params = useSearchParams();

  const set = (key: string, value: string) => {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set(key, value); else sp.delete(key);
    router.push(`/?${sp}`);
  };

  return (
    <aside className="w-56 shrink-0 space-y-4">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Sort By</p>
        {SORTS.map((s) => (
          <label key={s.value} className="flex items-center gap-2 text-sm cursor-pointer py-1">
            <input type="radio" name="sort" value={s.value}
              checked={(params.get('sort') ?? 'relevance') === s.value}
              onChange={() => set('sort', s.value)} />
            {s.label}
          </label>
        ))}
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Category</p>
        {CATEGORIES.map((c) => (
          <label key={c} className="flex items-center gap-2 text-sm cursor-pointer py-1">
            <input type="checkbox" checked={params.get('category') === c}
              onChange={(e) => set('category', e.target.checked ? c : '')} />
            {c}
          </label>
        ))}
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Price Range</p>
        <div className="flex gap-2">
          <input type="number" placeholder="Min" className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
            value={params.get('minPrice') ?? ''}
            onChange={(e) => set('minPrice', e.target.value)} />
          <input type="number" placeholder="Max" className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
            value={params.get('maxPrice') ?? ''}
            onChange={(e) => set('maxPrice', e.target.value)} />
        </div>
      </div>
    </aside>
  );
}
