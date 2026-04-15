'use client';

export function getUserId(): string {
  if (typeof window === 'undefined') return 'anonymous';
  let id = localStorage.getItem('ss-user-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('ss-user-id', id);
  }
  return id;
}
