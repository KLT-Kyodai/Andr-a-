import assert from "node:assert/strict";
import { test } from "node:test";

import { calculate } from "../../docs/js/calc.js";

test("calculs courants", () => {
  assert.equal(calculate("2 + 3 * 4"), 14);
  assert.equal(calculate("sqrt(16) + 2^3"), 12);
  assert.equal(calculate("1,5 * 2"), 3);
  assert.equal(calculate("-2^2"), -4);
  assert.equal(calculate("2**3**2"), 512);
  assert.equal(calculate("round(3.14159, 2)"), 3.14);
  assert.equal(calculate("0.1 + 0.2"), 0.3);
  assert.equal(calculate("17 % 5"), 2);
});

test("refuse tout ce qui n'est pas un calcul", () => {
  for (const expression of ["alert(1)", "constructor(1)", "__proto__", "a.b", "2**100000", "1/0", "2 +", "window", ""]) {
    assert.throws(() => calculate(expression), Error, expression);
  }
});
