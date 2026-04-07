declare module 'jsbarcode' {
  function JsBarcode(
    element: SVGSVGElement | HTMLElement | string,
    value: string,
    options?: Record<string, unknown>
  ): void
  export default JsBarcode
}
