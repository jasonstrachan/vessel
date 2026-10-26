'use client';

import React from 'react';

import { useAppStore, type AppState } from '@/stores/useAppStore';

const selectNotification = (state: AppState) => {
  const notifications = state.ui?.notifications;
  return notifications?.find((notification) => notification.title === 'History recovery failed')
    ?? notifications?.find((notification) => notification.type === 'warning' || notification.type === 'error');
};

export function AppNotifications() {
  const notification = useAppStore(selectNotification);
  const removeNotification = useAppStore((state) => state.removeNotification);
  if (!notification) return null;

  const isHistoryRecoveryFailure = notification.title === 'History recovery failed';
  return (
    <div
      role="alert"
      className="fixed left-1/2 top-5 z-[100] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 border border-red-400 bg-[#2a1111] px-4 py-3 text-sm text-[#ffe5e5] shadow-lg"
    >
      {!isHistoryRecoveryFailure && (
        <button
          type="button"
          aria-label="Dismiss notification"
          className="float-right ml-3 h-6 w-6 border border-current hover:bg-white/10"
          onClick={() => removeNotification(notification.id)}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
      <div className="font-semibold">{notification.title}</div>
      <div className="mt-1">{notification.message}</div>
    </div>
  );
}
