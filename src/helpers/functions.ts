/** Assert the type of a value at compile-time. */
export function assertType<T>(_value: T) {
	return true
}

/**
 * Prompt the user for input, optionally expecting it to match a RegExp.
 *
 * @param question The question to ask the user. This does not pad the question with a space, so include a space if you wath that.
 * @param matching A RegExp that the response should match. If the response does not match this, the retry string will be used to ask again.
 * @param retry The string to use to ask again if the response does not match the RegExp. Defaults to `Try again. ${question}`.
 */
export async function prompt(
	question: string,
	matching = /.?/,
	retry = `Try again. ${question}`
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		// tslint:disable-next-line: no-any
		const resolver = (data: Buffer) => {
			off()
			resolve(data.toString().trim())
		}

		// tslint:disable-next-line: no-any
		const errorer = (error: any) => {
			off()
			reject(error)
		}

		const off = () => {
			process.stdin.pause()
			process.stdin.off(`data`, resolver)
			process.stdin.off(`error`, reject)
		}

		process.stdout.write(question)

		process.stdin.resume()
		process.stdin.on(`data`, resolver)
		process.stdin.on(`error`, errorer)
	}).then((data) => {
		if (!matching.test(data)) {
			return prompt(retry, matching, retry)
		}

		return data
	})
}

/**
 * Create a tuple from the passed items.
 *
 * @param args The elements of the tuple
 */
export function Tuple<T extends unknown[]>(...args: T) {
	return args
}

/**
 * Returns whether the passed values are equal in value, i.e., a deep equals. It does not support circular objects right now, so don't pass one in.
 *
 * @param values The items to be compared.
 * @template Type The common type between all values.
 * @returns Whether all of the passed values are equal.
 */
export function areEqual<Type>(...values: Type[]) {
	// Iteratively compare each item to all the ones after it in the list. If any are unequal, return false. Don't need any smarts here, as JS is always single threaded right now.
	for (let i = 0; i < values.length - 1; i += 1) {
		for (let j = i + 1; j < values.length; j += 1) {
			if (!doEqual(values[i], values[j])) {
				return false
			}
		}
	}

	function doEqual<T>(a: T, b: T) {
		if (a === b) {
			return true
		}

		if (Boolean(a) !== Boolean(b) || typeof a !== typeof b) {
			return false
		}

		if (typeof a === `object`) {
			if (Array.isArray(a) !== Array.isArray(b)) {
				return false
			}

			// Prepare for deep comparison
			const keys = Object.keys(a)

			if (keys.length !== Object.keys(b).length) {
				return false
			}

			for (const key of keys) {
				if (!areEqual(a[key as keyof T], b[key as keyof T])) {
					return false
				}
			}

			return true
		}

		if (typeof a === `number` && isNaN(a) && isNaN((b as unknown) as number)) {
			// NaN === NaN for me. This is different from standard, so beware.
			return true
		}

		return false
	}

	return true
}

/**
 * Determines how to handle cent values in the `formatMoney` function.
 *
 * `"long"` - Always includes the cent values, e.g., `8` -> `"$8.00"`.
 *
 * `"short"` - Never include the cent values, e.g., `8.99` -> `"$9"`.
 *
 * `"hybrid"` - Omit the cent value if the amount is a whole number.
 */
export type FormatMoneyOption = `long` | `short` | `hybrid`

/**
 * Format an amount of money into a pretty money string. You can specify how the cent values are handled with the option param.
 *
 * `"long"` - Always includes the cent values, e.g., `8` -> `"$8.00"`.
 *
 * `"short"` - Never include the cent values, e.g., `8.99` -> `"$9"`.
 *
 * `"hybrid"` - Omit the cent value if the amount is a whole number.
 *
 * @param amount The amount of money to format into a string.
 * @param currency The currency to use to format the money. Defaults to `"USD"`.
 * @param option Whether to return a long, short, or hybrid string. Defaults to `"long"`.
 * @returns The money string.
 */
export function formatMoney(
	amount: number,
	currency?: string,
	option?: FormatMoneyOption
): string
/**
 * Format an amount of money into a pretty money string. You can specify how the cent values are handled with the option param.
 *
 * `"long"` - Always includes the cent values, e.g., `8` -> `"$8.00"`.
 *
 * `"short"` - Never include the cent values, e.g., `8.99` -> `"$9"`.
 *
 * `"hybrid"` - Omit the cent value if the amount is a whole number.
 *
 *
 * @param amount The amount of money to format into a string.
 * @param currency The currency to use to format the money. Defaults to `"USD"`.
 * @param option Whether to return a long, short, or hybrid string. Defaults to `"long"`.
 * @returns The money string.
 */
export function formatMoney(
	amount: number | undefined,
	currency?: string,
	option?: FormatMoneyOption
): string | undefined

// eslint-disable-next-line jsdoc/require-jsdoc
export function formatMoney(
	amount: number | undefined,
	currency = `USD`,
	option: FormatMoneyOption = `long`
) {
	if (amount == undefined) {
		return undefined
	}

	const digits = (() => {
		switch (option) {
			case `long`:
				return 2
			case `short`:
				return 0
			case `hybrid`:
				return round(amount, 2) === round(amount) ? 0 : 2
		}
	})()

	return amount.toLocaleString(undefined, {
		style: `currency`,
		currency,
		maximumFractionDigits: digits,
		minimumFractionDigits: digits
	})
}

/**
 * Round the passed number (to the passed number of places if applicable).
 *
 * @param value The value to round.
 * @param places The number of places to which to round the number. Defaults to `0`.
 * @returns The rounded value.
 */
export function round(value: number, places = 0): number {
	return places < 0
		? round(value / Math.pow(10, places)) * Math.pow(10, places)
		: Math.round(
				(value + (value >= 0 ? Number.EPSILON : -Number.EPSILON)) * Math.pow(10, places)
		  ) / Math.pow(10, places)
}
