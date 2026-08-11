/**
 * 安全的指标公式引擎：只支持数字、指标编码引用、+ - * /、括号和一元负号。
 * 不使用 eval/Function，缺失就明确缺失——除零、缺值和循环引用都显式失败，
 * 绝不返回伪造的数值。
 */

export type FormulaFailureReason =
  | "parse_error"
  | "unknown_ref"
  | "missing_value"
  | "division_by_zero"
  | "not_finite"
  | "circular_reference";

export type FormulaResult =
  | { ok: true; value: number }
  | { ok: false; reason: FormulaFailureReason };

export type EvaluateFormulaResult =
  | { ok: true; value: number }
  | { ok: false; reason: "parse_error" | "unknown_ref" | "missing_value" | "division_by_zero" | "not_finite" };

type FormulaOperator = "+" | "-" | "*" | "/";

type FormulaToken =
  | { kind: "number"; value: number; position: number; text: string }
  | { kind: "ref"; name: string; position: number }
  | { kind: "operator"; value: FormulaOperator; position: number }
  | { kind: "paren"; value: "(" | ")"; position: number };

export type FormulaNode =
  | { kind: "number"; value: number }
  | { kind: "ref"; name: string }
  | { kind: "negate"; operand: FormulaNode }
  | { kind: "binary"; operator: FormulaOperator; left: FormulaNode; right: FormulaNode };

export type ParsedFormula =
  | { ok: true; node: FormulaNode; refs: string[] }
  | { ok: false; errors: string[] };

const refStartPattern = /[a-z_]/;
const refBodyPattern = /[a-z0-9_.]/;
const digitPattern = /[0-9]/;

function tokenizeFormula(expression: string): { ok: true; tokens: FormulaToken[] } | { ok: false; error: string } {
  const tokens: FormulaToken[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    const position = index + 1;
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      index += 1;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ kind: "operator", value: char, position });
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ kind: "paren", value: char, position });
      index += 1;
      continue;
    }
    if (digitPattern.test(char)) {
      let text = "";
      while (index < expression.length && digitPattern.test(expression[index])) {
        text += expression[index];
        index += 1;
      }
      if (expression[index] === ".") {
        text += ".";
        index += 1;
        if (!digitPattern.test(expression[index] ?? "")) {
          return { ok: false, error: `公式第 ${position} 个字符处的数字格式不正确` };
        }
        while (index < expression.length && digitPattern.test(expression[index])) {
          text += expression[index];
          index += 1;
        }
      }
      if (expression[index] === "." || refStartPattern.test(expression[index] ?? "")) {
        return { ok: false, error: `公式第 ${position} 个字符处的数字格式不正确` };
      }
      tokens.push({ kind: "number", value: Number(text), position, text });
      continue;
    }
    if (refStartPattern.test(char)) {
      let name = "";
      while (index < expression.length && refBodyPattern.test(expression[index])) {
        name += expression[index];
        index += 1;
      }
      tokens.push({ kind: "ref", name, position });
      continue;
    }
    return { ok: false, error: `公式第 ${position} 个字符“${char}”无法识别` };
  }
  return { ok: true, tokens };
}

