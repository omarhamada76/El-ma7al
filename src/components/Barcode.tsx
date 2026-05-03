import JsBarcode from 'jsbarcode'
import { useEffect, useRef } from 'react'

export interface BarcodeProps {
  value: string
  /** Bar width multiplier */
  width?: number
  /** Bar height in px */
  height?: number
  /** Text below barcode (JsBarcode `fontSize`) */
  fontSize?: number
  displayValue?: boolean
  /** Custom text to display instead of the value */
  text?: string
  /** Quiet zone margin in px */
  margin?: number
  className?: string
  style?: React.CSSProperties
}

export default function Barcode({
  value,
  width = 2,
  height = 40,
  fontSize = 10,
  displayValue = true,
  text,
  margin = 10,
  className,
  style,
}: BarcodeProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const el = svgRef.current
    if (!el || !value) return
    try {
      while (el.firstChild) el.removeChild(el.firstChild)
      JsBarcode(el, value, {
        format: 'CODE128',
        width,
        height,
        displayValue,
        text,
        fontSize,
        margin,
        background: '#ffffff',
        lineColor: '#000000',
      })
    } catch {
      // Invalid value for Code128 — leave SVG empty
    }
  }, [value, width, height, fontSize, displayValue])

  return (
    <svg
      ref={svgRef}
      className={className}
      style={style}
      role="img"
      aria-label={`Barcode ${value}`}
    />
  )
}
