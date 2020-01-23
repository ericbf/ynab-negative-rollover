import "./globals"

import { readFileSync } from "fs"
import storage from "node-persist"
import path from "path"
import * as ynab from "ynab"

import { applyRollovers, clearCache, zeroOutRollovers } from "./functions"
import { error, prompt } from "./helpers"

// This is the access token if we need it.
export let token = process.env.TOKEN && process.env.TOKEN.trim()

/** Whether we are currently debugging */
export const debug = false

if (!token) {
	try {
		const data = readFileSync(__filename.replace(/\.[^\.]+$/, `.token`))

		token = data.toString().trim()
	} catch {}

	if (!token) {
		error(
			`No access token passed in ENV or token file. We won't be able talk with the API.`
		)

		throw new Error(
			`No access token passed in ENV or token file. We won't be able talk with the API.`
		)
	}
}

export const api = new ynab.API(token)

/** The directory for the db. */
export const Storage = storage
	.init({ dir: path.join(__dirname, `db`) })
	.then(() => storage)

export const Name = {
	budget: process.env.BUDGET_NAME || `last-used`,
	rolloverPayee: process.env.ROLLOVER_PAYEE || `Budget Rollover`,
	rolloverAccount: process.env.ROLLOVER_ACCOUNT || `Budget Rollover`,
	rolloverCategory: process.env.ROLLOVER_CATEGORY || `Rollover Offset`,
	inflowsCategory: process.env.INFLOWS_CATEGORY || `Inflows`,
	creditCardPayments: process.env.PAYMENTS_GROUP || `Credit Card Payments`
} as const
export type BudgetName = keyof typeof Name

export const Key = {
	account: `${Name.budget}_account_${Name.rolloverAccount}`,
	payee: `${Name.budget}_payee_${Name.rolloverPayee}`,
	paymentsRolloverAndInflows: `${Name.budget}_paymentsGroup_${Name.creditCardPayments}_rolloverCategory_${Name.rolloverCategory}_inflowsCategory_${Name.inflowsCategory}`
} as const
export type StorageKey = keyof typeof Key

async function run() {
	// tslint:disable-next-line: no-unnecessary-type-assertion
	const response = (await prompt(
		`Which would you like?
    1. Apply rollover transactions.
    2. Zero out rollover transactions.
    3. Clear cache.
Type a number (q to quit): `,
		/[123q]/i
	)) as `1` | `2` | `3` | `q` | `Q`

	switch (response) {
		case `1`:
			return applyRollovers()
		case `2`:
			return zeroOutRollovers()
		case `3`:
			return clearCache()
		default:
			return undefined
	}
}

module.exports = run().catch((err) =>
	error(`An exception was thrown: ${err.message || err}`)
)