export function parseFormula(expression: string): ParsedFormula {
  if (!expression.trim()) return { ok: false, errors: ["公式不能为空"] };
  const tokenized = tokenizeFormula(expression);
  if (!tokenized.ok) return { ok: false, errors: [tokenized.error] };
  const tokens = tokenized.tokens;
  if (!tokens.length) return { ok: false, errors: ["公式不能为空"] };
  let cursor = 0;
  let failure = "";

  const fail = (message: string) => {
    if (!failure) failure = message;
    return null;
  };

  const tokenLabel = (token: FormulaToken) =>
    token.kind === "number" ? token.text : token.kind === "ref" ? token.name : token.value;

  function parseExpression(): FormulaNode | null {
    let left = parseTerm();
    if (!left) return null;
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token.kind !== "operator" || (token.value !== "+" && token.value !== "-")) break;
      cursor += 1;
      const right = parseTerm();
      if (!right) return null;
      left = { kind: "binary", operator: token.value, left, right };
    }
    return left;
  }

  function parseTerm(): FormulaNode | null {
    let left = parseUnary();
    if (!left) return null;
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token.kind !== "operator" || (token.value !== "*" && token.value !== "/")) break;
      cursor += 1;
      const right = parseUnary();
      if (!right) return null;
      left = { kind: "binary", operator: token.value, left, right };
    }
    return left;
  }

  function parseUnary(): FormulaNode | null {
    const token = tokens[cursor];
    if (!token) return fail("公式不完整，缺少操作数");
    if (token.kind === "operator" && token.value === "-") {
      cursor += 1;
      const operand = parseUnary();
      return operand ? { kind: "negate", operand } : null;
    }
    if (token.kind === "operator" && token.value === "+") {
      return fail(`公式第 ${token.position} 个字符处缺少操作数`);
    }
    return parsePrimary();
  }

  function parsePrimary(): FormulaNode | null {
    const token = tokens[cursor];
    if (!token) return fail("公式不完整，缺少操作数");
    if (token.kind === "number") {
      cursor += 1;
      return { kind: "number", value: token.value };
    }
    if (token.kind === "ref") {
      cursor += 1;
      return { kind: "ref", name: token.name };
    }
    if (token.kind === "paren" && token.value === "(") {
      cursor += 1;
      const inner = parseExpression();
      if (!inner) return null;
      const closing = tokens[cursor];
      if (!closing || closing.kind !== "paren" || closing.value !== ")") {
        return fail("公式括号不匹配");
      }
      cursor += 1;
      return inner;
    }
    return fail(`公式第 ${token.position} 个字符处的“${tokenLabel(token)}”不符合语法`);
  }

  const node = parseExpression();
  if (!node) return { ok: false, errors: [failure || "公式语法错误"] };
  if (cursor < tokens.length) {
    const token = tokens[cursor];
    const message = token.kind === "paren" && token.value === ")"
      ? "公式括号不匹配"
      : `公式第 ${token.position} 个字符处的“${tokenLabel(token)}”不符合语法`;
    return { ok: false, errors: [message] };
  }
  const refs: string[] = [];
  const seen = new Set<string>();
  const collect = (current: FormulaNode) => {
    if (current.kind === "ref" && !seen.has(current.name)) {
      seen.add(current.name);
      refs.push(current.name);
    }
    if (current.kind === "negate") collect(current.operand);
    if (current.kind === "binary") {
      collect(current.left);
      collect(current.right);
    }
  };
  collect(node);
  return { ok: true, node, refs };
}

export function validateFormulaExpression(expression: string, allowedRefs?: ReadonlySet<string>): string[] {
  const parsed = parseFormula(expression);
  if (!parsed.ok) return parsed.errors;
  if (!allowedRefs) return [];
  return parsed.refs
    .filter((ref) => !allowedRefs.has(ref))
    .map((ref) => `公式引用了未登记的指标编码：${ref}`);
}

export function extractFormulaRefs(expression: string): string[] {
  const parsed = parseFormula(expression);
  return parsed.ok ? parsed.refs : [];
}

type NodeEvaluation = { ok: true; value: number } | { ok: false; reason: FormulaFailureReason };

function evaluateNode(node: FormulaNode, resolveRef: (ref: string) => NodeEvaluation): NodeEvaluation {
  if (node.kind === "number") return { ok: true, value: node.value };
  if (node.kind === "ref") return resolveRef(node.name);
  if (node.kind === "negate") {
    const operand = evaluateNode(node.operand, resolveRef);
    return operand.ok ? { ok: true, value: -operand.value } : operand;
  }
  const left = evaluateNode(node.left, resolveRef);
  if (!left.ok) return left;
  const right = evaluateNode(node.right, resolveRef);
  if (!right.ok) return right;
  if (node.operator === "/" && right.value === 0) return { ok: false, reason: "division_by_zero" };
  const value = node.operator === "+"
    ? left.value + right.value
    : node.operator === "-"
      ? left.value - right.value
      : node.operator === "*"
        ? left.value * right.value
        : left.value / right.value;
  if (!Number.isFinite(value)) return { ok: false, reason: "not_finite" };
  return { ok: true, value };
}

