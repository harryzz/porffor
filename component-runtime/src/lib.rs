//! Fixed WASI command host, built separately from the directly emitted program.
use std::cell::RefCell;

const STRING_HEAP_BYTES: usize = 4 * 1024 * 1024;
const MAX_OUTPUT: usize = 16 * 1024 * 1024;
thread_local! {
    static OUTPUT: RefCell<(Vec<u8>, bool)> = const { RefCell::new((Vec::new(), false)) };
    static STRING_HEAP: RefCell<Option<Vec<u64>>> = const { RefCell::new(None) };
    static ARGUMENTS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

// Component builds declare the internal program call as WIT so the component
// linker can describe it. Bare Wasm object builds use a symbol resolved by wasm-ld.
#[cfg(all(any(target_env = "p2", target_env = "p3"), not(feature = "static-link")))]
wit_bindgen::generate!({
    inline: r#"
        package porffor:internal@0.1.0;
        interface api {
            main: func();
        }
        world runtime-driver {
            import api;
        }
    "#,
});
#[cfg(feature = "static-link")]
unsafe extern "C" { fn main(); }
#[cfg(all(not(feature = "static-link"), not(any(target_env = "p2", target_env = "p3"))))]
#[link(wasm_import_module = "porffor_program")]
unsafe extern "C" { fn main(); }

fn append(bytes: &[u8]) {
    OUTPUT.with_borrow_mut(|(output, overflow)| {
        if output.len() + bytes.len() > MAX_OUTPUT { *overflow = true; }
        if !*overflow { output.extend_from_slice(bytes); }
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn print_number(n: f64) {
    let mut buffer = ryu_js::Buffer::new();
    // console.log distinguishes -0 although Number.prototype.toString does not.
    let text = if n == 0.0 && n.is_sign_negative() { "-0" } else { buffer.format(n) };
    append(text.as_bytes());
    append(b"\n");
}

#[unsafe(no_mangle)]
pub extern "C" fn print_boolean(value: i32) {
    append(if value != 0 { b"true\n" } else { b"false\n" });
}

#[unsafe(no_mangle)]
pub extern "C" fn print_null() { append(b"null\n"); }

#[unsafe(no_mangle)]
pub extern "C" fn print_undefined() { append(b"undefined\n"); }

// A disjoint, aligned, instance-owned region. Never resized or reclaimed while
// the component lives; the emitted program owns object layout and allocation.
#[unsafe(no_mangle)]
pub extern "C" fn string_heap_base() -> u32 {
    STRING_HEAP.with_borrow_mut(|slot| {
        if slot.is_none() {
            let mut heap = Vec::<u64>::new();
            if heap.try_reserve_exact(STRING_HEAP_BYTES / 8).is_err() {
                core::arch::wasm32::unreachable();
            }
            heap.resize(STRING_HEAP_BYTES / 8, 0);
            *slot = Some(heap);
        }
        slot.as_ref().unwrap().as_ptr() as u32
    })
}

fn string_units<T>(pointer: u32, length: u32, f: impl FnOnce(&mut [u16]) -> T) -> T {
    STRING_HEAP.with_borrow_mut(|slot| {
        let heap = slot.as_mut().unwrap_or_else(|| core::arch::wasm32::unreachable());
        let base = heap.as_ptr() as usize;
        let pointer = pointer as usize;
        if pointer < base || pointer % 2 != 0 || length as u64 * 2 + pointer as u64 > (base + STRING_HEAP_BYTES) as u64 {
            core::arch::wasm32::unreachable();
        }
        // Bounds/alignment checked against the dedicated allocation, not arbitrary
        // runtime/canonical-ABI memory. No untrusted boxed-value decoding here.
        let units = unsafe { core::slice::from_raw_parts_mut(pointer as *mut u16, length as usize) };
        f(units)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn print_string(pointer: u32, length: u32) {
    let text = string_units(pointer, length, |units| String::from_utf16_lossy(units));
    append(text.as_bytes());
    append(b"\n");
}

#[unsafe(no_mangle)]
pub extern "C" fn format_number(number: f64, pointer: u32) -> u32 {
    let mut buffer = ryu_js::Buffer::new();
    let text = if number == 0.0 { "0" } else { buffer.format(number) };
    if text.len() > 64 { core::arch::wasm32::unreachable(); }
    string_units(pointer, 64, |units| {
        for (unit, byte) in units.iter_mut().zip(text.bytes()) { *unit = byte as u16; }
    });
    text.len() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn argument_count() -> f64 {
    ARGUMENTS.with_borrow(|args| args.len() as f64)
}

#[unsafe(no_mangle)]
pub extern "C" fn argument_number(index: f64) -> f64 {
    ARGUMENTS.with_borrow(|args| {
        if !index.is_finite() || index < 0.0 || index.fract() != 0.0 || index >= args.len() as f64 {
            return f64::NAN;
        }
        let text = args[index as usize].trim_matches(|c| matches!(c, '\t' | '\n' | '\x0b' | '\x0c' | '\r' | ' '));
        // Finite decimal only; no radix prefixes, separators or infinity spellings.
        if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit() || b"+-.eE".contains(&b)) {
            return f64::NAN;
        }
        text.parse::<f64>().ok().filter(|x| x.is_finite()).unwrap_or(f64::NAN)
    })
}

wasip3::cli::command::export!(Command);
struct Command;
impl wasip3::exports::cli::run::Guest for Command {
    async fn run() -> Result<(), ()> {
        // WASI argv[0] is the command name. Expose only user-supplied operands.
        ARGUMENTS.with_borrow_mut(|args| *args = wasip3::cli::environment::get_arguments().into_iter().skip(1).collect());
        OUTPUT.with_borrow_mut(|state| *state = (Vec::new(), false));
        #[cfg(all(any(target_env = "p2", target_env = "p3"), not(feature = "static-link")))]
        porffor::internal::api::main();
        #[cfg(any(feature = "static-link", not(any(target_env = "p2", target_env = "p3"))))]
        unsafe { main(); }
        let (bytes, overflow) = OUTPUT.with_borrow_mut(std::mem::take);
        if overflow { return Err(()); }
        if bytes.is_empty() { return Ok(()); }
        let (mut tx, rx) = wasip3::wit_stream::new();
        let (result, remaining) = futures::join!(
            async { wasip3::cli::stdout::write_via_stream(rx).await },
            async { let remaining = tx.write_all(bytes).await; drop(tx); remaining }
        );
        if !remaining.is_empty() { return Err(()); }
        result.map_err(|_| ())
    }
}
