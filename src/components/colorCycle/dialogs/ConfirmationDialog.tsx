/**
 * ConfirmationDialog - Modal for confirming destructive actions
 */

import React from 'react';

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'warning',
  onConfirm,
  onCancel
}) => {
  if (!isOpen) {
    return null;
  }

  const variantStyles = {
    danger: {
      icon: '⚠️',
      confirmButton: 'bg-red-600 hover:bg-red-700 text-white',
      border: 'border-red-500'
    },
    warning: {
      icon: '⚠️',
      confirmButton: 'bg-yellow-600 hover:bg-yellow-700 text-white',
      border: 'border-yellow-500'
    },
    info: {
      icon: 'ℹ️',
      confirmButton: 'bg-blue-600 hover:bg-blue-700 text-white',
      border: 'border-blue-500'
    }
  };

  const style = variantStyles[variant];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 animate-fadeIn">
      <div className="bg-gray-800 rounded-lg border border-gray-600 w-96 max-w-full mx-4 animate-scaleIn">
        {/* Header */}
        <div className={`flex items-center gap-3 p-4 border-b ${style.border} bg-opacity-10`}>
          <span className="text-xl">{style.icon}</span>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-gray-300 text-sm leading-relaxed">
            {message}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 p-4 border-t border-gray-600">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 text-gray-300 hover:text-white border border-gray-600 hover:border-gray-500 rounded-lg transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 px-4 py-2 font-medium rounded-lg transition-colors ${style.confirmButton}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};