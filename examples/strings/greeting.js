function label(value) {
    return "value=" + value;
}
let text = "Hello, " + "WASI";
console.log(text);
console.log(text.length);
console.log(label(42));
console.log("\ud83d" + "\ude00");
console.log(("ab" + "cd") === "abcd");
