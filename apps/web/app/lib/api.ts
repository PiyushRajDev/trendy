const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function searchProducts(params: {
  q?: string; category?: string; brand?: string;
  minPrice?: number; maxPrice?: number; sort?: string; page?: number;
}) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  });
  const res = await fetch(`${API_URL}/search?${sp}`, { cache: 'no-store' });
  if (!res.ok) return { data: [], meta: { total: 0 } };
  return res.json();
}

export async function getProduct(id: string) {
  const res = await fetch(`${API_URL}/products/${id}`, { next: { revalidate: 60 } });
  if (!res.ok) return null;
  return res.json();
}

export async function getRecommendations(userId: string) {
  const res = await fetch(`${API_URL}/recommendations/${userId}`, { cache: 'no-store' });
  if (!res.ok) return { data: [] };
  return res.json();
}

export async function trackEvent(event: {
  event_id: string; user_id: string; product_id: string;
  event_type: string; metadata: { source: string };
}) {
  await fetch(`${API_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...event, timestamp: new Date().toISOString() }),
  }).catch(() => {});  // fire-and-forget, never block UI
}
