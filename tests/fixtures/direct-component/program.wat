(module
  (type $print_type (func (param f64)))
  (import "porffor:internal/runtime@0.1.0" "print-number" (func $print (type $print_type)))
  (tag $js_throw (param i64))
  (func $thrower (throw $js_throw (i64.const 42)))
  (func $main
    (call $print
      (f64.convert_i64_s
        (block $caught (result i64)
          (try_table (result i64) (catch $js_throw $caught)
            (call $thrower)
            (i64.const 0))))))
  (func (export "porffor:internal/api@0.1.0#main") (call $main))
  (func (export "cabi_post_porffor:internal/api@0.1.0#main"))
  (memory (export "memory") 1)
  (func (export "cabi_realloc") (param i32 i32 i32 i32) (result i32) i32.const 0)
  (func (export "_initialize")))
