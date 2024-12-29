import round from "fast-ts-helpers/round"

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
function formatMoney(
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
function formatMoney(
	amount: number | undefined,
	currency?: string,
	option?: FormatMoneyOption
): string | undefined

// eslint-disable-next-line jsdoc/require-jsdoc
function formatMoney(
	amount: number | undefined,
	currency = `USD`,
	option: FormatMoneyOption = `long`
) {
	if (amount == undefined) {
		return undefined
	}

	// YNAB API uses tenths of cents, for some reason.
	amount /= 1000

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

export default formatMoney
