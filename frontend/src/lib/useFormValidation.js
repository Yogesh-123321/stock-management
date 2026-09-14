import { useCallback, useState } from "react";
import { validateForm, validateValue, hasErrors } from "@/lib/validators";

/*
  Shared validation hook for form components. Give it a schema (see
  validators.js#validateValue for the rule shape) and it hands back:

    - errors:            { field: message } for fields currently invalid
    - touched:            { field: true } for fields the user has left
    - validateField(name, value, form): validates one field, updates state
    - handleBlur(name, value, form):    same, meant for onBlur
    - validateAll(form):  validates everything, marks all touched,
                           returns true when the form is valid
    - fieldError(name):   error to show, or null while a field is untouched
    - reset():             clears errors/touched (e.g. after a successful submit)

  Usage:
    const schema = {
      companyName: { required: true, regex: "companyName" },
      email: { regex: "email" },
    };
    const v = useFormValidation(schema);
    ...
    <Input onBlur={() => v.handleBlur("email", form.email, form)} .../>
    <FieldError error={v.fieldError("email")} />
    ...
    const submit = (e) => {
      e.preventDefault();
      if (!v.validateAll(form)) return;
      ...
    };
*/
export function useFormValidation(schema) {
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  const validateField = useCallback(
    (name, value, form) => {
      const rule = schema[name];
      const err = validateValue(value, rule, form);
      setErrors((prev) => ({ ...prev, [name]: err }));
      return err;
    },
    [schema]
  );

  const handleBlur = useCallback(
    (name, value, form) => {
      setTouched((prev) => ({ ...prev, [name]: true }));
      validateField(name, value, form);
    },
    [validateField]
  );

  const validateAll = useCallback(
    (form) => {
      const next = validateForm(form, schema);
      setErrors(next);
      setTouched(Object.fromEntries(Object.keys(schema).map((k) => [k, true])));
      return !hasErrors(next);
    },
    [schema]
  );

  const fieldError = useCallback((name) => (touched[name] ? errors[name] || null : null), [touched, errors]);

  const setFieldError = useCallback((name, message) => {
    setErrors((prev) => ({ ...prev, [name]: message }));
    setTouched((prev) => ({ ...prev, [name]: true }));
  }, []);

  const reset = useCallback(() => {
    setErrors({});
    setTouched({});
  }, []);

  return { errors, touched, validateField, handleBlur, validateAll, fieldError, setFieldError, reset };
}