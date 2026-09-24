;; Adapter-shaped variant of native-eh-cross-call.wat. Its export type matches
;; the command runtime's porffor_program.main import, isolating EH packaging.
(module
  (tag $js_throw (param i64))

  (func $thrower
    (throw $js_throw (i64.const 42)))

  (func (export "main")
    (drop
      (block $caught (result i64)
        (try_table (result i64) (catch $js_throw $caught)
          (call $thrower)
          (i64.const 0))))))
