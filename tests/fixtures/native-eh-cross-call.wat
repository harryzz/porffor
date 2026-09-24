;; Minimal native Wasm EH probe: propagate an i64 JS-value-shaped payload
;; across a call and catch it in the caller using the standardized EH form.
(module
  (tag $js_throw (param i64))

  (func $thrower
    (throw $js_throw (i64.const 42)))

  (func (export "main") (result i64)
    (block $caught (result i64)
      (try_table (result i64) (catch $js_throw $caught)
        (call $thrower)
        (i64.const 0)))))
