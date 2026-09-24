// Development-host counterpart of the documented finite-decimal argument API.
export function numericArguments(args) {
  const values = [...args];
  return {
    argument_count: () => values.length,
    argument_number: index => {
      if (!Number.isInteger(index) || index < 0 || index >= values.length) return NaN;
      const text = values[index].replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '');
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return NaN;
      const n = Number(text);
      return Number.isFinite(n) ? n : NaN;
    }
  };
}
