// Calculatrice sûre : un petit analyseur d'expressions, sans eval().

const FUNCTIONS = {
  sqrt: Math.sqrt, racine: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  log: Math.log, log10: Math.log10, exp: Math.exp, abs: Math.abs,
  floor: Math.floor, ceil: Math.ceil,
  round: (x, digits = 0) => Math.round(x * 10 ** digits) / 10 ** digits,
};
FUNCTIONS.arrondi = FUNCTIONS.round;
const CONSTANTS = { pi: Math.PI, e: Math.E };

function tokenize(source) {
  // « 1,5 » : virgule décimale ; ailleurs, la virgule sépare les arguments.
  const text = source.replace(/(\d),(?=\d)/g, "$1.");
  const pattern = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-zÀ-ÿ_]\w*)|(\*\*|[-+*/%^(),]))/y;
  const tokens = [];
  let position = 0;
  while (position < text.length) {
    if (/^\s*$/.test(text.slice(position))) break;
    pattern.lastIndex = position;
    const match = pattern.exec(text);
    if (!match) throw new Error(`caractère non autorisé : « ${text.slice(position).trim()[0]} »`);
    if (match[1] !== undefined) tokens.push({ type: "number", value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ type: "name", value: match[2].toLowerCase() });
    else tokens.push({ type: match[3] === "**" ? "^" : match[3] });
    position = pattern.lastIndex;
  }
  return tokens;
}

/** Évalue une expression mathématique (+ - * / % ^, parenthèses, sqrt, sin, pi…). */
export function calculate(expression) {
  const tokens = tokenize(String(expression));
  let index = 0;
  const peek = () => tokens[index]?.type;
  const take = (type) => {
    if (peek() !== type) throw new Error(`« ${type} » attendu`);
    return tokens[index++];
  };

  function sum() {
    let value = product();
    while (peek() === "+" || peek() === "-") {
      value = tokens[index++].type === "+" ? value + product() : value - product();
    }
    return value;
  }

  function product() {
    let value = unary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const operator = tokens[index++].type;
      const right = unary();
      if (operator !== "*" && right === 0) throw new Error("division par zéro");
      value = operator === "*" ? value * right : operator === "/" ? value / right : value % right;
    }
    return value;
  }

  function unary() {
    if (peek() === "-") return index++, -unary();
    if (peek() === "+") return index++, unary();
    return power();
  }

  function power() {
    const base = atom();
    if (peek() !== "^") return base;
    index++;
    const exponent = unary(); // associatif à droite : 2^3^2 = 2^(3^2)
    if (Math.abs(exponent) > 1000) throw new Error("exposant trop grand");
    return base ** exponent;
  }

  function atom() {
    const token = tokens[index++];
    if (!token) throw new Error("expression incomplète");
    if (token.type === "number") return token.value;
    if (token.type === "(") {
      const value = sum();
      take(")");
      return value;
    }
    if (token.type === "name") {
      if (peek() === "(") {
        const fn = Object.hasOwn(FUNCTIONS, token.value) ? FUNCTIONS[token.value] : null;
        if (!fn) throw new Error(`fonction inconnue : ${token.value}`);
        index++;
        const args = [];
        if (peek() !== ")") {
          do args.push(sum());
          while (peek() === "," && ++index);
        }
        take(")");
        return fn(...args);
      }
      if (Object.hasOwn(CONSTANTS, token.value)) return CONSTANTS[token.value];
      throw new Error(`nom inconnu : ${token.value}`);
    }
    throw new Error(`« ${token.type} » inattendu`);
  }

  const result = sum();
  if (index < tokens.length) throw new Error(`« ${tokens[index].type} » inattendu`);
  if (!Number.isFinite(result)) throw new Error("résultat non défini");
  return Number(result.toPrecision(12)); // gomme les 0,30000000000000004
}
