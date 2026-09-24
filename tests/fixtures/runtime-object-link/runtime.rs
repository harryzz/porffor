#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! { loop {} }

static mut LAST: f64 = 0.0;
static mut STRING_HEAP: [u16; 2 * 1024 * 1024] = [0; 2 * 1024 * 1024];

unsafe extern "C" { fn main(); }

#[unsafe(no_mangle)]
pub extern "C" fn print_number(value: f64) {
    unsafe { LAST = value; }
}

#[unsafe(no_mangle)]
pub extern "C" fn print_boolean(value: i32) {
    unsafe { LAST = value as f64; }
}

#[unsafe(no_mangle)]
pub extern "C" fn print_null() {
    unsafe { LAST = -1.0; }
}

#[unsafe(no_mangle)]
pub extern "C" fn print_undefined() {
    unsafe { LAST = -2.0; }
}

#[unsafe(no_mangle)]
pub extern "C" fn string_heap_base() -> u32 {
    core::ptr::addr_of_mut!(STRING_HEAP) as *mut u16 as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn print_string(pointer: u32, length: u32) {
    let units = unsafe { core::slice::from_raw_parts(pointer as *const u16, length as usize) };
    unsafe {
        if units.first() == Some(&(b'H' as u16)) && units.last() == Some(&(b'o' as u16)) {
            LAST += length as f64;
        } else {
            LAST = -99.0;
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn runtime_invoke_and_last() -> f64 {
    unsafe { main(); LAST }
}
