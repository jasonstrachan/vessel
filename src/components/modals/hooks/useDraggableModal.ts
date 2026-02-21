import { useCallback, useEffect, useRef, useState } from 'react';

export function useDraggableModal() {
  const [modalDimensions, setModalDimensions] = useState({ width: 1120, height: 820 });
  const [modalPosition, setModalPosition] = useState({ x: 0, y: 0 });
  const [isDraggingModal, setIsDraggingModal] = useState(false);
  const modalDragOffsetRef = useRef({ x: 0, y: 0 });

  const centerModal = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const width = Math.min(960, window.innerWidth - 32);
    const height = Math.min(Math.round(window.innerHeight * 0.8), window.innerHeight - 32);
    setModalDimensions({ width, height });
    setModalPosition({
      x: Math.max(16, Math.round((window.innerWidth - width) / 2)),
      y: Math.max(16, Math.round((window.innerHeight - height) / 2)),
    });
  }, []);

  const clampModalToViewport = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const width = Math.min(960, window.innerWidth - 32);
    const height = Math.min(Math.round(window.innerHeight * 0.8), window.innerHeight - 32);
    setModalDimensions({ width, height });
    setModalPosition((prev) => {
      const maxX = Math.max(16, window.innerWidth - width - 16);
      const maxY = Math.max(16, window.innerHeight - height - 16);
      return {
        x: Math.min(Math.max(16, prev.x), maxX),
        y: Math.min(Math.max(16, prev.y), maxY),
      };
    });
  }, []);

  const resetDrag = useCallback(() => {
    setIsDraggingModal(false);
  }, []);

  const handleModalDragStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    modalDragOffsetRef.current = {
      x: event.clientX - modalPosition.x,
      y: event.clientY - modalPosition.y,
    };
    setIsDraggingModal(true);
  }, [modalPosition.x, modalPosition.y]);

  useEffect(() => {
    if (!isDraggingModal) {
      return;
    }
    const handleMouseMove = (event: MouseEvent) => {
      const width = modalDimensions.width;
      const height = modalDimensions.height;
      const maxX = Math.max(16, window.innerWidth - width - 16);
      const maxY = Math.max(16, window.innerHeight - height - 16);
      const nextX = Math.min(Math.max(16, event.clientX - modalDragOffsetRef.current.x), maxX);
      const nextY = Math.min(Math.max(16, event.clientY - modalDragOffsetRef.current.y), maxY);
      setModalPosition({ x: nextX, y: nextY });
    };
    const handleMouseUp = () => {
      setIsDraggingModal(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingModal, modalDimensions.height, modalDimensions.width]);

  return {
    modalDimensions,
    modalPosition,
    isDraggingModal,
    centerModal,
    clampModalToViewport,
    handleModalDragStart,
    resetDrag,
  };
}

