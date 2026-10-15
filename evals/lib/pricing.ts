// List prices (USD per 1M tokens) for a rough cost estimate. Checked 2026-10-02 against the
// vendors' pricing pages (team model sheet). Not invoices: cached-input discounts, long-context
// surcharges and promotions are ignored. Unknown models get no estimate unless `--price in,out`
// is given. Zhipu bills the mainland endpoint (open.bigmodel.cn) in CNY: GLM-5.2 is ¥8 / ¥28.

export interface Price {
  input: number;
  output: number;
  note?: string;
}

const PRICES: ReadonlyArray<{ match: RegExp; price: Price }> = [
  { match: /^openai:gpt-5\.5(-\d{4}-\d{2}-\d{2})?$/, price: { input: 5, output: 30, note: 'gpt-5.5 list price (a dated snapshot is assumed to cost the same)' } },
  { match: /^openai:gpt-6\.1-sol$/, price: { input: 2, output: 10 } },
  { match: /^openai:gpt-6-luna$/, price: { input: 0.1, output: 0.5 } },
  { match: /^zhipu:glm-5\.3$/, price: { input: 1.4, output: 4.4, note: 'international list price; open.bigmodel.cn bills ¥8 / ¥28; thinking tokens bill as output' } },
  { match: /^zhipu:glm-5\.2$/, price: { input: 1.4, output: 4.4, note: 'international list price; open.bigmodel.cn bills ¥8 / ¥28' } },
  { match: /^claude:claude-sonnet-5-5$/, price: { input: 2, output: 10 } },
  { match: /^claude:claude-opus-5-5$/, price: { input: 4, output: 20 } },
  { match: /^gemini:gemini-3\.8-flash$/, price: { input: 0.75, output: 3.75, note: 'introductory price until 2026-12-31' } },
];

/** `--price 5,30` overrides the table. */
export function priceFor(target: string, override?: string): Price | null {
  if (override) {
    const [input, output] = override.split(',').map(Number);
    if (!Number.isFinite(input) || !Number.isFinite(output)) throw new Error(`--price expects "<input>,<output>" in USD per 1M tokens, got ${override}`);
    return { input, output, note: 'from --price' };
  }
  return PRICES.find((p) => p.match.test(target))?.price ?? null;
}

export function cost(price: Price | null, inputTokens: number, outputTokens: number): number | null {
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function formatUsd(value: number | null): string {
  return value === null ? 'n/a (no price on file; pass --price in,out)' : `$${value.toFixed(2)}`;
}
