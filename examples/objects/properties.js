let address = { city: 'Sofia' };
let user = { name: 'Ada', visits: 2, address };

console.log(user.name);
user.visits = user.visits + 1;
console.log(user.visits);
console.log(user.address.city);
console.log(user.missing);
