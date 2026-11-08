/** The "go" affordance: a drawn chevron in the product's own stroke, never a text arrow. */
export function Chevron() {
  return (
    <svg className="go" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}
