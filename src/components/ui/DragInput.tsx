'use client'

import { useState, useRef, useCallback } from 'react'

interface DragInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
  placeholder?: string
}

export default function DragInput({ 
  value, 
  onChange, 
  min = 0, 
  max = 100, 
  step = 1,
  className = "",
  placeholder 
}: DragInputProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragStartY, setDragStartY] = useState(0)
  const [dragStartValue, setDragStartValue] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Focus the input first
    if (inputRef.current) {
      inputRef.current.focus()
    }
    
    // Start dragging immediately
    const startY = e.clientY
    const startValue = value
    setIsDragging(true)
    setDragStartY(startY)
    setDragStartValue(startValue)
    e.preventDefault()
    
    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startY - e.clientY
      // Reduce sensitivity by dividing deltaY by 3 for finer control
      const newValue = Math.max(min, Math.min(max, startValue + (deltaY / 3) * step))
      onChange(Math.round(newValue / step) * step)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [value, min, max, step, onChange])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value)
    if (!isNaN(newValue)) {
      onChange(Math.max(min, Math.min(max, newValue)))
    }
  }

  return (
    <input
      ref={inputRef}
      type="number"
      value={value}
      onChange={handleInputChange}
      onMouseDown={handleMouseDown}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      className={className}
      style={{ cursor: isDragging ? 'ns-resize' : 'ns-resize' }}
    />
  )
}