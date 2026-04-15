'use client';
import { useEffect } from 'react';
import { trackEvent } from '../../lib/api';
import { getUserId } from '../../lib/user-id';

export function TrackView({ productId }: { productId: string }) {
  useEffect(() => {
    trackEvent({
      event_id:   crypto.randomUUID(),
      user_id:    getUserId(),
      product_id: productId,
      event_type: 'product_view',
      metadata:   { source: 'direct' },
    });
  }, [productId]);

  return null;
}