/**
 * 计算单条公式。resolve 返回 undefined 表示引用不存在（unknown_ref），
 * 返回 null 或非有限数字表示该值缺失（missing_value）。
 */
export function evaluateFormula(
  expression: string,
  resolve: (ref: string) => number | null | undefined,
): EvaluateFormulaResult {
  const parsed = parseFormula(expression);
  if (!parsed.ok) return { ok: false, reason: "parse_error" };
  const result = evaluateNode(parsed.node, (ref) => {
    const value = resolve(ref);
    if (value === undefined) return { ok: false, reason: "unknown_ref" };
    if (value === null || !Number.isFinite(value)) return { ok: false, reason: "missing_value" };
    return { ok: true, value };
  });
  if (result.ok) return result;
  if (result.reason === "circular_reference") return { ok: false, reason: "missing_value" };
  return { ok: false, reason: result.reason };
}

export type MetricFormulaInput = { code: string; formulaExpr?: string };

/**
 * 按拓扑顺序计算一组指标：无公式的指标由 baseResolve 提供取值，
 * 带 formulaExpr 的指标可以引用同组指标；循环引用显式返回
 * circular_reference，依赖失败的指标返回 missing_value，绝不静默补零。
 */
export function evaluateMetricSet(
  metrics: ReadonlyArray<MetricFormulaInput>,
  baseResolve: (code: string) => number | null | undefined,
): Map<string, FormulaResult> {
  const metricByCode = new Map<string, MetricFormulaInput>();
  for (const metric of metrics) {
    if (!metricByCode.has(metric.code)) metricByCode.set(metric.code, metric);
  }

  const parsedByCode = new Map<string, ParsedFormula>();
  for (const metric of metricByCode.values()) {
    if (metric.formulaExpr !== undefined) parsedByCode.set(metric.code, parseFormula(metric.formulaExpr));
  }

  // 先标记参与循环的指标：只有带公式的指标之间才可能成环。
  const cyclic = new Set<string>();
  const colors = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (code: string) => {
    const state = colors.get(code);
    if (state === "done") return;
    if (state === "visiting") {
      const start = stack.indexOf(code);
      for (const member of stack.slice(start)) cyclic.add(member);
      return;
    }
    colors.set(code, "visiting");
    stack.push(code);
    const parsed = parsedByCode.get(code);
    if (parsed?.ok) {
      for (const ref of parsed.refs) {
        if (parsedByCode.has(ref)) visit(ref);
      }
    }
    stack.pop();
    colors.set(code, "done");
  };
  for (const code of parsedByCode.keys()) visit(code);

  const results = new Map<string, FormulaResult>();

  const baseValue = (code: string): FormulaResult => {
    const value = baseResolve(code);
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return { ok: false, reason: "missing_value" };
    }
    return { ok: true, value };
  };

  const evaluateCode = (code: string): FormulaResult => {
    const cached = results.get(code);
    if (cached) return cached;
    const metric = metricByCode.get(code);
    let result: FormulaResult;
    if (!metric || metric.formulaExpr === undefined) {
      result = baseValue(code);
    } else if (cyclic.has(code)) {
      result = { ok: false, reason: "circular_reference" };
    } else {
      const parsed = parsedByCode.get(code);
      if (!parsed || !parsed.ok) {
        result = { ok: false, reason: "parse_error" };
      } else {
        result = evaluateNode(parsed.node, (ref) => {
          if (metricByCode.has(ref)) {
            const dependency = evaluateCode(ref);
            return dependency.ok ? dependency : { ok: false, reason: "missing_value" };
          }
          const value = baseResolve(ref);
          if (value === undefined) return { ok: false, reason: "unknown_ref" };
          if (value === null || !Number.isFinite(value)) return { ok: false, reason: "missing_value" };
          return { ok: true, value };
        });
      }
    }
    results.set(code, result);
    return result;
  };

  for (const code of metricByCode.keys()) evaluateCode(code);
  return results;
}
