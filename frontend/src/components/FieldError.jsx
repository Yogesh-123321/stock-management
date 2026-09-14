/*
  Small shared "this field is invalid" line, used under any input across
  the app together with lib/useFormValidation.js. Renders nothing when
  there's no error so it's always safe to drop in unconditionally.
*/
export default function FieldError({ error }) {
  if (!error) return null;
  return <p className="text-xs text-destructive mt-1">{error}</p>;
}