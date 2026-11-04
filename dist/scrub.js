// An error message keeps its shape, which is what groups it, and loses its data:
// a database error carries the query params, others quote values, an email or
// JSON. fixtures/scrub-cases.json is the contract; ports to other languages run it.
const MAX_MESSAGE = 500;
const MAX_STACK = 8_000;
const MAX_TYPE = 200;
const EMAIL = /[^\s@"'<>()]+@[^\s@"'<>()]+/g;
const QUOTED = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|“[^”]*”/g;
const OBJECT = /\{[^{}]*\}/g;
const MONEY = /(?:(?<![A-Za-z])[A-Z]{1,3})?\$(\s*)(-?\d(?:[\d.,]*\d)?)/g;
const NUMBER = /(?<![\w$])-?\d(?:[\d.,]*\d)?/g;
const DIGIT_RUN = /\d{6,}/g;
// `$1`…`$99` written as they are is a SQL placeholder; anything else after `$`
// (a space, a currency code, three digits, a separator) is an amount.
const money = (match, space, digits) => match[0] === '$' && space === '' && /^\d{1,2}$/.test(digits) ? match : '$#';
export function scrubMessage(message) {
    const clean = message
        .split(/\bparams:/)[0]
        .replace(EMAIL, '…@…')
        .replace(QUOTED, '"…"')
        .replace(OBJECT, '{…}')
        .replace(MONEY, money)
        .replace(NUMBER, '#')
        .replace(DIGIT_RUN, '#')
        .replace(/\s+/g, ' ')
        .trim();
    // Code points, not UTF-16 units, so every port cuts at the same place.
    return clean.length > MAX_MESSAGE ? Array.from(clean).slice(0, MAX_MESSAGE).join('') : clean;
}
/** The stack with the scrubbed message as its first line (the original repeats the message) and the frames as they are. */
export function scrubStack(err) {
    if (!err.stack)
        return null;
    const frames = err.stack.split('\n').filter((line) => /^\s+at /.test(line));
    return [`${errorType(err)}: ${scrubMessage(err.message)}`, ...frames].join('\n').slice(0, MAX_STACK);
}
const errorType = (err) => (err.name || 'Error').slice(0, MAX_TYPE);
/**
 * `{ type, message }` of anything thrown. A non-Error is `NonError` with its string form as the message.
 * Never throws: it runs in the wrappers' catch, where a throw would replace the original error.
 */
export function describeError(err) {
    const isError = err instanceof Error;
    let type = isError ? 'Error' : 'NonError';
    let message = '';
    try {
        if (isError)
            type = errorType(err);
        message = scrubMessage(String(isError ? err.message : err));
    }
    catch {
        // a throwing getter or toString: keep what was read
    }
    return { type, message };
}
