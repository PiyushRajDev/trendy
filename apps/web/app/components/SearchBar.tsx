'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';

export function SearchBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  useEffect(() => {
    setQ(params.get('q') ?? '');
  }, [params]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sp = new URLSearchParams(params.toString());
    if (q) sp.set('q', q); else sp.delete('q');
    router.push(`/?${sp}`);
  };

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        placeholder="Search kurta, saree, shoes..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <button type="submit" className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
        Search
      </button>
    </form>
  );
}
