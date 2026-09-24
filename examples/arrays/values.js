let values = [1, "two", null];
values[0] = "updated";
console.log(values.length);
console.log(values[0]);
console.log(values[1]);

let bytes = new Uint8Array(4);
bytes[0] = 257;
bytes[1] = -1;
console.log(bytes.length);
console.log(bytes[0]);
console.log(bytes[1]);
