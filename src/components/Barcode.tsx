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
  marginTop?: number
  marginBottom?: number
  marginLeft?: number
  marginRight?: number
  className?: string
  style?: React.CSSProperties
  format?: 'CODE128' | 'CODE39'
}

export default function Barcode({
  value,
  width = 2,
  height = 40,
  fontSize = 10,
  displayValue = true,
  text,
  margin = 10,
  marginTop,
  marginBottom,
  marginLeft,
  marginRight,
  className,
  style,
  format = 'CODE128',
}: BarcodeProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const el = svgRef.current
    if (!el || !value) return
    try {
      while (el.firstChild) el.removeChild(el.firstChild)
      JsBarcode(el, value, {
        format,
        width,
        height,
        displayValue,
        text,
        fontSize,
        margin,
        marginTop,
        marginBottom,
        marginLeft,
        marginRight,
        background: '#ffffff',
        lineColor: '#000000',
        valid: (valid: boolean) => {
          if (!valid) console.warn('Invalid barcode value:', value)
        },
      })
    } catch {
      // Invalid value — leave SVG empty
    }
  }, [value, width, height, fontSize, displayValue, format, margin, marginTop, marginBottom, marginLeft, marginRight])

  return (
    <svg
      ref={svgRef}
      className={className}
      style={{
        ...style,
        shapeRendering: 'crispEdges',
        display: 'block',
        maxWidth: '100%',
        height: 'auto',
      }}
      role="img"
      aria-label={`Barcode ${value}`}
    />
  )
}
